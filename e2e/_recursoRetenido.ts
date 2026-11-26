import { expect, type Page, type Route } from '@playwright/test';

/** Mantiene el recurso pendiente durante la comprobación y lo libera también si ésta falla. */
export async function conRecursoRetenido<T>(
  page: Page,
  patron: Parameters<Page['route']>[0],
  comprobar: () => Promise<T>,
): Promise<T> {
  let liberar!: () => void;
  const permiso = new Promise<void>((resolve) => { liberar = resolve; });
  const pendientes: Promise<void>[] = [];
  const retener = (ruta: Route) => {
    const respuesta = permiso.then(() => ruta.continue());
    pendientes.push(respuesta);
    return respuesta;
  };
  await page.route(patron, retener);
  try {
    const resultado = await comprobar();
    await expect.poll(() => pendientes.length).toBeGreaterThan(0);
    return resultado;
  } finally {
    liberar();
    await Promise.all(pendientes);
    await page.unroute(patron, retener);
  }
}
