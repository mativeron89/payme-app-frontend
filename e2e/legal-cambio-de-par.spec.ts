import { expect, test, type Page } from '@playwright/test';

/**
 * AF-CORRECCIONES-AUDITORIA · AF-01 de la auditoría Codex (decisión 120 de Mati).
 *
 * El gesto de aceptar queda atado al PAR que se veía: versión y hash del aviso
 * y de los términos. Si un `409 legal_version_mismatch` trae un par nuevo, las
 * casillas marcadas sobre el viejo ya no valen: aparecen desmarcadas, el botón
 * queda deshabilitado y un aviso dice que los documentos cambiaron. Antes
 * seguían marcadas y un segundo toque aceptaba el par nuevo sin haberlo visto.
 *
 * Los controles miden lo opuesto: un error que NO cambia el par (503 o red
 * caída) conserva las casillas. Sin ellos, «desmarcar siempre» pasaría por
 * arreglo.
 *
 * La fachada `api` se instrumenta desde la página (el mismo módulo que usa la
 * app en Vite dev), como hizo la PoC de Codex: sin servidor ni constancia real.
 */

const FLAG = 'payme.app.mock.legal_3_0_0.v1';
const HASH_B = 'b'.repeat(64);
const MAYOR = 'Declaro que tengo 18 años o más.';
const TERMINOS = /He leído y acepto los/;

type Fallo = 'mismatch' | '503' | 'red';
type Metodo = 'acceptLegal' | 'register' | 'googleRedirectSignup';

interface Espia {
  llamadas: Record<string, unknown>[];
  releyo: boolean;
}

const espia = (page: Page) => page.evaluate(() => (window as unknown as { __e2eLegal: Espia }).__e2eLegal);

/**
 * El primer envío falla con `fallo`. Con `mismatch`, la relectura posterior
 * devuelve términos 1.0.1 con otro hash: una publicación legítima mientras la
 * pantalla estaba abierta.
 */
async function instrumentar(page: Page, metodo: Metodo, fallo: Fallo): Promise<void> {
  await page.evaluate(async ({ metodo: m, fallo: f, hashB }) => {
    const apiRuta = '/src/api/index.ts';
    const httpRuta = '/src/api/http.ts';
    const { api } = await import(/* @vite-ignore */ apiRuta) as { api: Record<string, (...a: unknown[]) => Promise<unknown>> };
    const { HttpError } = await import(/* @vite-ignore */ httpRuta) as {
      HttpError: new (status: number, body: { error: string } | null) => Error;
    };
    const w = window as unknown as { __e2eLegal: Espia };
    w.__e2eLegal = { llamadas: [], releyo: false };
    const e = w.__e2eLegal;
    const nuevoPar = () => f === 'mismatch' && e.llamadas.length > 0;

    const getAcceptance = api.getLegalAcceptance.bind(api);
    api.getLegalAcceptance = async (...args: unknown[]) => {
      const r = await getAcceptance(...args) as { terminos: { version: string; hash: string } | null };
      if (!nuevoPar()) return r;
      e.releyo = true;
      return { ...r, terminos: { version: '1.0.1', hash: hashB } };
    };
    const getText = api.getLegalText.bind(api);
    api.getLegalText = async (...args: unknown[]) => {
      const r = await getText(...args) as { legal_text: Record<string, unknown> };
      if (args[0] !== 'terminos_uso' || !nuevoPar()) return r;
      e.releyo = true;
      return { legal_text: { ...r.legal_text, version: '1.0.1', hash: hashB, body: 'Términos sintéticos v2: una regla nueva.' } };
    };

    const original = api[m].bind(api);
    api[m] = async (...args: unknown[]) => {
      e.llamadas.push(args[0] as Record<string, unknown>);
      if (e.llamadas.length === 1) {
        if (f === 'mismatch') throw new HttpError(409, { error: 'legal_version_mismatch' });
        if (f === '503') throw new HttpError(503, { error: 'rate_limit_unavailable' });
        throw new TypeError('Failed to fetch');
      }
      // La puerta: el segundo envío la abre. El alta: el mock valida contra su
      // propio par (1.0.0), así que con el par nuevo se corta acá; lo que se
      // mide es QUÉ par viajó.
      if (m === 'acceptLegal') return { required: false, aviso: null, terminos: null };
      if (f === 'mismatch') throw new HttpError(503, { error: 'rate_limit_unavailable' });
      return original(...args);
    };
  }, { metodo, fallo, hashB: HASH_B });
}

const terminosDe = (cuerpo: Record<string, unknown>, metodo: 'acceptLegal' | 'register') => {
  const par = (metodo === 'register' ? cuerpo.legal_acceptance : cuerpo) as Record<string, unknown>;
  return { version: par.terminos_version, hash: par.terminos_hash };
};

