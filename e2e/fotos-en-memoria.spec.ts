import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { ingresar, irEnLaApp } from './_app';

/**
 * E173-3 · decisión 175 de Mati: las fotos, en memoria mientras dure la sesión.
 * «Sí, guardar en memoria (Recomendada)»: desde la segunda vez aparecen al
 * instante; la app revisa en segundo plano y, si alguien dejó de ser tu amigo
 * o borró la foto, la saca enseguida.
 *
 * Se espía la fachada en la página (como `editar-perfil`): cada pedido de foto
 * se cuenta por id, y el modo decide si responde normal, se cuelga hasta que el
 * test lo suelte, o da 404. Fixture del mock: Sofía y Juan tienen foto visible
 * (`has_avatar: true`); María y Leo no.
 */
type Modo = 'normal' | 'colgar' | '404';
interface Espia {
  llamadas: Record<string, number>;
  /** Pedidos de foto de amigo ya contestados (para esperar una revalidación entera). */
  resueltas: number;
  propias: number;
  modo: Modo;
  pendientes: Array<() => void>;
  ids: Record<string, string>;
}

async function espiar(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const rutaApi = '/src/api/index.ts';
    const rutaMock = '/src/api/mock/mockApi.ts';
    const { api } = await import(/* @vite-ignore */ rutaApi) as {
      api: Record<string, (...a: unknown[]) => Promise<unknown>>;
    };
    const { MockApiError } = await import(/* @vite-ignore */ rutaMock) as {
      MockApiError: new (status: number, code: string) => Error;
    };
    const amigos = (await api.getFriends!() as { friends: Array<{ id: string; full_name: string }> }).friends;
    const w = window as unknown as { __fotos: Espia };
    w.__fotos = {
      llamadas: {},
      resueltas: 0,
      propias: 0,
      modo: 'normal',
      pendientes: [],
      ids: Object.fromEntries(amigos.map((a) => [a.full_name, a.id])),
    };
    const conModo = (original: (...a: unknown[]) => Promise<unknown>) => (...args: unknown[]) => {
      const { modo } = w.__fotos;
      if (modo === '404') return Promise.reject(new MockApiError(404, 'avatar_not_found'));
      if (modo === 'colgar') {
        return new Promise((res, rej) => w.__fotos.pendientes.push(() => { original(...args).then(res, rej); }));
      }
      return original(...args);
    };
    const amigo = conModo(api.getFriendAvatar!.bind(api));
    api.getFriendAvatar = (...args: unknown[]) => {
      const id = args[0] as string;
      w.__fotos.llamadas[id] = (w.__fotos.llamadas[id] ?? 0) + 1;
      return amigo(...args).finally(() => { w.__fotos.resueltas += 1; });
    };
    const propia = conModo(api.getProfileAvatar!.bind(api));
    api.getProfileAvatar = (...args: unknown[]) => {
      w.__fotos.propias += 1;
      return propia(...args);
    };
  });
}

const espia = (page: Page) => page.evaluate(() => (window as unknown as { __fotos: Espia }).__fotos);
const modo = (page: Page, m: Modo) => page.evaluate((x) => { (window as unknown as { __fotos: Espia }).__fotos.modo = x; }, m);
const soltar = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __fotos: Espia };
  w.__fotos.pendientes.splice(0).forEach((f) => f());
});
const llamadasDe = async (page: Page, nombre: string) => {
  const e = await espia(page);
  const id = e.ids[nombre];
  if (!id) throw new Error(`${nombre} no está en la lista de amigos del mock`);
  return e.llamadas[id] ?? 0;
};

const fila = (page: Page, nombre: string) => page.locator('.friend-row').filter({ hasText: nombre });
const fotoDe = (page: Page, nombre: string) => fila(page, nombre).locator('.friend-avatar-image');

async function entrar(page: Page): Promise<void> {
  await ingresar(page);
  const aviso = page.getByLabel('Actualización del Aviso de Privacidad');
  await aviso.getByRole('button', { name: 'Entendido', exact: true }).click();
  await expect(aviso).toHaveCount(0);
  await espiar(page);
}

async function irAAmigos(page: Page): Promise<void> {
  await irEnLaApp(page, '/amigos');
  await expect(fila(page, 'María Ruiz')).toBeVisible();
}

async function irAInicio(page: Page): Promise<void> {
  await irEnLaApp(page, '/');
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
}

/** ¿La URL `blob:` sigue viva? Una revocada ya no se puede leer. */
const blobVivo = (page: Page, url: string) => page.evaluate(
  (u) => fetch(u).then((r) => r.ok, () => false),
  url,
);

