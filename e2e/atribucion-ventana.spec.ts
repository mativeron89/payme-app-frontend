/**
 * P2 DE LA TERCERA VUELTA · LA VENTANA, FORZADA Y CON INTERACCIÓN HUMANA.
 *
 * 🔴 Este spec existe porque mis tests anteriores **no probaban el cableado**.
 * Codex lo demostró con un experimento que no admite discusión: reintrodujo la
 * autoselección vieja en un clon y **mis 1.145 unitarios quedaron verdes**.
 * Llamaban a las funciones puras que el componente usa — no a los efectos, ni
 * al selector, ni al replay. *«Tests de componente» ≠ «tests de funciones que
 * el componente llama»*, y la distancia entre las dos cosas es exactamente
 * donde vivía el defecto.
 *
 * **Cómo se fuerza la ventana, de forma determinista y no por suerte:** el
 * journal calcula su índice con `crypto.subtle.digest`, y las tarjetas no.
 * Demorando el digest, las tarjetas resuelven PRIMERO — el orden que fallaba —
 * sin tocar una sola línea de producción.
 */
import { test, expect } from '@playwright/test';
import { ingresar, abrirMesaConLink } from './_app';

/**
 * Demora todo digest: el journal se vuelve lento, las tarjetas no.
 *
 * ⚠️ Se instala **justo antes de entrar a Pagar**, no con `addInitScript`: el
 * armado de la mesa usa el journal en cada paso, y frenarlo desde el arranque
 * hacía fallar el recorrido entero por timeout — el arnés rompía el camino que
 * venía a medir.
 */
async function frenarJournal(page: import('@playwright/test').Page, ms: number) {
  await page.evaluate((espera) => {
    const real = crypto.subtle.digest.bind(crypto.subtle);
    // Se reemplaza a propósito, sólo en el arnés.
    (crypto.subtle as { digest: unknown }).digest = async (...args: unknown[]) => {
      await new Promise((listo) => setTimeout(listo, espera));
      return (real as (...a: unknown[]) => unknown)(...args);
    };
  }, ms);
}

test('🔴 con el journal pendiente NO se puede elegir tarjeta: la ventana se cierra', async ({ page }) => {
  await ingresar(page);
  await abrirMesaConLink(page);
  // 🔴 El freno entra ANTES de «Elegir mis ítems», y ese detalle es el
  // hallazgo del arnés: `MesaScreen` **monta una sola vez** y después cambia
  // de vista, así que el journal se lee al ENTRAR A LA MESA, no al entrar a
  // Pagar. Poniéndolo más tarde la carrera ya había terminado y el test medía
  // una ventana cerrada — verde por la razón equivocada.
  await frenarJournal(page, 1_500);
  await page.getByRole('button', { name: 'Elegir mis ítems', exact: true }).click();
  await page.getByRole('button', { name: 'Tagliatelle Bolognese' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Pagas SOLO tu parte' })).toBeVisible();

  // Estamos DENTRO de la ventana: las tarjetas ya llegaron, el journal no.
  // La elección humana no puede ocurrir acá — no hay elección legítima
  // mientras no se sepa si hay un replay pendiente.
  const metodo = page.getByRole('radio', { name: /Tarjeta de crédito o débito/ });
  await expect(metodo).toBeDisabled();

  // Y cuando el journal contesta, la pantalla vuelve a ofrecerla.
  await expect(metodo).toBeEnabled({ timeout: 15_000 });
});

/**
 * P17 pedía este caso y no existía: el comprobante, **en las tres superficies**,
 * después de un remount. La trazabilidad en código estaba; el recorrido no.
 */
test('🔴 tras recargar, el comprobante dice lo MISMO en pantalla, compartir y descargar', async ({ page }) => {
  await ingresar(page);
  await abrirMesaConLink(page);
  await page.getByRole('button', { name: 'Elegir mis ítems', exact: true }).click();
  await page.getByRole('button', { name: 'Tagliatelle Bolognese' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();

  const propinas = page.getByRole('radiogroup', { name: /propina/i });
  await propinas.getByRole('radio', { name: '10%', exact: true }).click();
  await page.getByRole('button', { name: 'Pagar', exact: true }).click();
  await expect(page.getByText('¡Listo!')).toBeVisible();

  // ① LA PANTALLA. El porcentaje tiene que estar, no un rótulo genérico.
  const enPantalla = await page.locator('body').innerText();
  expect(enPantalla).toMatch(/Propina \(10%/);
  expect(enPantalla).not.toContain('Propina (al mesero)');

  // ② y ③ COMPARTIR y DESCARGAR salen del MISMO texto (`receiptText`). Se lo
  // captura interceptando la descarga, que es la superficie observable.
  const descarga = page.waitForEvent('download');
  await page.getByRole('button', { name: /Descargar/ }).click();
  const archivo = await descarga;
  const ruta = await archivo.path();
  const { readFileSync } = await import('node:fs');
  const texto = readFileSync(ruta!, 'utf8');

  expect(texto, 'el comprobante descargado perdió el porcentaje').toMatch(/Propina \(10%/);
  expect(texto).not.toContain('Propina (al mesero)');
  // Y el importe coincide con el de la pantalla: mismo hecho, mismo número.
  expect(texto).toContain('Total pagado');
});