test.describe('AF-01 · la puerta para quien ya tiene cuenta', () => {
  async function abrirPuerta(page: Page, fallo: Fallo) {
    await page.addInitScript((flag) => localStorage.setItem(flag, 'on'), FLAG);
    await page.goto('/');
    await instrumentar(page, 'acceptLegal', fallo);
    await page.getByLabel('Email', { exact: true }).fill('mati@payme.mx');
    await page.getByLabel('Contraseña', { exact: true }).fill('demo-e2e');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    const puerta = page.getByRole('dialog', { name: 'Actualizamos nuestros documentos' });
    await expect(puerta).toBeVisible();
    return {
      puerta,
      mayor: puerta.getByRole('checkbox', { name: MAYOR }),
      terminos: puerta.getByRole('checkbox', { name: TERMINOS }),
      continuar: puerta.getByRole('button', { name: 'Continuar', exact: true }),
    };
  }

  test('🔴 un 409 con un par nuevo desmarca las casillas, deshabilita «Continuar» y avisa', async ({ page }) => {
    const { puerta, mayor, terminos, continuar } = await abrirPuerta(page, 'mismatch');
    await mayor.check();
    await terminos.check();
    await continuar.click();
    // Testigo: la relectura trajo el par nuevo. Sin él, «no marcada» pasaría antes de tiempo.
    await expect.poll(async () => (await espia(page)).releyo).toBe(true);
    await expect(mayor).not.toBeChecked();
    await expect(terminos).not.toBeChecked();
    await expect(continuar).toBeDisabled();
    await expect(puerta.getByRole('alert')).toHaveText('Actualizamos los documentos. Vuelve a marcar las casillas y toca «Continuar».');

    // Marcar de nuevo, ahora sobre el par nuevo: es el que viaja.
    await mayor.check();
    await terminos.check();
    await continuar.click();
    await expect(puerta).toHaveCount(0);
    const { llamadas } = await espia(page);
    expect(llamadas).toHaveLength(2);
    expect(terminosDe(llamadas[0]!, 'acceptLegal').version).toBe('1.0.0');
    expect(terminosDe(llamadas[1]!, 'acceptLegal')).toEqual({ version: '1.0.1', hash: HASH_B });
  });

  for (const [fallo, texto] of [['503', 'No pudimos guardar tu confirmación. Prueba de nuevo.'], ['red', 'No pudimos guardar tu confirmación. Prueba de nuevo.']] as const) {
    test(`control · ${fallo} con el MISMO par: las casillas siguen marcadas`, async ({ page }) => {
      const { puerta, mayor, terminos, continuar } = await abrirPuerta(page, fallo);
      await mayor.check();
      await terminos.check();
      await continuar.click();
      // Testigo: el error ya se dijo (un reseteo iría junto con él).
      await expect(puerta.getByRole('alert')).toHaveText(texto);
      await expect(mayor).toBeChecked();
      await expect(terminos).toBeChecked();
      await expect(continuar).toBeEnabled();
      await continuar.click();
      await expect(puerta).toHaveCount(0);
      const { llamadas, releyo } = await espia(page);
      expect(releyo).toBe(false);
      expect(llamadas).toHaveLength(2);
      expect(terminosDe(llamadas[1]!, 'acceptLegal')).toEqual(terminosDe(llamadas[0]!, 'acceptLegal'));
    });
  }
});

test.describe('AF-01 · el alta por correo', () => {
  async function abrirAlta(page: Page, fallo: Fallo) {
    await page.addInitScript((flag) => {
      localStorage.setItem(flag, 'on');
      localStorage.setItem('payme.app.mock.public_signup.v1', 'true');
    }, FLAG);
    await page.goto('/');
    await page.getByRole('button', { name: 'Crea tu cuenta', exact: true }).click();
    await page.getByLabel('Nombre', { exact: true }).fill('Sintética');
    await page.getByLabel('Apellido', { exact: true }).fill('Auditora');
    await page.getByLabel('Email', { exact: true }).fill('alta-par@example.invalid');
    await page.getByLabel('Contraseña', { exact: true }).fill('solo-sintetica-1');
    const mayor = page.getByRole('checkbox', { name: MAYOR });
    const terminos = page.getByRole('checkbox', { name: TERMINOS });
    await expect(mayor).toBeVisible();
    await expect(terminos).toBeVisible();
    await instrumentar(page, 'register', fallo);
    return { mayor, terminos, registrarme: page.getByRole('button', { name: 'Registrarme', exact: true }) };
  }

  test('🔴 un 409 con un par nuevo desmarca las casillas, deshabilita «Registrarme» y avisa', async ({ page }) => {
    const { mayor, terminos, registrarme } = await abrirAlta(page, 'mismatch');
    await mayor.check();
    await terminos.check();
    await registrarme.click();
    await expect.poll(async () => (await espia(page)).releyo).toBe(true);
    // Testigo: las casillas volvieron a dibujarse con el par nuevo.
    await expect(mayor).toBeVisible();
    await expect(mayor).not.toBeChecked();
    await expect(terminos).not.toBeChecked();
    await expect(registrarme).toBeDisabled();
    await expect(page.getByRole('alert')).toHaveText('Actualizamos los documentos. Vuelve a marcar las casillas y toca «Registrarme».');

    await mayor.check();
    await terminos.check();
    await expect(registrarme).toBeEnabled();
    await registrarme.click();
    await expect.poll(async () => (await espia(page)).llamadas.length).toBe(2);
    const { llamadas } = await espia(page);
    expect(terminosDe(llamadas[0]!, 'register').version).toBe('1.0.0');
    expect(terminosDe(llamadas[1]!, 'register')).toEqual({ version: '1.0.1', hash: HASH_B });
  });

  for (const [fallo, texto] of [['503', 'Prueba de nuevo más tarde.'], ['red', 'No pudimos conectar. Prueba de nuevo.']] as const) {
    test(`control · ${fallo} con el MISMO par: las casillas siguen marcadas`, async ({ page }) => {
      const { mayor, terminos, registrarme } = await abrirAlta(page, fallo);
      await mayor.check();
      await terminos.check();
      await registrarme.click();
      await expect(page.getByRole('alert')).toHaveText(texto);
      await expect(mayor).toBeChecked();
      await expect(terminos).toBeChecked();
      await expect(registrarme).toBeEnabled();
      await registrarme.click();
      // El segundo envío es el mock real: crea la cuenta con el mismo par.
      await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
      const { llamadas, releyo } = await espia(page);
      expect(releyo).toBe(false);
      expect(llamadas).toHaveLength(2);
      expect(terminosDe(llamadas[1]!, 'register')).toEqual(terminosDe(llamadas[0]!, 'register'));
    });
  }
});

