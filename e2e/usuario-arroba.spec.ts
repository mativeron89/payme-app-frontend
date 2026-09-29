import { expect, test, type Page } from '@playwright/test';
import { abrirMesaConLink, ingresar, irEnLaApp, tokenDeLaUrl } from './_app';

/**
 * AF-USUARIO-ARROBA · decisión 93 de Mati · el @usuario, lado de la app, con el
 * mock. Contrato: App Backend v2.137.0 (`a8987b06`), `docs/USERNAME_D93_WIRE.md`.
 *
 * - **Encendido**, que es lo que sirve el dueño desde la decisión 103 y el
 *   default del mock: la pantalla «Elige tu @usuario» después de la puerta
 *   legal, el cambio con los 30 días y la búsqueda en Amigos (3+ caracteres,
 *   hasta 5, foto con n164, nunca el mail), con la solicitud por @.
 * - **Apagado** (`payme.app.mock.username.v1 = 'false'`): la app no pide nada
 *   del @ ni muestra nada del @. Es la tolerancia si el dueño lo apaga.
 *
 * La cuenta demo del mock trae su @ (`mativeron`). Para ejercitar la pantalla
 * de elegirlo, `encender` la deja SIN @ (una vez por pestaña, así una recarga
 * no le borra el que eligió).
 */

