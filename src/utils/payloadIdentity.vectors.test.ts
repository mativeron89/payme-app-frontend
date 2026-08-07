import { describe, expect, it } from 'vitest';
import { PAYLOAD_KEYS, payloadHash } from './payloadIdentity';

/**
 * ⭐ LOS 14 VECTORES CANÓNICOS DEL DUEÑO, COMO TEST DE ESTA IMPLEMENTACIÓN.
 *
 * `contract/create-mesa-identity-vectors.json` (espejado, v2.48.0) declara qué
 * cambios de un `POST /mesas` **conservan la identidad económica** y cuáles
 * **la cambian**. Existe por esta divergencia, en palabras del dueño:
 *
 * > *"su fingerprint cubre el request entero; el mío deja la FUENTE DE PAGO
 * > afuera A PROPÓSITO — incluirla rota la clave en un reload con tarjeta
 * > tipeada y abre segunda mesa con segundo hold (B-06)."*
 *
 * ## 🔴 QUÉ ACREDITA ESTE ARCHIVO Y QUÉ NO — el límite es del artefacto
 *
 * El artefacto **no publica el payload BASE**: publica los `cambio` y sus
 * sha256. De los `cambio` se deduce la base para `items`, `total_cents`,
 * `division_mode` y `guarantee_method`, pero **no `restaurant_id` ni
 * `expected_participants`** — de esos sólo se sabe lo que NO son. Así que
 * **con este artefacto no se puede acreditar un hash ABSOLUTO**, y afirmar lo
 * contrario sería el error que este repo viene persiguiendo hace tres noches.
 *
 * Lo que sí acredita, y es exactamente lo que hace falta: **la PARTICIÓN**. Se
 * aplica cada `cambio` a una base propia y se compara el agrupamiento
 * resultante contra el que declaran los sha256 publicados. Si mi
 * implementación metiera la fuente de pago en la identidad —o dejara los
 * ítems sin ordenar— las dos particiones dejarían de coincidir.
 *
 * La igualdad byte a byte con el dueño se acredita aparte, ejecutando su JS
 * espejado: `scripts/payloadIdentity.mirror.test.ts`.
 */

/**
 * El artefacto se lee como TEXTO, con el mismo `?raw` que usan los otros
 * cuatro tests de espejo de este repo (`contractMirror`, `ocrLimit.mirror`,
 * `pagoSinCuenta`, `walletRailNotifications.mirror`). Leerlo, no importarlo
 * como módulo: `src/` no consume el espejo, lo verifica.
 */
const CRUDO = import.meta.glob('/contract-mirror/contract/create-mesa-identity-vectors.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const vectores = JSON.parse(
  CRUDO['/contract-mirror/contract/create-mesa-identity-vectors.json'] ?? 'null',
) as {
  payload_keys: string[];
  base_sha256: string;
  vectores: Array<{
    id: string;
    cambio: Record<string, unknown>;
    misma_identidad: boolean;
    porque: string;
    sha256: string;
  }>;
} | null;

/**
 * La base propia. Lo que es deducible de los `cambio` se reproduce exacto
 * —si no, `items_reordenados` no sería un reordenamiento de nada y
 * `item_removido` no removería nada—; el resto se elige distinto de lo que
 * cada `cambio` propone, para que todo vector sea un cambio REAL.
 */
const BASE = {
  restaurant_id: '11111111-1111-4111-8111-111111111111',
  total_cents: 50000,
  division_mode: 'consumo',
  expected_participants: 3,
  guarantee_method: 'card',
  idempotency_key: 'vector-canonico-0001',
  stripe_payment_method_id: 'pm_uno',
  payment_method_id: '11111111-1111-4111-8111-111111111111',
  items: [
    { name: 'Pizza', category: 'italian', price_cents: 30000, quantity: 1 },
    { name: 'Flan', category: 'dessert', price_cents: 20000, quantity: 1 },
  ],
} as const;

function aplicar(cambio: Record<string, unknown>): Record<string, unknown> {
  return { ...BASE, ...cambio };
}

