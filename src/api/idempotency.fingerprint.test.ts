import { afterEach, describe, expect, it } from 'vitest';
import { PAYLOAD_KEYS, payloadHash } from '../utils/payloadIdentity';

/**
 * ⭐ ORDEN 2-A · EL SELLO DEL INTENTO PASA A SER LA IDENTIDAD ECONÓMICA.
 *
 * ## Qué se arregla
 *
 * El journal sellaba con `sha256(JSON.stringify(request))` — el request
 * ENTERO — y el dueño hashea un subconjunto declarado que **deja la fuente de
 * pago afuera a propósito**. Consecuencia medida: el organizador que perdía la
 * pestaña durante el 3DS con **tarjeta tipeada** no podía reenviar, porque
 * Stripe.js materializa otro `pm_` por invocación y el fingerprint local
 * cambiaba. Fallaba cerrado —cortaba, no duplicaba— pero trababa por una
 * diferencia que **no es económica**.
 *
 * ## La parte delicada: los journals que ya existen
 *
 * Cambiar el algoritmo sin más rompería a quien tenga un intento vivo en su
 * navegador: su sello viejo se compararía contra el hash nuevo y un reintento
 * legítimo moriría con `monetary_payload_ambiguous`. Por eso la entrada lleva
 * `fpv` y **se compara con el algoritmo con el que se selló**, migrando a v2
 * recién cuando un match v1 acredita que el request es byte-idéntico.
 */

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
}

const local = new MemoryStorage();
const session = new MemoryStorage();
const locks = {
  async request<T>(_n: string, _o: unknown, cb: () => Promise<T>): Promise<T> { return cb(); },
};
Object.assign(globalThis, { localStorage: local, sessionStorage: session });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } });

const storage = await import('./storage');
const money = await import('./idempotency');

const ITEMS = [
  { name: 'Pizza', category: 'italian', price_cents: 30000, quantity: 1 },
  { name: 'Flan', category: 'dessert', price_cents: 20000, quantity: 1 },
];

function signIn(id = 'organizador') {
  storage.saveSession({
    access_token: `${id}-a`, refresh_token: `${id}-r`,
    user: { id, payme_id: id, email: `${id}@x`, first_name: id, last_name: id },
    principal_id: id, family_id: `${id}-f`,
  });
}

async function abrir() {
  signIn();
  const actor = await money.resolveMoneyActor();
  const scope = money.scopeForActor(actor, 'mesa:rest|50000|consumo|3|card');
  const handle = await money.acquireMonetaryIntent(scope, 'create_mesa');
  return { scope, handle };
}

function request(handle: { key: string }, over: Record<string, unknown> = {}) {
  return {
    restaurant_id: '11111111-1111-4111-8111-111111111111',
    total_cents: 50000,
    division_mode: 'consumo',
    expected_participants: 3,
    guarantee_method: 'card',
    idempotency_key: handle.key,
    stripe_payment_method_id: 'pm_uno',
    items: ITEMS,
    ...over,
  };
}

/** El journal es una única entrada en localStorage; se lee para inspeccionarla. */
function entradaDelJournal(): Record<string, unknown> {
  const clave = [...local.values.keys()].find((k) => k.startsWith('payme_money_journal_v5_'));
  expect(clave, 'no se encontró la entrada del journal').toBeTruthy();
  return JSON.parse(local.values.get(clave!)!) as Record<string, unknown>;
}

afterEach(() => { local.values.clear(); session.values.clear(); });

