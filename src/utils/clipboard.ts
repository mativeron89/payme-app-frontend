/** Clipboard puede faltar (HTTP, permisos o WebView). Nunca arroja al caller. */
export async function writeClipboardText(value: string): Promise<boolean> {
  const clipboard = globalThis.navigator?.clipboard;
  if (!clipboard || typeof clipboard.writeText !== 'function') return false;
  try {
    await clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