async function identidad(payload: unknown): Promise<string> {
  return payloadHash(payload, PAYLOAD_KEYS.create_mesa);
}

/** Agrupa ids por su clave de identidad, y devuelve los grupos ordenados. */
function particion(pares: Array<{ id: string; clave: string }>): string[][] {
  const grupos = new Map<string, string[]>();
  for (const { id, clave } of pares) {
    const grupo = grupos.get(clave) ?? [];
    grupo.push(id);
    grupos.set(clave, grupo);
  }
  return [...grupos.values()].map((g) => g.sort()).sort((a, b) => (a[0]! < b[0]! ? -1 : 1));
}

if (!vectores) throw new Error('no se pudo leer el artefacto de vectores espejado');
const VECTORES = vectores;

describe('los vectores canónicos, contra esta implementación', () => {
  it('el artefacto se cargó y trae los 14 vectores', () => {
    // Sin esto, un glob roto dejaría todo lo de abajo pasando en vacío.
    expect(VECTORES.vectores).toHaveLength(14);
    expect(VECTORES.payload_keys).toEqual([...PAYLOAD_KEYS.create_mesa]);
  });

  it('🔴 cada vector es un cambio REAL sobre la base', async () => {
    // El test más aburrido y el más necesario: si un `cambio` coincidiera con
    // lo que la base ya tiene, "conserva la identidad" sería cierto por vacío
    // y el vector no probaría nada.
    for (const v of VECTORES.vectores) {
      if (v.id === 'base') continue;
      const modificado = aplicar(v.cambio);
      expect(JSON.stringify(modificado), `${v.id} no cambia nada`)
        .not.toBe(JSON.stringify(BASE));
    }
  });

  it('⭐ la PARTICIÓN que produce esta implementación es la que declara el dueño', async () => {
    const mios = await Promise.all(
      VECTORES.vectores.map(async (v) => ({ id: v.id, clave: await identidad(aplicar(v.cambio)) })),
    );
    const suyos = VECTORES.vectores.map((v) => ({ id: v.id, clave: v.sha256 }));
    expect(particion(mios)).toEqual(particion(suyos));
  });

  it.each(VECTORES.vectores.filter((v) => v.misma_identidad))(
    'CONSERVA la identidad: $id — $porque',
    async ({ cambio }) => {
      expect(await identidad(aplicar(cambio))).toBe(await identidad(BASE));
    },
  );

  it.each(VECTORES.vectores.filter((v) => !v.misma_identidad))(
    'CAMBIA la identidad: $id — $porque',
    async ({ cambio }) => {
      expect(await identidad(aplicar(cambio))).not.toBe(await identidad(BASE));
    },
  );

  it('los que cambian la identidad son distintos ENTRE SÍ, no sólo de la base', async () => {
    // Que ocho cambios económicos colapsaran todos en el mismo hash sería un
    // defecto que "distinto de la base" no detecta.
    const distintos = VECTORES.vectores.filter((v) => !v.misma_identidad);
    const claves = new Set(await Promise.all(distintos.map((v) => identidad(aplicar(v.cambio)))));
    expect(claves.size).toBe(distintos.length);
  });

  it('🔴 el artefacto es coherente consigo mismo: sha256 == base ⟺ misma_identidad', () => {
    // La verificación que hace el test del dueño. Se repite acá porque el
    // artefacto es una copia espejada: si llegara alterado, el resto de este
    // archivo estaría comparándose contra una tabla mentirosa.
    for (const v of VECTORES.vectores) {
      expect(v.sha256 === VECTORES.base_sha256, v.id).toBe(v.misma_identidad);
    }
  });

  it('⚠️ el hash absoluto NO se acredita acá, y se dice en vez de simularse', async () => {
    // Sin el payload base del dueño, mi hash de MI base no puede coincidir con
    // el suyo — `restaurant_id` y `expected_participants` no son deducibles.
    // Se afirma explícitamente para que nadie lea este archivo como si
    // acreditara equivalencia byte a byte: eso vive en el test del espejo.
    expect(await identidad(BASE)).not.toBe(VECTORES.base_sha256);
  });
});
