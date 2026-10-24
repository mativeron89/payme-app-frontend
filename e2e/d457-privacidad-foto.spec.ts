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

async function configuracion(page: Page, opciones: Parameters<typeof instrumentar>[1] = {}) {
  await ingresar(page);
  const acuse = page.getByLabel('Actualización del Aviso de Privacidad');
  await acuse.getByRole('button', { name: 'Entendido', exact: true }).click();
  await expect(acuse).toHaveCount(0);
  await instrumentar(page, opciones);
  await irEnLaApp(page, '/mas');
  await expect(page.getByRole('heading', { name: 'Configuración', exact: true })).toBeVisible();
}

test('D457 · off inicial, acción por teclado y estado confirmado; doble gesto no duplica el POST', async ({ page }) => {
  await configuracion(page);
  const control = page.getByRole('switch', { name: ETIQUETA, exact: true });
  await expect(control).toBeEnabled();
  await expect(control).toHaveAttribute('aria-checked', 'false');
  expect((await espia(page)).grants).toBe(0);
  await page.evaluate(() => { (window as unknown as { __d457: Espia }).__d457.modo = 'pendiente'; });
  await control.focus();
  await page.keyboard.press('Space');
  await expect(control).toBeDisabled();
  await expect(control).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Space');
  await expect.poll(async () => (await espia(page)).grants).toBe(1);
  await page.evaluate(() => { (window as unknown as { __d457: Espia }).__d457.soltar?.(); });
  await expect(control).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Permiso activado', { exact: true })).toBeVisible();
  await control.click();
  await expect(control).toHaveAttribute('aria-checked', 'false');
  expect((await espia(page)).revokes).toBe(1);
});

test('D457 · backend viejo mantiene Configuración accesible y no ofrece grants', async ({ page }) => {
  await configuracion(page, { viejo: true });
  await expect.poll(async () => (await espia(page)).lecturas).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Cerrar sesión', exact: true })).toBeVisible();
  await expect(page.getByRole('switch', { name: ETIQUETA, exact: true })).toHaveCount(0);
  expect((await espia(page)).grants).toBe(0);
});

test('D457 · capability apagada no impide revocar un grant previo', async ({ page }) => {
  await configuracion(page, { enabled: false, concedido: true });
  const control = page.getByRole('switch', { name: ETIQUETA, exact: true });
  await expect(control).toBeEnabled();
  await control.click();
  await expect(control).toHaveAttribute('aria-checked', 'false');
  await expect(control).toBeDisabled();
  expect((await espia(page)).grants).toBe(0);
});

test('D457 · respuesta ambigua se concilia con una lectura, sin repetir el cambio', async ({ page }) => {
  await configuracion(page);
  const control = page.getByRole('switch', { name: ETIQUETA, exact: true });
  await expect(control).toBeEnabled();
  const antes = (await espia(page)).lecturas;
  await page.evaluate(() => { (window as unknown as { __d457: Espia }).__d457.modo = 'ambiguo'; });
  await control.click();
  await expect(page.getByRole('alert')).toContainText('El estado mostrado corresponde a una nueva consulta.');
  await expect(control).toHaveAttribute('aria-checked', 'true');
  expect((await espia(page)).grants).toBe(1);
  expect((await espia(page)).lecturas).toBe(antes + 1);
});

test('D457 · revoca desde PuertaLegal sin aceptar, navegar ni habilitar grant', async ({ page }) => {
  await omitirGuiaEnFixture(page);
  await page.goto('/');
  await instrumentar(page, { puerta: true, concedido: true, enabled: false });
  await page.getByLabel('Email', { exact: true }).fill('mati@payme.mx');
  await page.getByLabel('Contraseña', { exact: true }).fill('demo-e2e');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  const puerta = page.getByRole('dialog', { name: 'Actualizamos nuestros documentos' });
  await expect(puerta).toBeVisible();
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
