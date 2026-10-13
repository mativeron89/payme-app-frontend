/** D310-E2 · preferencia de presentación local, sin estado de cuenta ni red. */
export const ICON_SIZE_KEY = 'payme.app.icons.v1';
export const ICON_SIZES = ['grandes', 'medianos', 'chicos'] as const;
export type IconSize = typeof ICON_SIZES[number];
export type IconStorage = Pick<Storage, 'getItem' | 'setItem'>;
export interface IconPreferenceState {
  readonly size: IconSize;
  readonly persistence: 'default' | 'saved' | 'temporary';
  readonly notice: 'corrupt' | 'storage-unavailable' | 'not-saved' | null;
}
export function parseIconSize(value: unknown): IconSize | null {
  return ICON_SIZES.find((size) => size === value) ?? null;
}
export function defaultIconState(notice: IconPreferenceState['notice'] = null): IconPreferenceState {
  return { size: 'medianos', persistence: 'default', notice };
}
/** Sin lectura al importar, escritura automática, clear() ni claves ajenas. */
export function loadIconSize(storage: IconStorage | null): IconPreferenceState {
  if (!storage) return defaultIconState('storage-unavailable');
  try {
    const raw = storage.getItem(ICON_SIZE_KEY);
    if (raw === null) return defaultIconState();
    const size = parseIconSize(raw);
    return size ? { size, persistence: 'saved', notice: null } : defaultIconState('corrupt');
  } catch { return defaultIconState('storage-unavailable'); }
}
/** Sólo Aplicar; el roundtrip acredita guardado, un fallo conserva la vista temporal. */
export function saveIconSize(value: unknown, storage: IconStorage | null): IconPreferenceState {
  const size = parseIconSize(value);
  if (!size) return defaultIconState('corrupt');
  const temporary: IconPreferenceState = { size, persistence: 'temporary', notice: 'not-saved' };
  if (!storage) return temporary;
  try {
    storage.setItem(ICON_SIZE_KEY, size);
    if (storage.getItem(ICON_SIZE_KEY) !== size) return temporary;
  } catch { return temporary; }
  return { size, persistence: 'saved', notice: null };
}
