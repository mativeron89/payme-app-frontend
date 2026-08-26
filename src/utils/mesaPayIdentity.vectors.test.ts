import { describe, expect, it } from 'vitest';
import {
  IDEMPOTENCY_IDENTITY_CONTRACT,
  PAYLOAD_KEYS,
  economicKeysFor,
  payloadHash,
} from './payloadIdentity';

const RAW = import.meta.glob('/contract-mirror/contract/mesa-pay-identity-vectors.json', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

const artifact = JSON.parse(
  RAW['/contract-mirror/contract/mesa-pay-identity-vectors.json'] ?? 'null',
) as {
  contract: typeof IDEMPOTENCY_IDENTITY_CONTRACT.mesa_pay;
  payload_keys: { v1: string[]; v2: string[] };
  base: Record<string, unknown>;
  base_sha256_v2: string;
  vectors: Array<{
    id: string;
    change: Record<string, unknown>;
    same_identity_v2: boolean;
    sha256_v2: string;
  }>;
} | null;

if (!artifact) throw new Error('mesa_pay_identity_vectors_missing');
const VECTORS = artifact;

describe('G-37 · contrato y vectores canónicos de mesa_pay v2', () => {
  it('selector ejecutable y keyset v2 coinciden exactamente con el owner', () => {
    expect(IDEMPOTENCY_IDENTITY_CONTRACT.mesa_pay).toEqual(VECTORS.contract);
    expect([...PAYLOAD_KEYS.mesa_pay]).toEqual(VECTORS.payload_keys.v2);
    expect(economicKeysFor('mesa_pay:PA-2847')).toEqual(PAYLOAD_KEYS.mesa_pay);
  });

  it('el hash absoluto de la base coincide', async () => {
    expect(await payloadHash(VECTORS.base, PAYLOAD_KEYS.mesa_pay))
      .toBe(VECTORS.base_sha256_v2);
  });

  it.each(VECTORS.vectors)('$id conserva/cambia exactamente como publica el owner', async (vector) => {
    const payload = { ...VECTORS.base, ...vector.change };
    const hash = await payloadHash(payload, PAYLOAD_KEYS.mesa_pay);
    expect(hash).toBe(vector.sha256_v2);
    expect(hash === VECTORS.base_sha256_v2).toBe(vector.same_identity_v2);
  });

  it('fuente y lock no cambian v2; consumos, propina y destinatario sí', () => {
    const byId = new Map(VECTORS.vectors.map((vector) => [vector.id, vector]));
    for (const id of ['otra_fuente_guardada', 'otro_pm_tipeado', 'otro_lock_token']) {
      expect(byId.get(id)?.same_identity_v2, id).toBe(true);
    }
    for (const id of ['otro_item', 'otro_total_de_items', 'otra_propina', 'otro_destinatario_propina']) {
      expect(byId.get(id)?.same_identity_v2, id).toBe(false);
    }
  });
});
