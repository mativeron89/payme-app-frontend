import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PAYLOAD_KEYS,
  canonicalizeForHash,
  payloadCanonical,
  payloadHash,
  sha256Hex,
} from '../src/utils/payloadIdentity';

/**
 * ⭐ LA RÉPLICA SE ACREDITA CONTRA EL CÓDIGO ESPEJADO, NO CONTRA SU DESCRIPCIÓN.
 *
 * `src/utils/payloadIdentity.ts` es una copia del `payloadHash` del dueño, y
 * de que sea EXACTA depende algo concreto: el front manda ese hash como
 * `?payload_hash=` en `GET /mesas/creations/:key`, y **un valor mal calculado
 * devuelve 409 `payload_hash_conflict`**, que este front trata como "conservá
 * el freeze". O sea: el modo de falla de una réplica mala es **trabar al
 * organizador**, que es exactamente el costo que la alineación viene a sacar.
 *
 * ## Por qué este test vive en `scripts/` y no en `src/`
 *
 * Para acreditar hay que EJECUTAR el JS del dueño. La regla del repo es que
 * `contract-mirror/` **no se importa desde `src/`** — y se respeta: quien
 * cruza el límite es el test, no el código de producción. `scripts/**` ya está
 * en el `include` de vitest por la suite del verificador del espejo.
 *
 * ## Por qué NO alcanza con los 14 vectores canónicos
 *
 * El artefacto `create-mesa-identity-vectors.json` **no publica el payload
 * base**: publica los `cambio` y sus sha256. De ahí se deduce la base para
 * `items`, `total_cents`, `division_mode` y `guarantee_method`, pero **no
 * `restaurant_id` ni `expected_participants`**. Sirve para acreditar la
 * PARTICIÓN —eso lo hace `payloadIdentity.vectors.test.ts`— y no para
 * acreditar un hash absoluto. Acá se acredita el hash absoluto, contra la
 * implementación real.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');
const ORIGEN = join(RAIZ, 'contract-mirror', 'utils', 'idempotency.js');

function sha256Archivo(ruta: string): string {
  return createHash('sha256').update(readFileSync(ruta)).digest('hex');
}

/**
 * ⚠️ El espejo se carga desde una COPIA `.cjs` en un temporal, y no es un
 * atajo: el `package.json` de este repo declara `"type": "module"`, así que
 * node trata cualquier `.js` de acá como ESM y el `require('crypto')` del
 * archivo del dueño revienta. **El espejo no se toca** —renombrarlo o
 * adaptarlo rompería la paridad byte a byte con la fuente— así que se copia
 * verbatim y se le cambia sólo la extensión.
 *
 * Y se verifica que la copia sea idéntica al original antes de ejecutarla: un
 * test que corre "el código del dueño" sobre un archivo que no comprobó **no
 * está acreditando nada**.
 */
function cargarEspejo() {
  const dir = mkdtempSync(join(tmpdir(), 'payme-mirror-idem-'));
  const destino = join(dir, 'idempotency.cjs');
  copyFileSync(ORIGEN, destino);
  if (sha256Archivo(destino) !== sha256Archivo(ORIGEN)) {
    throw new Error('la copia del espejo no es idéntica al original');
  }
  return createRequire(import.meta.url)(destino) as {
    payloadHash: (payload: unknown, opts?: { keep?: readonly string[] }) => string;
    PAYLOAD_KEYS: Record<string, readonly string[]>;
  };
}

const espejo = cargarEspejo();

const ITEMS = [
  { name: 'Pizza', category: 'italian', price_cents: 30000, quantity: 1 },
  { name: 'Flan', category: 'dessert', price_cents: 20000, quantity: 1 },
];

/**
 * El corpus. Cada entrada existe por una razón: o es un caso del flujo real, o
 * es una forma que rompería una réplica descuidada (orden, tipos mezclados,
 * anidamiento, ausencias, unicode, arrays de primitivos).
 */
