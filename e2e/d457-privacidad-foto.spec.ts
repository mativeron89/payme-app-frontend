import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { ingresar, irEnLaApp, omitirGuiaEnFixture } from './_app';

// Respuesta de prueba con los bytes sellados. Nunca se importa desde src de producto.
const aviso = {
  kind: 'aviso_privacidad', version: '3.1.0', hash: '51f9c46f6c5874a0b62dad06e1ead77051cce010ed587de4d720b6add6b002bc',
  effective_from: '2026-10-23T00:00:00.000Z',
  body: readFileSync(new URL('../test-fixtures/legal-d457/aviso_privacidad.txt', import.meta.url), 'utf8').trim(),
};
const ETIQUETA = 'Mostrar mi foto a personas que no son mis amigos';
type Espia = { lecturas: number; grants: number; revokes: number; aceptaciones: number; soltar: (() => void) | null; modo: 'normal' | 'pendiente' | 'ambiguo'; };
const espia = (page: Page) => page.evaluate(() => {
  const { soltar: _s, ...datos } = (window as unknown as { __d457: Espia }).__d457;
  return datos;
});

async function instrumentar(page: Page, opciones: { enabled?: boolean; concedido?: boolean; puerta?: boolean; viejo?: boolean } = {}) {
  await page.evaluate(async ({ aviso: texto, opciones: o }) => {
    const ruta = '/src/api/index.ts';
    const rutaHttp = '/src/api/http.ts';
    const { HttpError } = await import(/* @vite-ignore */ rutaHttp) as { HttpError: new (status: number, body: { error: string }) => Error };
    const { api } = await import(/* @vite-ignore */ ruta) as { api: Record<string, (...a: unknown[]) => Promise<unknown>> };
    const w = window as unknown as { __d457: Espia };
    const e: Espia = { lecturas: 0, grants: 0, revokes: 0, aceptaciones: 0, soltar: null, modo: 'normal' };
    w.__d457 = e;
    const never = { purpose_key: 'foto_perfil_no_amigos', granted: false, state: 'never', since: null, notice_version: null, notice_hash: null };
    const evento = (on: boolean) => ({ ...never, granted: on, state: on ? 'granted' : 'revoked', since: '2026-10-23T00:00:00.000Z', notice_version: texto.version, notice_hash: texto.hash });
    let estado = o.concedido ? evento(true) : never;
    const getConfig = api.getConfig!.bind(api);
    api.getConfig = async () => {
      const c = await getConfig() as { features: Record<string, unknown> };
      const features = { ...c.features };
      if (!o.viejo) features.foto_perfil_no_amigos = { supported: true, enabled: o.enabled ?? true };
      else delete features.foto_perfil_no_amigos;
      return { ...c, features };
    };
    api.getPrivacyNotice = async () => ({ legal_text: texto });
    api.getFotoPerfilNoAmigos = async () => {
      e.lecturas += 1;
      if (o.viejo) throw new HttpError(404, { error: 'unknown_purpose' });
      return estado;
    };
    api.grantFotoPerfilNoAmigos = async (...args) => {
      e.grants += 1;
      const mostrado = args[0] as typeof texto;
      if (mostrado.body !== texto.body || mostrado.hash !== texto.hash || mostrado.version !== texto.version) throw new Error('par_no_mostrado');
      if (e.modo === 'pendiente') await new Promise<void>((resolve) => { e.soltar = resolve; });
      estado = evento(true);
      if (e.modo === 'ambiguo') throw new TypeError('respuesta_perdida');
      return estado;
    };
    api.revokeFotoPerfilNoAmigos = async () => { e.revokes += 1; estado = evento(false); return estado; };
    if (o.puerta) {
      api.getLegalAcceptance = async () => ({ required: true, aviso: { version: texto.version, hash: texto.hash }, terminos: { version: '3.1.0', hash: 'bcf0f9a6d16f5b73ab6957993f8bd5b09d8683f017ed2e8a6dd0f6076c280904' } });
      api.acceptLegal = async () => { e.aceptaciones += 1; return { required: false, aviso: null, terminos: null }; };
    }
  }, { aviso, opciones });
}

