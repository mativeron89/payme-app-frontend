import { expect, type Locator } from '@playwright/test';

/** Portapapeles ficticio. Chromium no inserta por defecto el texto de un evento sintético. */
export async function conservaImporteAlPegar(campo: Locator, anterior: string) {
  await expect(campo).toHaveValue(anterior);
  for (const texto of ['1a2', '−5', '1$2']) {
    await campo.evaluate((elemento, contenido) => {
      const entrada = elemento as HTMLInputElement;
      entrada.focus();
      entrada.select();
      const datos = new DataTransfer();
      datos.setData('text/plain', contenido);
      const pegar = new ClipboardEvent('paste', { clipboardData: datos, bubbles: true, cancelable: true });
      if (entrada.dispatchEvent(pegar) && !document.execCommand('insertText', false, contenido)) {
        throw new Error('Chromium no insertó el texto de prueba');
      }
    }, texto);
    await expect(campo, texto).toHaveValue(anterior);
  }
}
