import { expect, test, type Page } from '@playwright/test';
import { abrirMesaConLink, ingresar, tokenDeLaUrl } from './_app';

/**
 * AF-PUERTA-JOIN (orden 40e03c11…) · la puerta legal antes de unirse a una mesa
 * por link. Hallazgo de App Backend - Opus en AB2: `App.tsx` dibujaba
 * `JoinMesaScreen` antes de mirar la puerta, así que quien llegaba por link se
 * unía sin haber aceptado; con el 428 de AB2 quedaba en «Reintentar».
 *
 * «Unido» se mide en el dueño mock (`state.joinedMesaCodes`, el espejo de
 * `mesa_participants`), no en la pantalla: la ausencia de «¡Te sumaste!» no
 * prueba que el canje no haya corrido por detrás.
 */
const FLAG = 'payme.app.mock.legal_3_0_0.v1';
const PUERTA = 'Actualizamos nuestros documentos';

async function paquete(page: Page, encendido: boolean): Promise<void> {
  await page.evaluate(([k, on]) => {
    if (on) localStorage.setItem(k, 'on'); else localStorage.removeItem(k);
  }, [FLAG, encendido] as const);
}

async function unido(page: Page, code: string): Promise<boolean> {
  return page.evaluate(async (c) => {
    const ruta = '/src/api/mock/store.ts';
    const store = await import(/* @vite-ignore */ ruta) as { state: { joinedMesaCodes: string[] } };
    return store.state.joinedMesaCodes.includes(c);
  }, code);
}

/** Recarga completa: la puerta se consulta al montar con la sesión guardada. */
async function abrirLinkEnFrio(page: Page, code: string, token: string): Promise<void> {
  await page.goto('about:blank');
  await page.goto(`/#/mesa/${code}?t=${token}`);
}

/**
 * `accept-link` parcheado en la fachada, con la semántica de AB2: contesta
 * `428 legal_acceptance_required` mientras la sesión no haya aceptado el
 * paquete (`siempre`: aunque haya aceptado, para el dueño que se contradice), y
 * cuenta los canjes. El mock nunca contesta 428 (`src/api/index.ts`), así que es
 * la única forma de ejercitarlo acá. El error es el `HttpError` real.
 *
 * ⚠️ Los conteos no se afirman exactos: la app privada corre bajo `StrictMode`,
 * que en desarrollo monta dos veces y dispara dos canjes al montar (ya pasaba
 * antes de esta orden; el canje es idempotente). Se afirma que el conteo NO se
 * mueve solo en una ventana, que es lo que distingue un bucle.
 */
async function acceptLinkConAB2(page: Page, siempre = false): Promise<void> {
  await page.evaluate(async (todo) => {
    const idx = '/src/api/index.ts';
    const http = '/src/api/http.ts';
    const m = await import(/* @vite-ignore */ idx) as { api: Record<string, (...a: unknown[]) => Promise<unknown>> };
    const h = await import(/* @vite-ignore */ http) as { HttpError: new (s: number, b: unknown) => Error };
    const original = m.api.acceptInvitationLink.bind(m.api);
    m.api.acceptInvitationLink = async (...args: unknown[]) => {
      const w = window as unknown as { __canjes?: number };
      w.__canjes = (w.__canjes ?? 0) + 1;
      const sesion = JSON.parse(localStorage.getItem('payme_app_session__mock') ?? 'null') as { principal_id?: string } | null;
      const aceptados = JSON.parse(localStorage.getItem('payme.app.mock.legal_aceptado.v1') ?? '[]') as string[];
      if (todo || !aceptados.includes(sesion?.principal_id ?? '')) {
        throw new h.HttpError(428, { error: 'legal_acceptance_required' });
      }
      return original(...args);
    };
  }, siempre);
}

const canjes = (page: Page) => page.evaluate(() => (window as unknown as { __canjes?: number }).__canjes ?? 0);

async function aceptarPuerta(page: Page): Promise<void> {
  const puerta = page.getByRole('dialog', { name: PUERTA });
  await puerta.getByRole('checkbox', { name: 'Declaro que tengo 18 años o más.' }).check();
  await puerta.getByRole('checkbox', { name: /He leído y acepto los/ }).check();
  await puerta.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(puerta).toHaveCount(0);
}