test('D457 · revoca desde PuertaLegal sin aceptar, navegar ni habilitar grant', async ({ page }) => {
  await omitirGuiaEnFixture(page);
  await page.goto('/');
  await instrumentar(page, { puerta: true, concedido: true, enabled: false });
  await page.getByLabel('Email', { exact: true }).fill('mati@payme.mx');
  await page.getByLabel('Contraseña', { exact: true }).fill('demo-e2e');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  const puerta = page.getByRole('dialog', { name: 'Actualizamos nuestros documentos' });
  await expect(puerta).toBeVisible();
  // 0.260.2 · el permiso de foto vive en «Más información», a un toque.
  await puerta.getByText('Más información', { exact: true }).click();
  const control = puerta.getByRole('switch', { name: ETIQUETA, exact: true });
  await expect(control).toBeEnabled();
  await control.click();
  await expect(control).toHaveAttribute('aria-checked', 'false');
  await expect(control).toBeDisabled();
  await expect(puerta.getByRole('checkbox')).toHaveCount(2);
  for (const box of await puerta.getByRole('checkbox').all()) await expect(box).not.toBeChecked();
  await expect(puerta.getByRole('button', { name: 'Continuar', exact: true })).toBeDisabled();
  expect((await espia(page)).aceptaciones).toBe(0);
  expect((await espia(page)).grants).toBe(0);
  expect((await espia(page)).revokes).toBe(1);
});

for (const vp of [{ nombre: 'Chrome 1280×720', width: 1280, height: 720 }, { nombre: 'celular 390×844', width: 390, height: 844 }]) {
  test(`0.260.2 · la puerta entra en pantalla y se desplaza (${vp.nombre})`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await omitirGuiaEnFixture(page);
    await page.goto('/');
    await instrumentar(page, { puerta: true, concedido: true, enabled: false });
    await page.getByLabel('Email', { exact: true }).fill('mati@payme.mx');
    await page.getByLabel('Contraseña', { exact: true }).fill('demo-e2e');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    const puerta = page.getByRole('dialog', { name: 'Actualizamos nuestros documentos' });
    await expect(puerta).toBeVisible();
    const continuar = puerta.getByRole('button', { name: 'Continuar', exact: true });
    // Plegada, la tarjeta entra entera: nada cortado arriba y «Continuar» a la vista.
    const caja = await puerta.boundingBox();
    expect(caja!.y).toBeGreaterThanOrEqual(0);
    await expect(continuar).toBeInViewport();
    // Desplegada (panel de foto y Simplificado abiertos) es más alta que la pantalla:
    // no se corta por arriba y la rueda la desplaza hasta el final.
    await puerta.getByText('Más información', { exact: true }).click();
    await puerta.getByText('Aviso de Privacidad Simplificado', { exact: true }).click();
    const abierta = await puerta.boundingBox();
    expect(abierta!.y).toBeGreaterThanOrEqual(0);
    expect(abierta!.height).toBeGreaterThan(vp.height);
    const control = puerta.getByRole('switch', { name: ETIQUETA, exact: true });
    await page.mouse.move(vp.width / 2, vp.height / 2);
    await page.mouse.wheel(0, 5000);
    await expect(control).toBeInViewport();
    await page.mouse.wheel(0, -5000);
    await expect(puerta.getByRole('heading', { name: 'Actualizamos nuestros documentos' })).toBeInViewport();
  });
}

// D468 · los cuatro casos que entraban por Configuración se quitaron con el bloque (están en el historial de git,
// 0.261.0); el panel sigue cubierto por PrivacidadFotoPanel.test.tsx y por los casos de la puerta legal.
test('D468 · Configuración no muestra el permiso de foto (el componente queda para reincorporarlo)', async ({ page }) => {
  await ingresar(page);
  const acuse = page.getByLabel('Actualización del Aviso de Privacidad');
  if (await acuse.count()) await acuse.getByRole('button', { name: 'Entendido', exact: true }).click();
  await instrumentar(page, {});
  await irEnLaApp(page, '/mas');
  await expect(page.getByRole('heading', { name: 'Configuración', exact: true })).toBeVisible();
  await expect(page.getByRole('switch', { name: ETIQUETA, exact: true })).toHaveCount(0);
  await expect(page.getByText('No pudimos confirmar el estado del permiso.')).toHaveCount(0);
  expect((await espia(page)).lecturas).toBe(0);
});