/**
 * El canje del alta con Google en redirect (wire D102) ya avisaba ante el 409,
 * pero tampoco desmarcaba. En la primera vuelta no se nota: el documento es
 * nuevo y las casillas arrancan vacías. Se nota con un SEGUNDO 409 en la misma
 * vista, que es este caso. Lo cubre el mismo arreglo del alta.
 */
test('AF-01 · Google en redirect: un segundo 409 con un par nuevo también desmarca', async ({ page }) => {
  const CONTEXTO = 'payme.app.google_alta_contexto.v1';
  await page.addInitScript(([flag, k]) => {
    if (sessionStorage.getItem('e2e.af01.preparado') !== '1') {
      sessionStorage.setItem('e2e.af01.preparado', '1');
      localStorage.setItem(flag, 'on');
      localStorage.setItem('payme.app.mock.public_signup.v1', 'true');
      localStorage.setItem('payme.app.mock.google_sin_cuenta.v1', 'true');
      localStorage.setItem('payme.app.mock.google_redirect.v1', 'true');
      localStorage.setItem('payme.app.mock.google_redirect_signup.v1', 'true');
    }
    // El primer 409: entre la ida y la vuelta cambió el par (como en google-alta-redirect).
    if (!location.hash.startsWith('#google_signup=')) return;
    const ctx = JSON.parse(sessionStorage.getItem(k) ?? 'null') as { legal_acceptance?: { aviso_hash: string } } | null;
    if (ctx?.legal_acceptance) {
      ctx.legal_acceptance.aviso_hash = 'f'.repeat(64);
      sessionStorage.setItem(k, JSON.stringify(ctx));
    }
  }, [FLAG, CONTEXTO] as const);
  const google = page.getByRole('button', { name: 'Continuar con Google', exact: true });
  const crearMiCuenta = page.getByRole('button', { name: 'Crear mi cuenta', exact: true });
  const mayor = page.getByRole('checkbox', { name: MAYOR });
  const terminos = page.getByRole('checkbox', { name: TERMINOS });
  const aviso = 'Actualizamos los documentos. Vuelve a marcar las casillas y toca «Crear mi cuenta».';

  await page.goto('/');
  await page.getByRole('button', { name: 'Crea tu cuenta', exact: true }).click();
  await expect(google).toHaveAttribute('data-ux-mode', 'redirect');
  await mayor.check();
  await terminos.check();
  await google.click();
  await expect(page.getByRole('alert')).toHaveText(aviso);
  await expect(crearMiCuenta).toBeDisabled();

  // Segunda vuelta en la misma vista: se marca sobre el par vigente, se publica
  // otro par y el canje vuelve a dar 409.
  await expect(mayor).toBeVisible();
  await mayor.check();
  await terminos.check();
  await expect(crearMiCuenta).toBeEnabled();
  await instrumentar(page, 'googleRedirectSignup', 'mismatch');
  await crearMiCuenta.click();
  await expect.poll(async () => (await espia(page)).releyo).toBe(true);
  await expect(page.getByRole('alert')).toHaveText(aviso);
  await expect(mayor).toBeVisible();
  await expect(mayor).not.toBeChecked();
  await expect(terminos).not.toBeChecked();
  await expect(crearMiCuenta).toBeDisabled();
});