test.describe('E173-3 · fotos de Amigos en memoria (decisión 175)', () => {
  test('🔴 con has_avatar sólo se pide la foto de quien la tiene; sin ella, ni un pedido', async ({ page }) => {
    await entrar(page);
    await irAAmigos(page);
    await expect(fotoDe(page, 'Sofía Fernández')).toBeVisible();
    await expect(fotoDe(page, 'María Ruiz')).toHaveCount(0);
    // Lo que se prueba: sin foto no se pide (has_avatar: false).
    expect(await llamadasDe(page, 'María Ruiz')).toBe(0);
    expect(await llamadasDe(page, 'Leo Paz')).toBe(0);
    // Con foto, un solo viaje: el doble efecto de StrictMode en dev comparte
    // el pedido en curso en vez de repetirlo.
    expect(await llamadasDe(page, 'Sofía Fernández')).toBe(1);
  });

  test('sin has_avatar (dueño anterior a v2.148.0): se pide como antes, y el 404 deja las iniciales', async ({ page }) => {
    await entrar(page);
    await page.evaluate(async () => {
      const ruta = '/src/api/index.ts';
      const { api } = await import(/* @vite-ignore */ ruta) as {
        api: Record<string, (...a: unknown[]) => Promise<unknown>>;
      };
      const traer = api.getFriends!.bind(api);
      api.getFriends = async () => {
        const r = await traer() as { friends: Array<Record<string, unknown>> };
        return { friends: r.friends.map(({ has_avatar: _h, ...resto }) => resto) };
      };
    });
    await irAAmigos(page);
    await expect(fotoDe(page, 'Sofía Fernández')).toBeVisible();
    // Se pide aunque no tenga foto: sin la clave, no se sabe.
    await expect.poll(() => llamadasDe(page, 'María Ruiz')).toBeGreaterThanOrEqual(1);
    await expect(fotoDe(page, 'María Ruiz')).toHaveCount(0);
    await expect(fila(page, 'María Ruiz').locator('.avatar')).toBeVisible();
  });

  test('🔴 al volver a Amigos la foto está AL INSTANTE, y se revalida en segundo plano', async ({ page }) => {
    await entrar(page);
    await irAAmigos(page);
    await expect(fotoDe(page, 'Sofía Fernández')).toBeVisible();
    const src = await fotoDe(page, 'Sofía Fernández').getAttribute('src');
    expect(src).toMatch(/^blob:/);

    await irAInicio(page);
    // Salir de Amigos no revoca: la URL sigue viva.
    expect(await blobVivo(page, src!)).toBe(true);

    // La revalidación se cuelga: lo que se ve no puede venir de ella.
    await modo(page, 'colgar');
    await irAAmigos(page);
    await expect(fotoDe(page, 'Sofía Fernández')).toBeVisible();
    await expect(fotoDe(page, 'Sofía Fernández')).toHaveAttribute('src', src!);
    await expect.poll(() => llamadasDe(page, 'Sofía Fernández')).toBe(2);
    expect((await espia(page)).pendientes.length).toBeGreaterThan(0);

    // Llega con los mismos bytes: nada cambia. Se espera a que TODO lo pedido
    // haya vuelto antes de mirar: comparar antes pasaría igual con un reemplazo.
    const pedidas = Object.values((await espia(page)).llamadas).reduce((a, b) => a + b, 0);
    await modo(page, 'normal');
    await soltar(page);
    await expect.poll(async () => (await espia(page)).resueltas).toBe(pedidas);
    await expect(fotoDe(page, 'Sofía Fernández')).toHaveAttribute('src', src!);
    expect(await blobVivo(page, src!)).toBe(true);
  });

  test('🔴 si la revalidación da 404 (te eliminó o borró la foto), la foto se va y quedan las iniciales', async ({ page }) => {
    await entrar(page);
    await irAAmigos(page);
    await expect(fotoDe(page, 'Sofía Fernández')).toBeVisible();
    const src = await fotoDe(page, 'Sofía Fernández').getAttribute('src');
    await irAInicio(page);

    await modo(page, '404');
    await irAAmigos(page);
    await expect(fotoDe(page, 'Sofía Fernández')).toHaveCount(0);
    await expect(fila(page, 'Sofía Fernández').locator('.avatar')).toBeVisible();
    // Retirada del caché = revocada.
    expect(await blobVivo(page, src!)).toBe(false);
  });

  test('🔴 al quitar a un amigo, su foto sale de memoria y las demás se revalidan', async ({ page }) => {
    await entrar(page);
    await irAAmigos(page);
    await expect(fotoDe(page, 'Juan López')).toBeVisible();
    await expect(fotoDe(page, 'Sofía Fernández')).toBeVisible();
    const srcJuan = await fotoDe(page, 'Juan López').getAttribute('src');
    const antesSofia = await llamadasDe(page, 'Sofía Fernández');

    page.once('dialog', (d) => { void d.accept(); });
    await page.getByRole('button', { name: 'Quitar a Juan', exact: true }).click();
    await expect(fila(page, 'Juan López')).toHaveCount(0);
    // La lista recién traída ya no lo tiene: su foto se revoca.
    await expect.poll(() => blobVivo(page, srcJuan!)).toBe(false);
    // Las que siguen se revalidan con la lista nueva, sin dejar de verse.
    await expect.poll(() => llamadasDe(page, 'Sofía Fernández')).toBeGreaterThan(antesSofia);
    await expect(fotoDe(page, 'Sofía Fernández')).toBeVisible();
  });

  test('🔴 cerrar sesión revoca las fotos; al volver a entrar se piden de nuevo', async ({ page }) => {
    await entrar(page);
    await irAAmigos(page);
    await expect(fotoDe(page, 'Sofía Fernández')).toBeVisible();
    const src = await fotoDe(page, 'Sofía Fernández').getAttribute('src');
    expect(await blobVivo(page, src!)).toBe(true);
    const antes = await llamadasDe(page, 'Sofía Fernández');

    await irEnLaApp(page, '/mas');
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    expect(await blobVivo(page, src!)).toBe(false);

    await page.getByLabel('Email', { exact: true }).fill('mati@payme.mx');
    await page.getByLabel('Contraseña', { exact: true }).fill('demo-e2e');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
    await irAAmigos(page);
    await expect(fotoDe(page, 'Sofía Fernández')).toBeVisible();
    await expect(fotoDe(page, 'Sofía Fernández')).not.toHaveAttribute('src', src!);
    expect(await llamadasDe(page, 'Sofía Fernández')).toBeGreaterThan(antes);
  });

  test('🔴 sólo memoria: ver las fotos no agrega nada a localStorage, sessionStorage, IndexedDB ni Cache API', async ({ page }) => {
    await entrar(page);
    const almacenes = () => page.evaluate(async () => ({
      local: Object.keys(localStorage).sort(),
      session: Object.keys(sessionStorage).sort(),
      idb: (await indexedDB.databases()).map((d) => d.name).sort(),
      caches: (await caches.keys()).sort(),
      conBlob: [...Object.values(localStorage), ...Object.values(sessionStorage)].some((v) => v.includes('blob:')),
    }));
    const antes = await almacenes();
    await irAAmigos(page);
    await expect(fotoDe(page, 'Sofía Fernández')).toBeVisible();
    await irAInicio(page);
    await irAAmigos(page);
    await expect(fotoDe(page, 'Sofía Fernández')).toBeVisible();
    const despues = await almacenes();
    expect(despues).toEqual(antes);
    expect(despues.conBlob).toBe(false);
  });
});