const CORPUS: Array<{ nombre: string; payload: unknown }> = [
  { nombre: 'request de apertura completo', payload: {
    restaurant_id: '11111111-1111-4111-8111-111111111111',
    total_cents: 50000,
    division_mode: 'consumo',
    expected_participants: 3,
    guarantee_method: 'card',
    idempotency_key: 'clave-uno',
    stripe_payment_method_id: 'pm_uno',
    save_payment_method: true,
    items: ITEMS,
  } },
  { nombre: 'los mismos ítems al revés', payload: {
    restaurant_id: '11111111-1111-4111-8111-111111111111',
    total_cents: 50000,
    division_mode: 'consumo',
    expected_participants: 3,
    guarantee_method: 'card',
    items: [...ITEMS].reverse(),
  } },
  { nombre: 'claves del objeto en otro orden', payload: {
    items: ITEMS,
    guarantee_method: 'card',
    expected_participants: 3,
    division_mode: 'consumo',
    total_cents: 50000,
    restaurant_id: '11111111-1111-4111-8111-111111111111',
  } },
  { nombre: 'sin ítems', payload: {
    restaurant_id: 'r', total_cents: 1, division_mode: 'igual',
    expected_participants: 2, guarantee_method: 'card', items: [],
  } },
  { nombre: 'una clave del subset ausente', payload: {
    restaurant_id: 'r', total_cents: 1, items: ITEMS,
  } },
  { nombre: 'una clave del subset en undefined', payload: {
    restaurant_id: 'r', total_cents: 1, division_mode: undefined, items: ITEMS,
  } },
  { nombre: 'una clave del subset en null', payload: {
    restaurant_id: 'r', total_cents: 1, division_mode: null, items: ITEMS,
  } },
  { nombre: 'ítems con claves opcionales distintas', payload: {
    restaurant_id: 'r', total_cents: 2, items: [
      { name: 'A', price_cents: 1, quantity: 1 },
      { name: 'B', price_cents: 1, quantity: 1, category: 'other' },
    ],
  } },
  { nombre: 'ítems anidados', payload: {
    restaurant_id: 'r', items: [{ name: 'A', meta: { a: 1, b: [2, 3] } }],
  } },
  { nombre: 'ítems como primitivos (camino sin objetos)', payload: {
    restaurant_id: 'r', items: ['b', 'a', 10, 2],
  } },
  { nombre: 'ítems mezclando primitivos y objetos', payload: {
    restaurant_id: 'r', items: ['b', { name: 'A' }, 1],
  } },
  { nombre: 'ítems con null adentro', payload: {
    restaurant_id: 'r', items: [null, { name: 'A' }],
  } },
  { nombre: 'unicode y comillas', payload: {
    restaurant_id: 'La "Parolaccia" · ñandú 🍕',
    items: [{ name: 'Tiramisú "clásico"', price_cents: 1, quantity: 1 }],
  } },
  { nombre: 'números en los bordes', payload: {
    restaurant_id: 'r', total_cents: Number.MAX_SAFE_INTEGER, expected_participants: 0,
  } },
  { nombre: 'payload vacío', payload: {} },
  { nombre: 'payload nulo', payload: null },
  { nombre: 'sólo claves ajenas al subset', payload: {
    idempotency_key: 'x', stripe_payment_method_id: 'pm_y', save_payment_method: false,
  } },
];

