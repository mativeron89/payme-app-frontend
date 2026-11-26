import { expect, type Page, type Route } from '@playwright/test';

/** Mantiene el recurso pendiente durante la comprobación y lo libera también si ésta falla. */
export async function conRecursoRetenido<T>(
  page: Page,
  patron: Parameters<Page['route']>[0],
  comprobar: () => Promise<T>,
): Promise<T> {
  let liberar!: () => void;
  const permiso = new Promise<void>((resolve) => { liberar = resolve; });
  let peticiones = 0;
  const retener = async (ruta: Route) => {
    peticiones += 1;
    await permiso;
    await ruta.continue();
  };
  await page.route(patron, retener);
  try {
    const resultado = await comprobar();
    await expect.poll(() => peticiones).toBeGreaterThan(0);
    return resultado;
  } finally {
    liberar();
    await page.unroute(patron, retener);
  }
}