describe('el sello de `create_mesa` es la identidad económica del dueño', () => {
  it('⭐ el fingerprint guardado ES el `payloadHash` del contrato, no un digest propio', async () => {
    const { scope, handle } = await abrir();
    const req = request(handle);
    await money.prepareMonetaryRequest(scope, 'create_mesa', handle, req);

    const entrada = entradaDelJournal();
    expect(entrada.fpv).toBe(2);
    expect(entrada.fingerprint).toBe(await payloadHash(req, PAYLOAD_KEYS.create_mesa));
  });

  it('🔴 EL CASO QUE SE ARREGLA · otro `pm_` ya NO rompe el reintento', async () => {
    // Reload con tarjeta tipeada: Stripe.js devuelve otro pm_. Con el sello
    // viejo esto tiraba `monetary_payload_ambiguous` y dejaba al organizador
    // sin poder reenviar ni abrir otra mesa.
    const { scope, handle } = await abrir();
    await money.prepareMonetaryRequest(scope, 'create_mesa', handle, request(handle));
    await expect(money.prepareMonetaryRequest(scope, 'create_mesa', handle, request(handle, {
      stripe_payment_method_id: 'pm_dos',
    }))).resolves.toBeUndefined();
  });

  it('lo mismo con el opt-in de guardado y el orden de ítems', async () => {
    const { scope, handle } = await abrir();
    await money.prepareMonetaryRequest(scope, 'create_mesa', handle, request(handle));
    for (const variante of [
      { save_payment_method: true },
      { items: [...ITEMS].reverse() },
    ]) {
      await expect(
        money.prepareMonetaryRequest(scope, 'create_mesa', handle, request(handle, variante)),
        JSON.stringify(variante),
      ).resolves.toBeUndefined();
    }
  });

  it('⭐ TARJETA GUARDADA · el flujo saved-only REAL, sin mezclar fuentes', async () => {
    // 🔴 Este test estaba MAL y lo encontró Codex: agregaba `payment_method_id`
    // sobre una base que YA traía `stripe_payment_method_id`, o sea un payload
    // con las DOS fuentes — que el schema del dueño rechaza
    // (`sources === 1`, `schemas/index.js`). Probaba que el hash ignora un
    // campo, no el flujo de tarjeta guardada.
    //
    // Acá la base es saved-only de verdad y lo que cambia entre los dos
    // intentos es CUÁL guardada — que es el caso de una persona que garantizó
    // con una tarjeta y al reintentar tiene otra seleccionada.
    const { scope, handle } = await abrir();
    const savedOnly = (pm: string) => ({
      restaurant_id: '11111111-1111-4111-8111-111111111111',
      total_cents: 50000,
      division_mode: 'consumo',
      expected_participants: 3,
      guarantee_method: 'card',
      idempotency_key: handle.key,
      payment_method_id: pm,
      items: ITEMS,
    });
    await money.prepareMonetaryRequest(scope, 'create_mesa', handle,
      savedOnly('11111111-1111-4111-8111-111111111111'));
    await expect(money.prepareMonetaryRequest(scope, 'create_mesa', handle,
      savedOnly('22222222-2222-4222-8222-222222222222'))).resolves.toBeUndefined();
  });

  it('🔴 y saved-only → tipeada tampoco cambia la identidad económica', async () => {
    // La otra transición real: garantizó con guardada y al reintentar la
    // pantalla la manda a tipear. Sigue siendo la MISMA intención económica.
    const { scope, handle } = await abrir();
    const base = {
      restaurant_id: '11111111-1111-4111-8111-111111111111',
      total_cents: 50000,
      division_mode: 'consumo',
      expected_participants: 3,
      guarantee_method: 'card',
      idempotency_key: handle.key,
      items: ITEMS,
    };
    await money.prepareMonetaryRequest(scope, 'create_mesa', handle,
      { ...base, payment_method_id: '11111111-1111-4111-8111-111111111111' });
    await expect(money.prepareMonetaryRequest(scope, 'create_mesa', handle,
      { ...base, stripe_payment_method_id: 'pm_tipeada' })).resolves.toBeUndefined();
  });

  it('🔴 MUTANTE · un cambio ECONÓMICO sigue cortando', async () => {
    // Aflojar de más sería peor que el problema original: dos intenciones
    // distintas compartiendo clave es un cobro equivocado.
    const { scope, handle } = await abrir();
    await money.prepareMonetaryRequest(scope, 'create_mesa', handle, request(handle));
    for (const variante of [
      { total_cents: 60000 },
      { expected_participants: 4 },
      { division_mode: 'igual' },
      { guarantee_method: 'wallet' },
      { restaurant_id: '33333333-3333-4333-8333-333333333333' },
      { items: [ITEMS[0]] },
    ]) {
      await expect(
        money.prepareMonetaryRequest(scope, 'create_mesa', handle, request(handle, variante)),
        JSON.stringify(variante),
      ).rejects.toThrow('monetary_payload_ambiguous');
    }
  });

  it('🔴 los rieles SIN llaves declaradas conservan el sello grueso', async () => {
    // `mesa_pay` tiene el mismo defecto pero DOS tablas del lado del dueño
    // (`mesa_pay` y `mesa_pay_legacy`) y no se puede saber cuál aplica: elegir
    // mal daría un hash incorrecto y un hash incorrecto traba a la persona.
    // Queda más estricto: traba de más, nunca de menos.
    signIn();
    const actor = await money.resolveMoneyActor();
    const scope = money.scopeForActor(actor, 'pay:PA-1|card');
    const handle = await money.acquireMonetaryIntent(scope, 'mesa_pay:PA-1');
    const base = { idempotency_key: handle.key, payment_type: 'card', item_ids: ['i1'], payment_method_id: 'pm_a' };
    await money.prepareMonetaryRequest(scope, 'mesa_pay:PA-1', handle, base);
    expect(entradaDelJournal().fpv).toBeUndefined();
    await expect(money.prepareMonetaryRequest(scope, 'mesa_pay:PA-1', handle, {
      ...base, payment_method_id: 'pm_b',
    })).rejects.toThrow('monetary_payload_ambiguous');
  });
});

