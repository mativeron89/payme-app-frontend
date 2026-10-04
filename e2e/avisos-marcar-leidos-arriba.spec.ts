import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * E174-1 · decisión 174 de Mati: «en Notificaciones el botón de "Marcar todos
 * como leídos" tiene que estar arriba de todo, no abajo».
 *
 * Hasta 0.210.4 la fila iba DESPUÉS de toda la lista; ahora es la primera del
 * contenido, antes de las invitaciones y de las notificaciones. Desde E174-2
 * la misma fila suma «Borrar todas» (`avisos-borrar.spec.ts`).
 *
 * La cuenta del mock no trae notificaciones SIN LEER (sólo una invitación y un
 * aviso leído), y la fila sólo aparece si hay alguna. Se suma una por la
 * fachada, en el mismo documento: la navegación por hash no recarga el módulo.
 * El botón desaparece cuando se marca todo como leído, como en el dueño.
 */
async function conUnaSinLeer(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as {
      api: Record<string, (...a: unknown[]) => Promise<unknown>>;
    };
    let leidas = false;
    const leer = api.getNotifications.bind(api);
    api.getNotifications = async (...args: unknown[]) => {
      const r = await leer(...args) as { notifications: unknown[]; unread_count: number };
      if (leidas) return r;
      const sinLeer = {
        id: 'e174-sin-leer', type: 'generic', title: null, body: 'Aviso sintético sin leer',
        payload: null, related_entity_type: null, related_entity_id: null,
        read_at: null, created_at: new Date().toISOString(),
      };
      return { ...r, notifications: [sinLeer, ...r.notifications], unread_count: r.unread_count + 1 };
    };
    const marcarTodas = api.markAllNotificationsRead.bind(api);
    api.markAllNotificationsRead = async (...args: unknown[]) => {
      leidas = true;
      return marcarTodas(...args);
    };
  });
}

test.describe('E174-1 · «Marcar leídos» arriba de todo', () => {
  test('🔴 la fila de «Marcar leídos» va antes que todo el contenido de la lista', async ({ page }) => {
    await ingresar(page);
    await conUnaSinLeer(page);
    await page.goto('/#/avisos');
    await expect(page.getByRole('heading', { level: 1, name: 'Notificaciones', exact: true })).toBeVisible();
    const boton = page.getByRole('button', { name: 'Marcar leídos', exact: true });
    await expect(boton).toBeVisible();
    // Testigo de que la lista cargó: hay al menos una notificación.
    await expect(page.locator('.aviso-row').first()).toBeVisible();

    const orden = await page.evaluate(() => {
      const scroll = document.querySelector('.avisos-scroll')!;
      const fila = scroll.querySelector('.avisos-actions')!;
      const primero = scroll.firstElementChild;
      const contenido = [...scroll.querySelectorAll('.sectlabel, .inv-card, .aviso-row')];
      return {
        esLaPrimeraFila: primero === fila,
        antesDeTodo: contenido.every((el) => fila.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING),
        filaTop: fila.getBoundingClientRect().top,
        primeraFilaDeLista: Math.min(...contenido.map((el) => el.getBoundingClientRect().top)),
        cuantos: contenido.length,
      };
    });
    expect(orden.cuantos, JSON.stringify(orden)).toBeGreaterThan(0);
    expect(orden.esLaPrimeraFila, JSON.stringify(orden)).toBe(true);
    expect(orden.antesDeTodo, JSON.stringify(orden)).toBe(true);
    expect(orden.filaTop, JSON.stringify(orden)).toBeLessThan(orden.primeraFilaDeLista);
  });

  test('el botón sigue marcando todo como leído, y se va cuando no queda nada sin leer', async ({ page }) => {
    await ingresar(page);
    await conUnaSinLeer(page);
    await page.goto('/#/avisos');
    const boton = page.getByRole('button', { name: 'Marcar leídos', exact: true });
    await expect(boton).toBeVisible();
    await boton.click();
    await expect(boton).toHaveCount(0);
    await expect(page.getByRole('img', { name: 'Sin leer' })).toHaveCount(0);
    // E174-2: la fila queda, con «Borrar todas», mientras haya notificaciones.
    await expect(page.locator('.avisos-actions').getByRole('button', { name: 'Borrar todas', exact: true })).toBeVisible();
  });
});
