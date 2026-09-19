/**
 * AF-25 · n80 · soltar un consumo elegido mientras no esté pagado.
 * `POST /api/mesas/:code/items/release {item_ids}` (dueño v2.100.0 ·
 * `contract-mirror/routes/mesas.js:1603-1666`).
 *
 * `released` lista SÓLO lo que efectivamente se soltó. **Vacío no es error**:
 * es la respuesta idempotente (ya estaba suelto) y también la de algo que ya se
 * pagó o está en medio de un pago. La pantalla recarga la mesa en los dos casos
 * y cuenta lo que dice el dueño, sin suponer.
 *
 * Decodificación defensiva: un sobre que no es `{released: [...]}` es un error;
 * una fila rara también, porque un «se soltó» inventado le diría a la persona
 * que su consumo quedó libre cuando no lo sabemos.
 */

export interface ConsumoSoltado {
  readonly itemId: string;
  readonly fractionBps: number;
}

function objeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function decodeSoltarConsumo(raw: unknown): readonly ConsumoSoltado[] {
  if (!objeto(raw) || !Array.isArray(raw.released)) throw new Error('release_response_malformed');
  return raw.released.map((r) => {
    if (!objeto(r)
        || typeof r.item_id !== 'string' || r.item_id.length === 0
        || typeof r.fraction_bps !== 'number' || !Number.isSafeInteger(r.fraction_bps)
        || r.fraction_bps <= 0 || r.fraction_bps > 10000) {
      throw new Error('release_response_malformed');
    }
    return { itemId: r.item_id, fractionBps: r.fraction_bps };
  });
}
