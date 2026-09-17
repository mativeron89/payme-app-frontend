import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * APP-LOGIN-REDESIGN-AF-02-20260917 · LA VISTA PREVIA PARA MATI.
 *
 * No es una guarda de conducta: la única razón de este archivo es que Mati vea
 * la pantalla antes que nadie toque otra cosa. Corre contra el riel mock, que
 * es el único lugar donde los botones sociales se ven —en producción `/api/config`
 * los trae apagados y la pantalla, correctamente, no los muestra—.
 *
 * ## Los estados degradados se fuerzan PARCHEANDO LA FACHADA, no dibujándolos
 *
 * `mockLogin` no rechaza nunca: acepta cualquier email y cualquier contraseña.
 * Así que un «credencial incorrecta» del mock puro no existe, y pintarlo a mano
 * en una captura sería enseñarle a Mati un estado que el código no produce.
 *
 * Lo que se hace es reemplazar `api.login` en la página por una que rechaza con
 * el `MockApiError` real, y dejar que el componente recorra su camino de
 * verdad: `onSubmit` → `catch` → `extractApiError` → `ERROR_TEXT` → el mensaje.
 * Lo que sale en la foto lo puso la pantalla, no el test. Es el mismo idioma que
 * `af-diseno-02.spec.ts` ya usa para forzar un total detectado.
 *
 * `AF_CAPTURES_DIR` decide si se guardan archivos. Sin esa variable el spec
 * igual corre y sigue afirmando que cada estado APARECE: así no se pudre en
 * silencio cuando nadie está sacando fotos.
 */

const CAPTURES_DIR = process.env.AF_CAPTURES_DIR;

const MOVIL = { width: 390, height: 844 };
const ESCRITORIO = { width: 1280, height: 900 };

async function capturar(page: Page, nombre: string): Promise<void> {
  // La fuente tiene que estar cargada antes de la foto: si no, la primera
  // captura sale con la tipografía de fallback y las medidas no son las del
  // diseño. Dos rAF después, el layout ya está estable.
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  if (!CAPTURES_DIR) return;
  mkdirSync(CAPTURES_DIR, { recursive: true });
  await page.screenshot({
    path: join(CAPTURES_DIR, nombre),
    fullPage: true,
    animations: 'disabled',
  });
}

/** Reemplaza `api.login` por una que rechaza con el error REAL del mock. */
async function loginRechaza(page: Page, codigo: string): Promise<void> {
  await page.evaluate(async (code) => {
    const ruta = '/src/api/index.ts';
    const rutaMock = '/src/api/mock/mockApi.ts';
    const modulo = await import(/* @vite-ignore */ ruta);
    const { MockApiError } = await import(/* @vite-ignore */ rutaMock);
    // 🔴 La firma es `MockApiError(status, error)` — en ese orden. Tenerla al
    // revés hacía que el código llegara como "401", cayera en el mensaje
    // genérico, y que el test del fallo de conexión pasara POR LA CAUSA
    // EQUIVOCADA: esperaba el genérico y lo recibía, pero nunca por su código.
    modulo.api.login = async () => { throw new MockApiError(401, code); };
  }, codigo);
}

/** `api.login` que no resuelve nunca: deja la pantalla en «entrando». */
async function loginColgado(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const ruta = '/src/api/index.ts';
    const modulo = await import(/* @vite-ignore */ ruta);
    modulo.api.login = () => new Promise(() => { /* nunca resuelve, a propósito */ });
  });
}

