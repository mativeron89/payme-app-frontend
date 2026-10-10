import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  IDEMPOTENCY_IDENTITY_CONTRACT,
  PAYLOAD_KEYS,
  canonicalizeForHash,
  payloadCanonical,
  payloadHash,
  sha256Hex,
} from '../src/utils/payloadIdentity';
import { CORPUS_IDENTIDAD, FRACCIONES_MITADES, ITEMS, VERSIONES_MESA_PAY } from './corpusDeHechos';
import { hechoDelDueno } from './hechosDelDueno';

/**
 * ⭐ LA RÉPLICA SE ACREDITA CONTRA EL CÓDIGO DEL DUEÑO, NO CONTRA SU DESCRIPCIÓN.
 *
 * `src/utils/payloadIdentity.ts` es una copia del `payloadHash` del dueño, y
 * de que sea EXACTA depende algo concreto: el front manda ese hash como
 * `?payload_hash=` en `GET /mesas/creations/:key`, y **un valor mal calculado
 * devuelve 409 `payload_hash_conflict`**, que este front trata como "conservá
 * el freeze". O sea: el modo de falla de una réplica mala es **trabar al
 * organizador**, que es exactamente el costo que la alineación viene a sacar.
 *
 * ## D268 · el código del dueño se ejecuta en LOCAL, no acá
 *
 * El repo es público y el espejo ya no copia `utils/idempotency.js`. El
 * generador local (`generar-hechos-del-dueno.mjs`) lo EJECUTA con el repo del
 * dueño sobre las entradas sintéticas de `corpusDeHechos.ts` y guarda las
 * SALIDAS en `hechos-del-dueno.json`. Este test corre la réplica sobre las
 * MISMAS entradas y compara. Si el dueño cambia el archivo, el CI queda rojo
 * (`verificar-mirror.mjs --integridad`) hasta regenerarlas.
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

const delDueno = {
  hashPorCaso: hechoDelDueno<Record<string, string>>('identidad.create_mesa.hash_por_caso'),
  payloadKeys: hechoDelDueno<Record<string, readonly string[]>>('identidad.payload_keys'),
  contrato: hechoDelDueno<typeof IDEMPOTENCY_IDENTITY_CONTRACT>('identidad.contrato'),
  mitades: hechoDelDueno<string>('identidad.fracciones_mitades.hash_de_items'),
  clavesPorVersion: hechoDelDueno<Record<string, readonly string[] | null>>('identidad.mesa_pay.claves_por_version'),
};

describe('la réplica del payloadHash es idéntica a la del dueño', () => {
  it('los hechos del dueño están, para TODO el corpus (si no, todo lo de abajo pasaría en vacío)', () => {
    expect(Object.keys(delDueno.hashPorCaso).sort()).toEqual(CORPUS_IDENTIDAD.map((c) => c.nombre).sort());
    expect(Array.isArray(delDueno.payloadKeys.create_mesa)).toBe(true);
  });

  it.each(CORPUS_IDENTIDAD)('$nombre → mismo sha256 que el JS del dueño', async ({ nombre, payload }) => {
    const mio = await payloadHash(payload, PAYLOAD_KEYS.create_mesa);
    expect(mio).toBe(delDueno.hashPorCaso[nombre]);
    expect(mio).toMatch(/^[0-9a-f]{64}$/);
  });

  it('🔴 el corpus DISTINGUE de verdad: no todos los hashes son el mismo', () => {
    // Sin esto, una réplica que devolviera una constante pasaría los 17 casos
    // de arriba. El corpus tiene que producir variedad.
    const canonicos = new Set(CORPUS_IDENTIDAD.map((c) => payloadCanonical(c.payload, PAYLOAD_KEYS.create_mesa)));
    expect(canonicos.size).toBeGreaterThan(10);
    expect(new Set(Object.values(delDueno.hashPorCaso)).size).toBeGreaterThan(10);
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
    const enteros = { items: [{ n: 'A', f: 1 }, { n: 'B', f: 1 }] };
    expect(await payloadHash(FRACCIONES_MITADES, ['items']))
      .not.toBe(await payloadHash(enteros, ['items']));
    expect(await payloadHash(FRACCIONES_MITADES, ['items'])).toBe(delDueno.mitades);
  });

  it('la canonicalización suelta también coincide, no sólo el digest', async () => {
    // Se compara la CADENA además del hash: si sólo se comparara el sha256, un
    // error de canonicalización compensado por otro pasaría inadvertido.
    for (const { nombre, payload } of CORPUS_IDENTIDAD) {
      const canonica = payloadCanonical(payload, PAYLOAD_KEYS.create_mesa);
      expect(await sha256Hex(canonica), nombre).toBe(delDueno.hashPorCaso[nombre]);
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

  it('🔴 mi copia = la del JS del dueño = la que declara el artefacto de vectores', () => {
    // Tres fuentes, una verdad. Si el dueño cambia las llaves, cae acá antes de
    // que el hash empiece a diferir en silencio.
    expect([...PAYLOAD_KEYS.create_mesa]).toEqual([...delDueno.payloadKeys.create_mesa!]);
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

describe('G-37 · selector mesa_pay ejecutado contra el dueño', () => {
  const artifact = JSON.parse(
    readFileSync(join(RAIZ, 'contract-mirror', 'contract', 'mesa-pay-identity-vectors.json'), 'utf8'),
  ) as {
    contract: typeof IDEMPOTENCY_IDENTITY_CONTRACT.mesa_pay;
    payload_keys: { v1: string[]; v2: string[] };
  };

  it('contrato local = JS del dueño = artefacto del dueño', () => {
    expect(IDEMPOTENCY_IDENTITY_CONTRACT).toEqual(delDueno.contrato);
    expect(IDEMPOTENCY_IDENTITY_CONTRACT.mesa_pay).toEqual(artifact.contract);
    expect([...PAYLOAD_KEYS.mesa_pay]).toEqual(artifact.payload_keys.v2);
    expect([...PAYLOAD_KEYS.mesa_pay]).toEqual([...delDueno.payloadKeys.mesa_pay!]);
  });

  it('ausente/v1 conserva legacy; v2 y futuras seleccionan current', () => {
    expect(VERSIONES_MESA_PAY).toEqual([null, 1, 2, 99]);
    expect(delDueno.clavesPorVersion.ausente).toEqual(artifact.payload_keys.v1);
    expect(delDueno.clavesPorVersion['1']).toEqual(artifact.payload_keys.v1);
    expect(delDueno.clavesPorVersion['2']).toEqual(artifact.payload_keys.v2);
    expect(delDueno.clavesPorVersion['99']).toEqual(artifact.payload_keys.v2);
  });
});
