import { expect, type Page } from '@playwright/test';
import { ingresar } from '../_app';
import { sacarFoto } from '../_camara';
import { configurarTicketSinQr } from './ticket-sin-qr';

/**
 * D344 · «Mi parte» y la propina de la mesa, en el mock con los pagos apagados
 * (la mesa sin garantía). Los ajustes salen de los seams del OCR de siempre
 * (`ticket-sin-qr.ts`): el ticket es de $840 en platos; `descuento` le resta
 * $50 y `servicio_descuento` además suma $85 de servicio.
 */
export type LecturaDelTicket = 'descuento' | 'servicio_descuento';

/** Escanea, elige cómo dividen entre 4 y llega a «Compartir la mesa». Devuelve el código. */
export async function hastaCompartir(
  page: Page,
  opciones: { readonly ocr: LecturaDelTicket; readonly modo: 'igual' | 'consumo' },
): Promise<string> {
  await configurarTicketSinQr(page, { ocr: opciones.ocr });
  await ingresar(page);
  await page.getByRole('button', { name: 'Escanear', exact: true }).click();
  await sacarFoto(page);
  await expect(page.getByRole('radio', { name: /Pagar el total/ })).toBeVisible();
  const consumo = opciones.modo === 'consumo';
  await page.getByRole('radio', { name: consumo ? /Por lo que pidió cada uno/ : /En partes iguales/ }).click();
  const mas = page.getByRole('button', { name: 'Un comensal más' });
  if (consumo) await mas.click();
  await mas.click();
  await mas.click();
  await mas.click();
  await expect(page.getByRole('group', { name: /¿Cuántos (pagan|son en la mesa)\?/ })).toContainText('4');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();
  const code = (await page.locator('.share-code-txt').innerText()).trim();
  expect(code).toMatch(/^PA-/);
  return code;
}

/** El selector de la propina de la mesa (la sección con ese título). */
export function selectorDePropina(page: Page) {
  return page.getByRole('region', { name: 'Propina de la mesa' });
}

/** Cambia la mesa del mock con una función que corre en el navegador, y recarga. */
async function cambiarLaMesa(page: Page, code: string, cambio: 'corregida' | 'de_otro'): Promise<void> {
  await page.evaluate(async ({ code: c, cambio: q }) => {
    const route = '/src/api/mock/store.ts';
    const module = await import(/* @vite-ignore */ route);
    const mesa = module.state.mesas.find((candidate: { code: string }) => candidate.code === c);
    if (!mesa) throw new Error(`no está la mesa ${c}`);
    if (q === 'corregida') {
      // La mesa se corrigió después del ticket: la suma de los platos del
      // recibo ya no es el total, y el dueño no aplica sus ajustes (R4).
      if (!mesa.ticket_adjustments) throw new Error('la mesa no trae ajustes');
      mesa.ticket_adjustments.items_total_cents += 500;
    } else {
      // La misma mesa vista por alguien que no la abrió.
      mesa.openedByUser = false;
    }
    module.persist();
  }, { code, cambio });
  await page.goto(`/#/mesa/${code}`);
}

export const corregirLaMesa = (page: Page, code: string) => cambiarLaMesa(page, code, 'corregida');
export const verComoParticipante = (page: Page, code: string) => cambiarLaMesa(page, code, 'de_otro');

/** Cuántos `PUT /tip` recibió el mock (`contarPedidosDePropina`). */
export async function pedidosDePropina(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const route = '/src/api/mock/mockApi.ts';
    const module = await import(/* @vite-ignore */ route);
    return module.contarPedidosDePropina() as number;
  });
}