async function intentarEntrar(page: Page): Promise<void> {
  await page.getByPlaceholder('Email').fill('mati@payme.mx');
  await page.getByPlaceholder('Contraseña').fill('contrasena-de-prueba');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

for (const [medida, viewport] of [['movil', MOVIL], ['escritorio', ESCRITORIO]] as const) {
  test.describe(`vista previa del login · ${medida}`, () => {
    test.use({ viewport, deviceScaleFactor: 2 });

    test('estado normal · la tarjeta trae el orden del paquete', async ({ page }) => {
      await page.goto('/');
      // 🔴 Esperar el campo de email NO alcanza: está desde el primer render,
      // mientras que los botones sociales dependen de `/api/config`, que llega
      // un tick después. Con el email como única espera, esta lectura del orden
      // corría a veces ANTES de que el bloque social existiera y devolvía tres
      // elementos en vez de siete. Se espera lo último que aparece.
      await expect(page.locator('.social-provider-facebook')).toBeVisible();

      // El orden de §2 se afirma, no se confía a la foto: una captura linda con
      // el orden viejo pasaría desapercibida.
      const orden = await page.evaluate(() => Array.from(
        document.querySelectorAll('.ingreso-tarjeta .ingreso-etiqueta, .ingreso-entrar, .ingreso-olvido-boton, .social-auth-divider span, .social-provider-google, .social-provider-facebook'),
      ).map((n) => (n.textContent ?? '').trim()));
      expect(orden).toEqual([
        'Email',
        'Contraseña',
        'Entrar',
        '¿Olvidaste tu contraseña?',
        'O continúa con',
        'Continuar con Google',
        'Continuar con Facebook',
      ]);

      // §5 · el pago como invitado NO está, ni apagado.
      await expect(page.getByText('invitado', { exact: false })).toHaveCount(0);

      await capturar(page, `login-01-normal-${medida}.png`);
    });

    test('credencial incorrecta · borde ámbar en los dos campos y mensaje obligatorio', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByPlaceholder('Email')).toBeVisible();
      await loginRechaza(page, 'invalid_credentials');
      await intentarEntrar(page);

      const mensaje = page.getByText('Email o contraseña incorrectos.', { exact: true });
      await expect(mensaje).toBeVisible();
      // El color nunca viaja solo: el mensaje es la parte obligatoria.
      await expect(page.getByPlaceholder('Email')).toHaveAttribute('aria-invalid', 'true');
      await expect(page.getByPlaceholder('Contraseña')).toHaveAttribute('aria-invalid', 'true');
      // Y el mensaje va DEBAJO del botón, que es lo que pide §5.
      expect(await page.evaluate(() => {
        const boton = document.querySelector('.ingreso-entrar');
        const error = document.querySelector('#login-error');
        if (!boton || !error) return 'falta uno de los dos';
        return boton.compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING
          ? 'el error va después del botón' : 'el error va antes del botón';
      })).toBe('el error va después del botón');

      await capturar(page, `login-02-credencial-incorrecta-${medida}.png`);
    });

    test('entrando · el botón queda ocupado y la tarjeta bloqueada', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByPlaceholder('Email')).toBeVisible();
      await loginColgado(page);
      await intentarEntrar(page);

      await expect(page.getByRole('button', { name: 'Un segundo…', exact: true })).toBeDisabled();
      await expect(page.getByPlaceholder('Email')).toBeDisabled();
      await expect(page.getByPlaceholder('Contraseña')).toBeDisabled();

      await capturar(page, `login-03-entrando-${medida}.png`);
    });

    test('fallo de conexión · el mensaje genérico, sin afirmar que la cuenta no existe', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByPlaceholder('Email')).toBeVisible();
      await loginRechaza(page, 'network_down');
      await intentarEntrar(page);

      await expect(page.getByText('No pudimos conectar. Prueba de nuevo.', { exact: true })).toBeVisible();
      // Control que discrimina: si el código volviera a perderse por el camino,
      // los dos estados dirían lo mismo y este spec no lo notaría.
      await expect(page.getByText('Email o contraseña incorrectos.', { exact: true })).toHaveCount(0);
      await capturar(page, `login-04-sin-conexion-${medida}.png`);
    });

    test('con el alta abierta aparece el pie «¿Primera vez? Crea tu cuenta»', async ({ page }) => {
      // Seam del mock, el mismo que usa `alta-publica.spec.ts`: es la bandera
      // del dueño, no una preferencia de la persona. Con el alta cerrada —que
      // es el default y lo que hoy publica producción— este pie NO existe, y
      // eso es conducta que el rediseño no cambia.
      await page.addInitScript(() => {
        localStorage.setItem('payme.app.mock.public_signup.v1', 'true');
      });
      await page.goto('/');
      await expect(page.getByPlaceholder('Email')).toBeVisible();
      await expect(page.getByText('¿Primera vez?', { exact: false })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Crea tu cuenta', exact: true })).toBeVisible();
      await capturar(page, `login-05-alta-abierta-${medida}.png`);
    });
  });
}
