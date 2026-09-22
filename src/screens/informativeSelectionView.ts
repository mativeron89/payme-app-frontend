import type {
  InformativeFractionBps,
  InformativeSelectionCapability,
  InformativeSelectionItem,
  InformativeSelectionResponse,
  ReplaceInformativeSelectionRequest,
} from '../api/types';
import { INFORMATIVE_SELECTION_CONTRACT } from '../api/types';

const ALLOWED_BPS = new Set<number>([2500, 3333, 5000, 6667, 7500, 10000]);

export type InformativeSelectionState =
  | 'idle'
  | 'loading'
  | 'available'
  | 'readonly'
  | 'unsupported'
  | 'error';

export function informativeSelectionEditingBlocked(input: {
  active: boolean;
  state: InformativeSelectionState;
  busy: boolean;
  payable: boolean;
}): boolean {
  return input.active && (input.state !== 'available' || input.busy || !input.payable);
}

export function showClosedInformativeSelection(input: {
  active: boolean;
  state: InformativeSelectionState;
  payable: boolean;
}): boolean {
  return input.active && !input.payable
    && (input.state === 'loading' || input.state === 'readonly' || input.state === 'error');
}

export function readInformativeSelectionCapability(value: unknown): InformativeSelectionCapability | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).length !== 3
      || raw.contract !== INFORMATIVE_SELECTION_CONTRACT
      || typeof raw.supported !== 'boolean'
      || typeof raw.mutable !== 'boolean') return null;
  return {
    contract: INFORMATIVE_SELECTION_CONTRACT,
    supported: raw.supported,
    mutable: raw.mutable,
  };
}

export function selectionMap(response: InformativeSelectionResponse): Map<string, number> {
  return new Map(response.selection.items.map((item) => [item.item_id, item.declared_fraction_bps]));
}

export function replaceInformativeSelectionRequest(
  selected: ReadonlyMap<string, number>,
): ReplaceInformativeSelectionRequest {
  const items: InformativeSelectionItem[] = [...selected.entries()]
    .map(([item_id, declared_fraction_bps]) => {
      if (!ALLOWED_BPS.has(declared_fraction_bps)) throw new Error('informative_fraction_invalid');
      return { item_id, declared_fraction_bps: declared_fraction_bps as InformativeFractionBps };
    })
    .sort((a, b) => a.item_id.localeCompare(b.item_id));
  return { items, confirm_closure: true };
}

export function sameInformativeSelection(
  expected: ReplaceInformativeSelectionRequest,
  actual: InformativeSelectionResponse,
): boolean {
  if (expected.items.length !== actual.selection.items.length) return false;
  return expected.items.every((item, index) => {
    const saved = actual.selection.items[index];
    return saved?.item_id === item.item_id
      && saved.declared_fraction_bps === item.declared_fraction_bps;
  });
}
