import { describe, expect, it } from 'vitest';
import { INFORMATIVE_SELECTION_CONTRACT, type InformativeSelectionResponse } from '../api/types';
import {
  readInformativeSelectionCapability,
  replaceInformativeSelectionRequest,
  sameInformativeSelection,
  selectionMap,
} from './informativeSelectionView';

const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';

function response(items: InformativeSelectionResponse['selection']['items']): InformativeSelectionResponse {
  return {
    contract: INFORMATIVE_SELECTION_CONTRACT,
    mesa: { code: 'PA-1', division_mode: 'igual', status: 'open', mutable: true, closure_reason: null },
    selection: { source: 'informative', items, updated_at: null },
    coverage: { all_items_selected: false },
  };
}

describe('selección informativa v2 · vista pura', () => {
  it('falla cerrado si la capability falta, sobra o cambia de contrato', () => {
    expect(readInformativeSelectionCapability(undefined)).toBeNull();
    expect(readInformativeSelectionCapability({ contract: INFORMATIVE_SELECTION_CONTRACT, supported: true, mutable: true, extra: true })).toBeNull();
    expect(readInformativeSelectionCapability({ contract: 'v1', supported: true, mutable: true })).toBeNull();
  });

  it('Listo siempre forma PUT canónico, incluida la selección vacía', () => {
    expect(replaceInformativeSelectionRequest(new Map())).toEqual({ items: [], confirm_closure: true });
    expect(replaceInformativeSelectionRequest(new Map([[B, 5000], [A, 10000]]))).toEqual({
      items: [
        { item_id: A, declared_fraction_bps: 10000 },
        { item_id: B, declared_fraction_bps: 5000 },
      ],
      confirm_closure: true,
    });
  });

  it('rehidrata pares exactos y sólo reconcilia el mismo conjunto', () => {
    const saved = response([{ item_id: A, declared_fraction_bps: 3333 }]);
    expect([...selectionMap(saved)]).toEqual([[A, 3333]]);
    expect(sameInformativeSelection(replaceInformativeSelectionRequest(new Map([[A, 3333]])), saved)).toBe(true);
    expect(sameInformativeSelection(replaceInformativeSelectionRequest(new Map([[A, 5000]])), saved)).toBe(false);
  });

  it('rechaza fracciones inventadas antes de tocar la red', () => {
    expect(() => replaceInformativeSelectionRequest(new Map([[A, 2000]]))).toThrow('informative_fraction_invalid');
  });
});