describe('los journals de la versión anterior no se rompen', () => {
  /** Reescribe la entrada como la dejaba la versión vieja: sello v1, sin `fpv`. */
  async function degradarASelloV1(req: unknown) {
    const clave = [...local.values.keys()].find((k) => k.startsWith('payme_money_journal_v5_'))!;
    const entrada = JSON.parse(local.values.get(clave)!) as Record<string, unknown>;
    const bytes = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(req))),
    );
    delete entrada.fpv;
    entrada.fingerprint = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    local.values.set(clave, JSON.stringify(entrada));
  }

  it('⭐ un sello v1 se compara con SU algoritmo y el reintento idéntico pasa', async () => {
    const { scope, handle } = await abrir();
    const req = request(handle);
    await money.prepareMonetaryRequest(scope, 'create_mesa', handle, req);
    await degradarASelloV1(req);

    // Sin la marca `fpv`, esto se compararía contra el hash económico y moriría.
    await expect(money.prepareMonetaryRequest(scope, 'create_mesa', handle, req))
      .resolves.toBeUndefined();
  });

  it('y al pasar, MIGRA a v2: el request era byte-idéntico, la identidad está acreditada', async () => {
    const { scope, handle } = await abrir();
    const req = request(handle);
    await money.prepareMonetaryRequest(scope, 'create_mesa', handle, req);
    await degradarASelloV1(req);
    await money.prepareMonetaryRequest(scope, 'create_mesa', handle, req);

    const entrada = entradaDelJournal();
    expect(entrada.fpv).toBe(2);
    expect(entrada.fingerprint).toBe(await payloadHash(req, PAYLOAD_KEYS.create_mesa));
  });

  it('un sello v1 con OTRO payload sigue cortando, como antes', async () => {
    const { scope, handle } = await abrir();
    const req = request(handle);
    await money.prepareMonetaryRequest(scope, 'create_mesa', handle, req);
    await degradarASelloV1(req);
    await expect(money.prepareMonetaryRequest(scope, 'create_mesa', handle, request(handle, {
      total_cents: 60000,
    }))).rejects.toThrow('monetary_payload_ambiguous');
  });

  it('un `fpv` que no es 2 hace ilegible la entrada: fail-closed, no adivinar', async () => {
    const { scope, handle } = await abrir();
    await money.prepareMonetaryRequest(scope, 'create_mesa', handle, request(handle));
    const clave = [...local.values.keys()].find((k) => k.startsWith('payme_money_journal_v5_'))!;
    const entrada = JSON.parse(local.values.get(clave)!) as Record<string, unknown>;
    entrada.fpv = 99;
    local.values.set(clave, JSON.stringify(entrada));
    await expect(money.readEconomicFingerprint(scope, 'create_mesa'))
      .rejects.toThrow('monetary_journal_ambiguous');
  });
});

describe('el hash que se manda al backend sale del journal', () => {
  it('devuelve el sello v2 tal cual: es el que el dueño puede comparar', async () => {
    const { scope, handle } = await abrir();
    const req = request(handle);
    await money.prepareMonetaryRequest(scope, 'create_mesa', handle, req);
    expect(await money.readEconomicFingerprint(scope, 'create_mesa'))
      .toBe(await payloadHash(req, PAYLOAD_KEYS.create_mesa));
  });

  it('🔴 MUTANTE · con sello v1 devuelve `null`, y ese null evita un 409 seguro', async () => {
    // Mandar un digest del request entero como `payload_hash` daría 409
    // GARANTIZADO —el dueño no puede reproducirlo— y este front lee el 409
    // como "conservá el freeze": el organizador quedaría trabado por un dato
    // que mandamos mal nosotros.
    const { scope, handle } = await abrir();
    const req = request(handle);
    await money.prepareMonetaryRequest(scope, 'create_mesa', handle, req);
    const clave = [...local.values.keys()].find((k) => k.startsWith('payme_money_journal_v5_'))!;
    const entrada = JSON.parse(local.values.get(clave)!) as Record<string, unknown>;
    delete entrada.fpv;
    local.values.set(clave, JSON.stringify(entrada));
    expect(await money.readEconomicFingerprint(scope, 'create_mesa')).toBeNull();
  });

  it('sin intento vivo no hay hash que mandar', async () => {
    const { scope, handle } = await abrir();
    await money.prepareMonetaryRequest(scope, 'create_mesa', handle, request(handle));
    await money.completeMonetaryIntent(scope, 'create_mesa', handle);
    expect(await money.readEconomicFingerprint(scope, 'create_mesa')).toBeNull();
  });
});