const CLAVE_FLAG = 'payme.app.mock.username.v1';
const CLAVE_PROPIO = 'payme.app.mock.username_propio.v1';

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png` });
}

const DEMO = 'a0000000-0000-4000-8000-000000000001';

/** Encendido y con la cuenta demo SIN @, una sola vez por pestaña. */
async function encender(page: Page): Promise<void> {
  await page.addInitScript(({ flag, propio, demo }) => {
    localStorage.setItem(flag, 'true');
    if (sessionStorage.getItem('e2e.arroba.sin') === '1') return;
    sessionStorage.setItem('e2e.arroba.sin', '1');
    localStorage.setItem(propio, JSON.stringify({ [demo]: null }));
  }, { flag: CLAVE_FLAG, propio: CLAVE_PROPIO, demo: DEMO });
}

/** Apagado: lo que pasaría si el dueño volviera a apagarlo. */
async function apagar(page: Page): Promise<void> {
  await page.addInitScript((clave) => localStorage.setItem(clave, 'false'), CLAVE_FLAG);
}

/** Entra con la cuenta demo SIN esperar Inicio: encendido, primero va la puerta. */
async function entrar(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill('mati@payme.mx');
  await page.getByLabel('Contraseña', { exact: true }).fill('demo-e2e');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

/**
 * Le pone un @ a la cuenta de la sesión, cambiado hace `diasAtras` días (el
 * mock lo guarda por titular). Después recarga para que la app lo lea.
 */
async function conArroba(page: Page, username: string, diasAtras: number): Promise<void> {
  await page.evaluate(async ({ clave, username, diasAtras }) => {
    const ruta = '/src/api/storage.ts';
    const { loadSession } = await import(/* @vite-ignore */ ruta) as { loadSession: () => { principal_id: string } | null };
    const principal = loadSession()!.principal_id;
    const todos = JSON.parse(localStorage.getItem(clave) ?? '{}') as Record<string, unknown>;
    todos[principal] = { username, changed_at: new Date(Date.now() - diasAtras * 86_400_000).toISOString() };
    localStorage.setItem(clave, JSON.stringify(todos));
  }, { clave: CLAVE_PROPIO, username, diasAtras });
}

/** Cuenta (y guarda los argumentos de) las llamadas del @ a la fachada, sin sustituirlas. */
async function espiarArroba(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as { api: Record<string, (...a: unknown[]) => Promise<unknown>> };
    const w = window as unknown as { __arroba: Record<string, unknown[][]> };
    w.__arroba = {};
    for (const m of ['getUsername', 'getUsernameSuggestion', 'putUsername', 'searchUsernames', 'getUsernameAvatar', 'addFriend']) {
      const original = api[m]!.bind(api);
      w.__arroba[m] = [];
      api[m] = async (...a: unknown[]) => { w.__arroba[m]!.push(a.slice(0, 1)); return original(...a); };
    }
  });
}

/** Decisión 110: el único lápiz, «Editar perfil», abre foto, nombre y @ juntos. */
const lapiz = (page: Page) => page.getByRole('button', { name: 'Editar perfil', exact: true });
const campoArroba = (page: Page) => page.getByRole('form', { name: 'Editar perfil' }).getByLabel('Tu @usuario');

const llamadas = (page: Page, metodo: string) => page.evaluate(
  (m) => (window as unknown as { __arroba: Record<string, unknown[][]> }).__arroba[m] ?? [],
  metodo,
);

async function abrirAgregarAmigo(page: Page): Promise<void> {
  await irEnLaApp(page, '/amigos');
  await page.getByRole('button', { name: 'Nuevo amigo' }).click();
  await expect(page.getByPlaceholder('Email', { exact: true })).toBeVisible();
}

test.describe('AF-USUARIO-ARROBA · apagado (tolerancia si el dueño lo apaga)', () => {
  test('cero cambios: sin puerta, sin fila en Configuración, sin búsqueda por @, y ninguna llamada del @', async ({ page }) => {
    await apagar(page);
    await ingresar(page);
    // El dueño publica el bloque apagado; la app lo lee y no hace nada.
    const config = await page.evaluate(async () => {
      const ruta = '/src/api/index.ts';
      const { api } = await import(/* @vite-ignore */ ruta) as { api: { getConfig: () => Promise<{ features: Record<string, unknown> }> } };
      return (await api.getConfig()).features.username;
    });
    expect(config).toEqual({ supported: true, enabled: false });
    await espiarArroba(page);

    // Salir y volver a entrar SIN recargar: el espía sigue puesto y ve lo que
    // la app pide al entrar, que es donde consultaría la pantalla del @.
    await irEnLaApp(page, '/mas');
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await page.getByLabel('Email', { exact: true }).fill('mati@payme.mx');
    await page.getByLabel('Contraseña', { exact: true }).fill('demo-e2e');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Elige tu @usuario' })).toHaveCount(0);
    await irEnLaApp(page, '/mas');
    await expect(page.getByRole('heading', { name: 'Configuración' })).toBeVisible();
    await expect(page.getByText('Tu @usuario')).toHaveCount(0);
    await expect(page.locator('.profile-name-line')).toBeVisible();
    await expect(page.locator('.profile-arroba')).toHaveCount(0);
    // Decisión 110: el lápiz queda por el nombre y la foto, pero adentro no hay @.
    await lapiz(page).click();
    await expect(page.getByRole('form', { name: 'Editar perfil' }).getByLabel('Nombre', { exact: true })).toBeVisible();
    await expect(page.getByText('Tu @usuario')).toHaveCount(0);
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();

    await abrirAgregarAmigo(page);
    await expect(page.getByLabel('Buscar por @usuario')).toHaveCount(0);
    await expect(page.locator('.arroba-buscar')).toHaveCount(0);

    for (const m of ['getUsername', 'getUsernameSuggestion', 'putUsername', 'searchUsernames', 'getUsernameAvatar']) {
      expect(await llamadas(page, m), m).toEqual([]);
    }
  });
});

test.describe('AF-USUARIO-ARROBA · encendido · la puerta «Elige tu @usuario»', () => {
  test('aparece al entrar sin @, propone el sugerido, valida mientras se escribe y no deja seguir sin uno válido', async ({ page }) => {
    await encender(page);
    await entrar(page);
    const titulo = page.getByRole('heading', { name: 'Elige tu @usuario' });
    await expect(titulo).toBeVisible();
    // No se entra a la app sin @.
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toHaveCount(0);

    const campo = page.getByLabel('Tu @usuario', { exact: true });
    const continuar = page.getByRole('button', { name: 'Continuar', exact: true });
    await expect(campo).toHaveValue('mativeron');
    await expect(continuar).toBeEnabled();
    await capturar(page, 'arroba-01-puerta');

    for (const [texto, mensaje] of [
      ['ma', 'Mínimo 3 caracteres.'],
      ['mati veron', 'Sólo minúsculas, números, punto y guion bajo.'],
      ['mati-veron', 'Sólo minúsculas, números, punto y guion bajo.'],
      ['.mati', 'No puede empezar ni terminar con punto.'],
      ['a'.repeat(21), 'Máximo 20 caracteres.'],
    ] as const) {
      await campo.fill(texto);
      await expect(page.getByText(mensaje, { exact: true }), texto).toBeVisible();
      await expect(continuar, texto).toBeDisabled();
    }
    // Mayúsculas y una @ adelante valen: se normalizan como en el dueño.
    await campo.fill('@Mati.Veron');
    await expect(continuar).toBeEnabled();
    await capturar(page, 'arroba-02-puerta-validacion');
  });

  test('un @ tomado o reservado dice «Ese @ no está disponible.»; uno libre entra a la app y no vuelve a pedirse', async ({ page }) => {
    await encender(page);
    await entrar(page);
    const campo = page.getByLabel('Tu @usuario', { exact: true });
    const continuar = page.getByRole('button', { name: 'Continuar', exact: true });
    await expect(campo).toHaveValue('mativeron');

    for (const ocupado of ['mariana', 'paymeoficial', 'admin']) {
      await campo.fill(ocupado);
      await continuar.click();
      await expect(page.getByRole('alert'), ocupado).toHaveText('Ese @ no está disponible.');
    }
    await capturar(page, 'arroba-03-puerta-no-disponible');

    await campo.fill('@Mati.Veron');
    await continuar.click();
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Elige tu @usuario' })).toHaveCount(0);
    await irEnLaApp(page, '/mas');
    await expect(page.locator('.profile-arroba')).toHaveText('@mati.veron');
  });

  test('va DESPUÉS de la puerta legal: primero se acepta el Aviso, después se elige el @', async ({ page }) => {
    await encender(page);
    await page.addInitScript(() => localStorage.setItem('payme.app.mock.legal_3_0_0.v1', 'on'));
    await entrar(page);
    await expect(page.getByRole('heading', { name: 'Actualizamos nuestros documentos' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Elige tu @usuario' })).toHaveCount(0);
    await page.getByLabel('Declaro que tengo 18 años o más.').check();
    await page.getByRole('checkbox', { name: /He leído y acepto los/ }).check();
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Elige tu @usuario' })).toBeVisible();
  });

  test('«Cerrar sesión» es la otra salida', async ({ page }) => {
    await encender(page);
    await entrar(page);
    await expect(page.getByRole('heading', { name: 'Elige tu @usuario' })).toBeVisible();
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  });
});

test.describe('AF-USUARIO-ARROBA · encendido · cambiar el @ con el límite de 30 días', () => {
  test('con el último cambio hace más de 30 días el lápiz lo cambia, y después dice desde cuándo se puede de nuevo', async ({ page }) => {
    await encender(page);
    await ingresarConArroba(page, 'mati.viejo', 40);
    await irEnLaApp(page, '/mas');
    await expect(page.locator('.profile-arroba')).toHaveText('@mati.viejo');
    await lapiz(page).click();
    const campo = campoArroba(page);
    await expect(campo).toHaveValue('mati.viejo');
    await capturar(page, 'arroba-04-config-cambiar');

    await campo.fill('mariana');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    // El error queda en el @, con el formulario abierto y lo escrito intacto.
    await expect(page.getByRole('alert')).toHaveText('Ese @ no está disponible.');
    await expect(campo).toHaveValue('mariana');

    await campo.fill('mati.nuevo');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.locator('.profile-arroba')).toHaveText('@mati.nuevo');
    await expect(page.getByText('Perfil actualizado ✓')).toBeVisible();
    // Decisión 106: la fecha no queda escrita; la dice «Editar perfil», y el @ ya no se edita.
    await expect(page.getByText(/Puedes volver a cambiar/)).toHaveCount(0);
    await lapiz(page).click();
    await expect(page.getByText(/^Puedes volver a cambiar tu @ desde el \d{1,2} de [a-z]+\.$/)).toBeVisible();
    await expect(campoArroba(page)).toHaveCount(0);
    await capturar(page, 'arroba-05-config-cambiado');
  });

  test('antes de los 30 días el lápiz no abre el cambio: dice la fecha del dueño', async ({ page }) => {
    await encender(page);
    await ingresarConArroba(page, 'mati.reciente', 5);
    await irEnLaApp(page, '/mas');
    await expect(page.locator('.profile-arroba')).toHaveText('@mati.reciente');
    // Decisión 106: sin tarjeta, y la fecha no queda escrita a la vista.
    await expect(page.getByText('Tu @usuario')).toHaveCount(0);
    await expect(page.getByText(/Puedes volver a cambiar/)).toHaveCount(0);
    await lapiz(page).click();
    const esperada = await page.evaluate(() => new Intl.DateTimeFormat('es-MX', {
      day: 'numeric', month: 'long', timeZone: 'America/Mexico_City',
    }).format(new Date(Date.now() + 25 * 86_400_000)));
    await expect(page.getByText(`Puedes volver a cambiar tu @ desde el ${esperada}.`)).toBeVisible();
    // Se ve, no se edita.
    await expect(page.getByRole('form', { name: 'Editar perfil' }).getByText('@mati.reciente')).toBeVisible();
    await expect(campoArroba(page)).toHaveCount(0);
    await capturar(page, 'arroba-06-config-30-dias');
  });

  test('si el dueño contesta «demasiado pronto» al guardar, el error queda en el @ con SU fecha y el @ deja de editarse', async ({ page }) => {
    await encender(page);
    await ingresarConArroba(page, 'mati.viejo', 40);
    await irEnLaApp(page, '/mas');
    await lapiz(page).click();
    // Entre que se abrió el editor y se guardó, el @ cambió en otro lado hace 2 días.
    await conArroba(page, 'mati.otro', 2);
    await campoArroba(page).fill('mati.nuevo');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    const esperada = await page.evaluate(() => new Intl.DateTimeFormat('es-MX', {
      day: 'numeric', month: 'long', timeZone: 'America/Mexico_City',
    }).format(new Date(Date.now() + 28 * 86_400_000)));
    // Decisión 110: el error queda EN el @ (una sola vez), con el formulario abierto.
    await expect(page.getByRole('alert')).toHaveText(`Puedes volver a cambiar tu @ desde el ${esperada}.`);
    await expect(page.getByText(/Puedes volver a cambiar/)).toHaveCount(1);
    await expect(campoArroba(page)).toHaveCount(0);
    // Y muestra el @ que realmente tiene ahora, no el que tenía al abrir.
    await expect(page.getByRole('form', { name: 'Editar perfil' }).getByText('@mati.otro')).toBeVisible();
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(page.locator('.profile-arroba')).toHaveText('@mati.otro');
  });
});

/** Ingresa con la cuenta demo ya con @ (flag apagado para el ingreso, después encendido). */
async function ingresarConArroba(page: Page, username: string, diasAtras: number): Promise<void> {
  await entrar(page);
  // Encendido y sin @, la puerta aparece: se le pone el @ y se recarga.
  await expect(page.getByRole('heading', { name: 'Elige tu @usuario' })).toBeVisible();
  await conArroba(page, username, diasAtras);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
}

test.describe('AF-USUARIO-ARROBA · encendido · buscar por @ en Amigos', () => {
  test.beforeEach(async ({ page }) => {
    await encender(page);
    await ingresarConArroba(page, 'mati.veron', 40);
    await abrirAgregarAmigo(page);
    await espiarArroba(page);
  });

  test('desde 3 caracteres, con espera: hasta 5 resultados, con nombre, @ y foto; nunca el mail', async ({ page }) => {
    const buscar = page.getByLabel('Buscar por @usuario');
    await expect(buscar).toBeVisible();
    // La búsqueda por correo o ID de siempre sigue ahí.
    await expect(page.getByPlaceholder('Email', { exact: true })).toBeVisible();

    await buscar.fill('ma');
    await expect(page.getByText('Escribe al menos 3 letras de su @.')).toBeVisible();
    await page.waitForTimeout(600);
    expect(await llamadas(page, 'searchUsernames')).toEqual([]);

    // Escribir seguido consulta UNA vez, con lo último escrito: «mar», «mari»
    // y «mario» son consultables, y sólo viaja «mario».
    await buscar.fill('');
    await buscar.pressSequentially('mario', { delay: 60 });
    const filas = page.locator('.arroba-resultado');
    await expect(filas).toHaveCount(1);
    expect(await llamadas(page, 'searchUsernames')).toEqual([['mario']]);

    await buscar.fill('mar');
    await expect(filas).toHaveCount(5);
    expect(await llamadas(page, 'searchUsernames')).toEqual([['mario'], ['mar']]);
    expect(await filas.evaluateAll((ls) => ls.map((l) => l.getAttribute('data-username'))))
      .toEqual(['marcelo', 'marcos_d', 'maria.ruiz', 'mariana', 'mario.g']);
    await expect(filas.filter({ hasText: '@mariana' })).toContainText('Mariana Gómez');

    // Foto sólo de las que el dueño dice mostrables; el resto, iniciales.
    await expect(filas.filter({ hasText: '@mariana' }).locator('img.friend-avatar-image')).toHaveCount(1);
    await expect(filas.filter({ hasText: '@mario.g' }).locator('img.friend-avatar-image')).toHaveCount(1);
    await expect(filas.filter({ hasText: '@marcelo' }).locator('img')).toHaveCount(0);
    // A qué @ se le pidió la foto (el conjunto: en desarrollo, StrictMode monta
    // dos veces cada efecto y la misma foto se pide dos veces).
    expect([...new Set((await llamadas(page, 'getUsernameAvatar')).map((a) => a[0]))].sort())
      .toEqual(['mariana', 'mario.g']);

    // El mail nunca: ni en pantalla ni en lo que llegó.
    const texto = await page.locator('.arroba-buscar').innerText();
    expect(texto).not.toMatch(/@[a-z0-9.-]+\.(com|mx)/i);
    expect(texto).not.toContain('payme_mx_');
    await capturar(page, 'arroba-07-busqueda');
  });

  test('regla de n164: la cuenta menor aparece sin foto y su foto ni se pide', async ({ page }) => {
    await page.getByLabel('Buscar por @usuario').fill('mart');
    const filas = page.locator('.arroba-resultado');
    await expect(filas).toHaveCount(2);
    const martina = filas.filter({ hasText: '@martina' });
    await expect(martina).toContainText('Martina Pérez');
    await expect(martina.locator('img')).toHaveCount(0);
    await expect(martina.locator('.avatar')).toBeVisible();
    expect((await llamadas(page, 'getUsernameAvatar')).map((a) => a[0])).not.toContain('martina');
    await capturar(page, 'arroba-08-busqueda-menor');
  });

  test('«Agregar» manda la solicitud por @ con el cuerpo exacto y la fila queda «Enviada»', async ({ page }) => {
    await page.getByLabel('Buscar por @usuario').fill('val');
    await expect(page.locator('.arroba-resultado')).toHaveCount(1);
    await page.getByRole('button', { name: 'Agregar a @valentina.rios' }).click();
    const enviada = page.getByRole('button', { name: 'Solicitud enviada a @valentina.rios' });
    await expect(enviada).toBeDisabled();
    await expect(enviada).toHaveText('Enviada');
    expect(await llamadas(page, 'addFriend')).toEqual([[{ username: 'valentina.rios' }]]);
    await capturar(page, 'arroba-09-solicitud');
  });

  test('sin resultados y con el límite por cuenta (429), lo dice sin inventar', async ({ page }) => {
    const buscar = page.getByLabel('Buscar por @usuario');
    await buscar.fill('zzz');
    await expect(page.getByText('No encontramos a nadie con ese @.')).toBeVisible();

    await page.evaluate(async () => {
      const rutaApi = '/src/api/index.ts';
      const rutaMock = '/src/api/mock/mockApi.ts';
      const { api } = await import(/* @vite-ignore */ rutaApi) as { api: Record<string, unknown> };
      const { MockApiError } = await import(/* @vite-ignore */ rutaMock) as {
        MockApiError: new (status: number, error: string) => Error;
      };
      api.searchUsernames = async () => { throw new MockApiError(429, 'too_many_requests'); };
    });
    await buscar.fill('mar');
    await expect(page.getByText('Hiciste muchas búsquedas seguidas. Espera un momento.')).toBeVisible();
    await expect(page.locator('.arroba-resultado')).toHaveCount(0);
  });
});

/**
 * El link de invitación también pasa por la pantalla del @ (wire §3: legal → @
 * → app), con la misma custodia del token que la puerta legal
 * (`puerta-join.spec.ts`). «Unido» se mide en el dueño mock.
 */
test.describe('AF-USUARIO-ARROBA · encendido · el link de invitación', () => {
  async function unido(page: Page, code: string): Promise<boolean> {
    return page.evaluate(async (c) => {
      const ruta = '/src/api/mock/store.ts';
      const store = await import(/* @vite-ignore */ ruta) as { state: { joinedMesaCodes: string[] } };
      return store.state.joinedMesaCodes.includes(c);
    }, code);
  }

  test('sin @, la pantalla sale ANTES del canje, conserva el token y al elegirlo se une', async ({ page }) => {
    await ingresar(page);
    const mesa = await abrirMesaConLink(page);
    // Desde acá, la cuenta demo no tiene @.
    await page.evaluate(({ propio, demo }) => localStorage.setItem(propio, JSON.stringify({ [demo]: null })),
      { propio: CLAVE_PROPIO, demo: DEMO });
    await page.goto('about:blank');
    await page.goto(`/#/mesa/${mesa.code}?t=${mesa.token}`);

    await expect(page.getByRole('heading', { name: 'Elige tu @usuario' })).toBeVisible();
    await page.waitForTimeout(1500);
    expect(await unido(page, mesa.code), 'se unió a la mesa sin elegir su @').toBe(false);
    const custodiado = await page.evaluate(() => window.sessionStorage.getItem('payme_pending_invitation_link'));
    expect(custodiado !== null || tokenDeLaUrl(page.url()) === mesa.token).toBe(true);

    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByText('¡Te sumaste a la mesa!')).toBeVisible();
    expect(await unido(page, mesa.code)).toBe(true);
  });

  test('428 username_required en el canje: abre la pantalla del @ (aunque la config se leyó apagada), no «Reintentar», y retoma', async ({ page }) => {
    // La config se lee APAGADA al entrar; después el dueño enciende la bandera
    // y contesta 428 al canje mientras la cuenta no tenga @.
    await page.addInitScript((clave) => {
      if (sessionStorage.getItem('e2e.arroba.428') === '1') return;
      sessionStorage.setItem('e2e.arroba.428', '1');
      localStorage.setItem(clave, 'false');
    }, CLAVE_FLAG);
    await ingresar(page);
    const mesa = await abrirMesaConLink(page);
    await page.evaluate(({ flag, propio, demo }) => {
      localStorage.setItem(flag, 'true');
      localStorage.setItem(propio, JSON.stringify({ [demo]: null }));
    }, { flag: CLAVE_FLAG, propio: CLAVE_PROPIO, demo: DEMO });
    await page.evaluate(async (claveProp) => {
      const idx = '/src/api/index.ts';
      const http = '/src/api/http.ts';
      const m = await import(/* @vite-ignore */ idx) as { api: Record<string, (...a: unknown[]) => Promise<unknown>> };
      const h = await import(/* @vite-ignore */ http) as { HttpError: new (s: number, b: unknown) => Error };
      const original = m.api.acceptInvitationLink.bind(m.api);
      m.api.acceptInvitationLink = async (...args: unknown[]) => {
        const w = window as unknown as { __canjes?: number };
        w.__canjes = (w.__canjes ?? 0) + 1;
        const propios = JSON.parse(localStorage.getItem(claveProp) ?? '{}') as Record<string, unknown>;
        if (!Object.values(propios).some((v) => v !== null)) throw new h.HttpError(428, { error: 'username_required' });
        return original(...args);
      };
    }, CLAVE_PROPIO);
    await page.evaluate(([c, t]) => { window.location.hash = `#/mesa/${c}?t=${t}`; }, [mesa.code, mesa.token] as const);

    await expect(page.getByRole('heading', { name: 'Elige tu @usuario' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reintentar', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __canjes?: number }).__canjes ?? 0)).toBeGreaterThan(0);
    expect(await unido(page, mesa.code)).toBe(false);

    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByText('¡Te sumaste a la mesa!')).toBeVisible();
    expect(await unido(page, mesa.code)).toBe(true);
  });
});