test.describe('E173-3 · la foto propia en Configuración, por revisión', () => {
  const FOTO = () => ({
    name: 'foto.jpg',
    mimeType: 'image/jpeg',
    buffer: readFileSync(resolve('landing/img/mesa-comida.jpg')),
  });

  test('🔴 con la misma revisión no se vuelve a pedir; al volver se ve al instante', async ({ page }) => {
    await entrar(page);
    await irEnLaApp(page, '/mas');
    await expect(page.locator('.profile-arroba')).toHaveText('@mativeron');
    await page.getByRole('button', { name: 'Editar perfil', exact: true }).click();
    await page.locator('input[type="file"]').setInputFiles(FOTO());
    await page.getByRole('form', { name: 'Editar perfil' }).getByRole('button', { name: 'Guardar', exact: true }).click();
    const foto = page.locator('.config-profile').getByRole('img', { name: 'Foto de perfil' });
    await expect(foto).toBeVisible();
    await expect.poll(async () => (await espia(page)).propias).toBe(1);
    const src = await foto.getAttribute('src');

    // Si se volviera a pedir, quedaría colgado: no puede ser de dónde sale la foto.
    await modo(page, 'colgar');
    await irAInicio(page);
    await irEnLaApp(page, '/mas');
    await expect(foto).toBeVisible();
    await expect(foto).toHaveAttribute('src', src!);
    expect((await espia(page)).propias).toBe(1);
  });
});
