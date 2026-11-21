import { expect, test } from '@playwright/test';
import { medirTextoAmpliado } from './fixtures/medirTextoAmpliado';
import { hastaCompartir } from './fixtures/mi-parte-d344';

for (const resultado of ['copiado', 'cancelado', 'sin_portapapeles'] as const) {
  test(`Compartir la invitación · ${resultado}`, async ({ page }) => {
    await page.addInitScript((modo) => {
      Object.defineProperty(navigator, 'share', { value: async () => {
        throw new DOMException('Prueba', modo === 'cancelado' ? 'AbortError' : 'NotAllowedError');
      } });
      Object.defineProperty(navigator, 'clipboard', { value: {
        writeText: async () => { if (modo !== 'copiado') throw new Error('sin permiso'); },
      } });
    }, resultado);
    await hastaCompartir(page, { ocr: 'descuento', modo: 'consumo' });
    await page.getByRole('button', { name: 'Compartir…' }).click();
    const copiado = page.getByText('Link de invitación copiado ✓', { exact: true });
    const fallo = page.getByText('No se pudo copiar: tu navegador no habilitó el portapapeles', { exact: true });
    if (resultado === 'copiado') await expect(copiado).toBeVisible();
    else if (resultado === 'sin_portapapeles') await expect(fallo).toBeVisible();
    else {
      await expect(copiado).toHaveCount(0);
      await expect(fallo).toHaveCount(0);
    }
  });
}

for (const idioma of ['es', 'en'] as const) {
  test(`siete coincidencias y búsqueda del séptimo contacto y grupo (${idioma})`, async ({ page }) => {
    const code = await hastaCompartir(page, { ocr: 'descuento', modo: 'consumo' });
    await page.evaluate(async (idioma) => {
      localStorage.setItem('payme.app.idioma.v1', idioma);
      localStorage.setItem('payme.app.mock.username.v1', String(idioma === 'es'));
      const ruta = '/src/api/mock/store.ts';
      const { state, persist } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api/mock/store');
      const amigo = state.friends[0]!;
      const grupo = state.groups[0]!;
      state.friends = Array.from({ length: 7 }, (_, i) => ({
        ...amigo, id: crypto.randomUUID(), payme_id: 'persona' + i, full_name: 'Contacto ' + i, first_name: 'Contacto ' + i,
      }));
      state.groups = Array.from({ length: 7 }, (_, i) => ({ ...grupo, id: crypto.randomUUID(), name: 'Grupo ' + i }));
      persist();
    }, idioma);
    await page.goto('/#/mesa/' + code);
    await page.getByRole('button', { name: idioma === 'es' ? 'Configuración de la mesa' : 'Table settings' }).click();
    const monto = page.getByRole('button', { name: idioma === 'es' ? 'Monto en pesos' : 'Amount in pesos' });
    await medirTextoAmpliado(page, monto, true);
    await page.getByRole('button', { name: idioma === 'es' ? 'Invitar amigos de PayMe' : 'Invite PayMe friends' }).click();
    const panel = page.getByRole('tabpanel');
    await expect(panel.locator('.inv-row')).toHaveCount(6);
    const aviso = panel.locator('.inv-none');
    await expect(aviso).toHaveText(idioma === 'es'
      ? 'Hay más contactos. Busca por nombre o @ para encontrar a quien quieres invitar.'
      : 'There are more contacts. Search by name to find the person you want to invite.');
    await medirTextoAmpliado(page, aviso, false);
    await panel.getByRole('textbox').fill('Contacto 6');
    await expect(panel.locator('.inv-row')).toHaveCount(1);
    await expect(aviso).toHaveCount(0);
    await page.getByRole('tab', { name: idioma === 'es' ? 'Grupos' : 'Groups' }).click();
    await expect(panel.locator('.inv-group')).toHaveCount(6);
    await expect(panel.getByText(idioma === 'es' ? /^Hay más grupos\./ : /^There are more groups\./)).toBeVisible();
    await panel.getByRole('textbox').fill('Grupo 6');
    await expect(panel.locator('.inv-group .n')).toHaveText('Grupo 6');
    await expect(panel.getByText(idioma === 'es' ? /^Hay más grupos\./ : /^There are more groups\./)).toHaveCount(0);
  });
}