test.describe('la puerta legal antes de unirse por link', () => {
  test('sin aceptar: la puerta sale ANTES del canje, conserva el token y al aceptar se une', async ({ page }) => {
    await ingresar(page);
    const mesa = await abrirMesaConLink(page);
    expect(await unido(page, mesa.code), 'control: la mesa no nace unida por link').toBe(false);
    await paquete(page, true);

    await abrirLinkEnFrio(page, mesa.code, mesa.token);
    await expect(page.getByRole('dialog', { name: PUERTA })).toBeVisible();
    // Sostenido: si el canje corriera por detrás, el mock ya lo habría anotado.
    await page.waitForTimeout(1500);
    expect(await unido(page, mesa.code), 'se unió a la mesa sin haber aceptado').toBe(false);
    await expect(page.getByText('¡Te sumaste a la mesa!')).toHaveCount(0);
    // El token sigue custodiado (storage o URL) para retomar la unión.
    const custodiado = await page.evaluate(() => window.sessionStorage.getItem('payme_pending_invitation_link'));
    expect(custodiado !== null || tokenDeLaUrl(page.url()) === mesa.token).toBe(true);

    await aceptarPuerta(page);
    await expect(page.getByText('¡Te sumaste a la mesa!')).toBeVisible();
    expect(await unido(page, mesa.code)).toBe(true);
    // Canje cerrado: la credencial se soltó de las dos custodias, como siempre.
    expect(tokenDeLaUrl(page.url())).toBeNull();
    expect(await page.evaluate(() => window.sessionStorage.getItem('payme_pending_invitation_link'))).toBeNull();
  });

  test('con la aceptación ya hecha: se une directo, sin puerta', async ({ page }) => {
    await ingresar(page);
    const mesa = await abrirMesaConLink(page);
    await paquete(page, true);
    await page.goto('about:blank');
    await page.goto('/');
    await aceptarPuerta(page);
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();

    await abrirLinkEnFrio(page, mesa.code, mesa.token);
    await expect(page.getByText('¡Te sumaste a la mesa!')).toBeVisible();
    await expect(page.getByRole('dialog', { name: PUERTA })).toHaveCount(0);
    expect(await unido(page, mesa.code)).toBe(true);
  });

  test('paquete APAGADO: igual que hoy, se une directo', async ({ page }) => {
    await ingresar(page);
    const mesa = await abrirMesaConLink(page);
    await abrirLinkEnFrio(page, mesa.code, mesa.token);
    await expect(page.getByText('¡Te sumaste a la mesa!')).toBeVisible();
    await expect(page.getByRole('dialog', { name: PUERTA })).toHaveCount(0);
    expect(await unido(page, mesa.code)).toBe(true);
  });

  test('428 legal_acceptance_required en accept-link: abre la puerta, no «Reintentar», y retoma al aceptar', async ({ page }) => {
    await ingresar(page);
    const mesa = await abrirMesaConLink(page);
    // La consulta inicial ya volvió abierta (paquete apagado al entrar); ahora el
    // dueño exige aceptar, como AB2 servido: el canje recibe el 428.
    await paquete(page, true);
    await acceptLinkConAB2(page);
    await page.evaluate(([c, t]) => { window.location.hash = `#/mesa/${c}?t=${t}`; }, [mesa.code, mesa.token] as const);

    await expect(page.getByRole('dialog', { name: PUERTA })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reintentar', exact: true })).toHaveCount(0);
    expect(await canjes(page), 'la puerta salió sin que el canje recibiera el 428').toBeGreaterThan(0);
    expect(await unido(page, mesa.code)).toBe(false);

    await aceptarPuerta(page);
    await expect(page.getByText('¡Te sumaste a la mesa!')).toBeVisible();
    expect(await unido(page, mesa.code)).toBe(true);
  });

  test('428 pero el dueño dice que no falta aceptar: «Reintentar», sin canjear en bucle', async ({ page }) => {
    await ingresar(page);
    const mesa = await abrirMesaConLink(page);
    await acceptLinkConAB2(page, true);
    await page.evaluate(([c, t]) => { window.location.hash = `#/mesa/${c}?t=${t}`; }, [mesa.code, mesa.token] as const);

    const reintentar = page.getByRole('button', { name: 'Reintentar', exact: true });
    await expect(reintentar).toBeVisible();
    const alMostrar = await canjes(page);
    expect(alMostrar).toBeGreaterThan(0);
    await page.waitForTimeout(1500);
    expect(await canjes(page), 'el 428 siguió disparando canjes solos').toBe(alMostrar);
    await expect(page.getByRole('dialog', { name: PUERTA })).toHaveCount(0);

    // Reintentar canjea UNA vez más (un clic no pasa por StrictMode) y se queda.
    await reintentar.click();
    await expect.poll(() => canjes(page)).toBe(alMostrar + 1);
    await expect(reintentar).toBeVisible();
    await page.waitForTimeout(1000);
    expect(await canjes(page)).toBe(alMostrar + 1);
  });
});