describe('la réplica del payloadHash es idéntica a la del dueño', () => {
  it('el espejo se cargó de verdad (si no, todo lo de abajo pasaría en vacío)', () => {
    expect(typeof espejo.payloadHash).toBe('function');
    expect(Array.isArray(espejo.PAYLOAD_KEYS?.create_mesa)).toBe(true);
  });

  it.each(CORPUS)('$nombre → mismo sha256 que el JS espejado', async ({ payload }) => {
    const keep = PAYLOAD_KEYS.create_mesa;
    const suyo = espejo.payloadHash(payload, { keep: [...keep] });
    const mio = await payloadHash(payload, keep);
    expect(mio).toBe(suyo);
    expect(mio).toMatch(/^[0-9a-f]{64}$/);
  });

  it('🔴 el corpus DISTINGUE de verdad: no todos los hashes son el mismo', () => {
    // Sin esto, una réplica que devolviera una constante pasaría los 17 casos
    // de arriba. El corpus tiene que producir variedad.
    const canonicos = new Set(CORPUS.map((c) => payloadCanonical(c.payload, PAYLOAD_KEYS.create_mesa)));
    expect(canonicos.size).toBeGreaterThan(10);
  });

  it('🔴 MUTANTE · si el orden de ítems dejara de normalizarse, esto cae', async () => {
    const a = { restaurant_id: 'r', items: ITEMS };
    const b = { restaurant_id: 'r', items: [...ITEMS].reverse() };
    expect(await payloadHash(a, PAYLOAD_KEYS.create_mesa))
      .toBe(await payloadHash(b, PAYLOAD_KEYS.create_mesa));
  });

  it('🔴 MUTANTE · dos fracciones distintas NO pueden hashear igual', async () => {
    // El bug de plata que `sortSinPerderInfo` evita del lado del dueño:
    // `map(String).sort()` sobre objetos los vuelve "[object Object]" y
    // colapsa intenciones económicas distintas en la misma.
    const mitades = { items: [{ n: 'A', f: 0.5 }, { n: 'B', f: 0.25 }] };
    const enteros = { items: [{ n: 'A', f: 1 }, { n: 'B', f: 1 }] };
    expect(await payloadHash(mitades, ['items']))
      .not.toBe(await payloadHash(enteros, ['items']));
    expect(await payloadHash(mitades, ['items']))
      .toBe(espejo.payloadHash(mitades, { keep: ['items'] }));
  });

  it('la canonicalización suelta también coincide, no sólo el digest', async () => {
    // Se compara la CADENA además del hash: si sólo se comparara el sha256, un
    // error de canonicalización compensado por otro pasaría inadvertido.
    for (const { payload } of CORPUS) {
      const canonica = payloadCanonical(payload, PAYLOAD_KEYS.create_mesa);
      expect(await sha256Hex(canonica))
        .toBe(espejo.payloadHash(payload, { keep: [...PAYLOAD_KEYS.create_mesa] }));
    }
  });

  it('canonicalizeForHash colapsa null y undefined al mismo literal, como allá', () => {
    expect(canonicalizeForHash(null)).toBe('null');
    expect(canonicalizeForHash(undefined)).toBe('null');
  });
});

describe('las tres declaraciones de PAYLOAD_KEYS coinciden', () => {
  const vectores = JSON.parse(
    readFileSync(join(RAIZ, 'contract-mirror', 'contract', 'create-mesa-identity-vectors.json'), 'utf8'),
  ) as { payload_keys: string[] };

  it('🔴 mi copia = la del JS espejado = la que declara el artefacto de vectores', () => {
    // Tres fuentes, una verdad. Si el dueño cambia las llaves, cae acá antes de
    // que el hash empiece a diferir en silencio.
    expect([...PAYLOAD_KEYS.create_mesa]).toEqual([...espejo.PAYLOAD_KEYS.create_mesa]);
    expect([...PAYLOAD_KEYS.create_mesa]).toEqual(vectores.payload_keys);
  });

  it('🔴 la fuente de pago y el opt-in de guardado NO están en la identidad', () => {
    // La afirmación central del artefacto, escrita como test: si alguien las
    // agrega "para ser más estricto", vuelve el B-06 que esto viene a cerrar.
    for (const prohibida of ['stripe_payment_method_id', 'payment_method_id', 'save_payment_method']) {
      expect(PAYLOAD_KEYS.create_mesa as readonly string[]).not.toContain(prohibida);
    }
  });
});
