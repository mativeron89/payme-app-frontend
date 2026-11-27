import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { omitirGuiaEnFixture } from './_app';
import { conRecursoRetenido } from './_recursoRetenido';

type Estado = 'never' | 'revoked' | 'granted';
type Opcion = { foto: Estado; analisis: Estado; alta?: boolean; fallo?: boolean; retener?: boolean; arroba?: boolean; lecturaFallida?: 'foto' | 'analisis'; esperarRetiro?: boolean };

async function preparar(page: Page, opciones: Opcion) {
  await page.setViewportSize({ width: 320, height: 740 });
  await omitirGuiaEnFixture(page);
  await page.addInitScript(arroba => {
    localStorage.setItem('payme.app.mock.legal_3_0_0.v1', 'on');
    localStorage.setItem('payme.app.mock.public_signup.v1', 'true');
    localStorage.setItem('payme.app.mock.username.v1', String(arroba));
    localStorage.setItem('payme.app.mock.sugerencias.v1', 'encendido');
  }, opciones.arroba !== false);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  await page.evaluate(async o => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api');
    const eventos: string[] = [];
    Object.assign(window, { eventosPermisos: eventos });
    const config = api.getConfig.bind(api);
    api.getConfig = async () => {
      const c = await config();
      return { ...c, features: { ...c.features, foto_perfil_no_amigos: { supported: true, enabled: true } } };
    };
    const documento = await api.getPrivacyNotice();
    const texto = documento.legal_text;
    // Una lectura para un otorgamiento se resuelve en la misma cola de microtareas.
    api.getPrivacyNotice = async () => documento;
    const vigente = { version: texto.version, hash: texto.hash };
    const aceptada = () => ({ required: false, aviso: null, terminos: null });
    let requiere = !o.alta;
    api.getLegalAcceptance = async () => requiere ? { required: true, aviso: vigente, terminos: vigente } : aceptada();
    api.acceptLegal = async () => { requiere = !!o.esperarRetiro; eventos.push('aceptó'); return aceptada(); };
    const foto = () => ({ purpose_key: 'foto_perfil_no_amigos' as const, state: o.foto, granted: o.foto === 'granted',
      since: null, notice_version: null, notice_hash: null });
    const analisis = () => ({ purpose_key: 'analisis_interno' as const, state: o.analisis, granted: o.analisis === 'granted' });
    api.getFotoPerfilNoAmigos = async () => {
      if (o.lecturaFallida === 'foto') throw Error('lectura de foto');
      return foto();
    };
    api.getConsentimiento = async () => {
      if (o.lecturaFallida === 'analisis') throw Error('lectura de análisis');
      if (o.retener) await fetch('/prueba-estado-permiso');
      return analisis();
    };
    api.revokeConsentimiento = async () => {
      if (o.esperarRetiro) await fetch('/prueba-retirar-analisis');
      eventos.push('retira análisis');
      if (o.fallo) throw Error('rechazado');
      o.analisis = 'revoked';
      return analisis();
    };
    api.revokeFotoPerfilNoAmigos = async () => { eventos.push('retira foto'); o.foto = 'revoked'; return foto(); };
    api.grantFotoPerfilNoAmigos = async aviso => {
      if (aviso.hash !== texto.hash || aviso.version !== texto.version) throw Error('par incorrecto');
      eventos.push('otorga foto');
      if (o.fallo) throw Error('rechazado');
      o.foto = 'granted';
      return foto();
    };
    api.grantConsentimiento = async (f, aviso) => {
      if (f !== 'analisis_interno' || aviso.hash !== texto.hash || aviso.version !== texto.version) throw Error('par incorrecto');
      eventos.push('otorga análisis');
      if (o.fallo) throw Error('rechazado');
      o.analisis = 'granted';
      return analisis();
    };
    if (o.alta) {
      let username: string | null = null;
      api.getUsername = async () => ({ required: !username, username, next_change_at: null });
      api.putUsername = async nombre => {
        await fetch('/prueba-guardar-arroba');
        username = nombre;
        eventos.push('guardó @');
        return { required: false, username: nombre, next_change_at: null };
      };
    }
  }, opciones);
}

const eventos = (page: Page) => page.evaluate(() =>
  (window as unknown as { eventosPermisos: string[] }).eventosPermisos);

async function marcarTerminos(page: Page) {
  await page.getByRole('checkbox', { name: 'Declaro que tengo 18 años o más.' }).check();
  await page.getByRole('checkbox', { name: /He leído y acepto/ }).check();
}
async function ingresar(page: Page, email = 'persona@example.invalid') {
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill('demo-local');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}
async function captura(page: Page, info: TestInfo, nombre: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.screenshot({ path: info.outputPath(nombre + '.png') });
}
const foto = (p: Page) => p.getByRole('checkbox', { name: 'Mostrar mi foto', exact: true });
const analisis = (p: Page) => p.getByRole('checkbox', { name: 'Análisis interno', exact: true });

for (const caso of [
  { foto: 'never', analisis: 'revoked', nombre: 'un permiso nuevo y un retiro previo', escritos: ['otorga foto'] },
  { foto: 'revoked', analisis: 'never', nombre: 'retirar la marca inicial y elegir el permiso retirado', cambiar: true, escritos: ['otorga foto'] },
  { foto: 'granted', analisis: 'granted', nombre: 'mantener un permiso y retirar el otro', cambiar: true, escritos: ['retira análisis'] },
] as const) {
  test(caso.nombre, async ({ page }, info) => {
    const esperarRetiro = caso.foto === 'granted';
    await preparar(page, { ...caso, retener: true, esperarRetiro });
    await conRecursoRetenido(page, '**/prueba-estado-permiso', async () => {
      await ingresar(page);
      await expect(page.getByRole('dialog', { name: 'Actualizamos nuestros documentos' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Continuar', exact: true })).toBeDisabled();
      await expect(foto(page)).toHaveCount(0);
    }, async ruta => { await ruta.fulfill({ body: 'ok' }); });
    await marcarTerminos(page);
    await expect(foto(page)).toBeChecked({ checked: caso.foto !== 'revoked' });
    await expect(analisis(page)).toBeChecked({ checked: caso.analisis !== 'revoked' });
    if ('cambiar' in caso) {
      await foto(page).check();
      await analisis(page).uncheck();
    } else await captura(page, info, 'reaceptacion-320');
    const continuar = page.getByRole('button', { name: 'Continuar', exact: true });
    if (esperarRetiro) {
      await conRecursoRetenido(page, '**/prueba-retirar-analisis', async () => {
        await continuar.click();
        await expect(foto(page)).toBeDisabled();
        expect(await eventos(page)).toEqual(['aceptó']);
      }, ruta => ruta.fulfill({ body: 'ok' }));
    } else await continuar.click();
    await expect(page.getByRole('heading', { name: 'Actualizamos nuestros documentos' })).toHaveCount(0);
    expect(await eventos(page)).toEqual(['aceptó', ...caso.escritos]);
  });
}

async function altaConCorreo(page: Page, arroba = true) {
  await preparar(page, { alta: true, arroba, foto: 'never', analisis: 'never' });
  await page.getByRole('button', { name: 'Crea tu cuenta' }).click();
  await page.getByLabel('Nombre', { exact: true }).fill('Persona');
  await page.getByLabel('Apellido', { exact: true }).fill('Ejemplo');
  await page.getByLabel('Email', { exact: true }).fill('persona@example.invalid');
  await page.getByLabel('Contraseña', { exact: true }).fill('prueba-local');
  await marcarTerminos(page);
}

for (const elegida of ['foto', 'análisis'] as const) {
  test('El alta otorga sólo ' + elegida + ' después de confirmar el usuario', async ({ page }, info) => {
    await altaConCorreo(page);
    await expect(foto(page)).toBeChecked();
    await expect(analisis(page)).toBeChecked();
    if (elegida === 'foto') await captura(page, info, 'alta-320');
    await (elegida === 'foto' ? analisis(page) : foto(page)).uncheck();
    await page.getByRole('button', { name: 'Registrarme' }).click();
    await page.getByRole('textbox', { name: 'Tu @usuario', exact: true }).fill('ejemplolocal');
    await conRecursoRetenido(page, '**/prueba-guardar-arroba', async () => {
      await page.getByRole('button', { name: 'Continuar', exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'Tu @usuario', exact: true })).toBeDisabled();
      expect(await eventos(page)).toEqual([]);
    }, async ruta => { await ruta.fulfill({ body: 'ok' }); });
    await expect.poll(() => eventos(page)).toEqual(['guardó @', 'otorga ' + elegida]);
  });
}

for (const inicial of ['never', 'granted'] as const) {
  const operacion = inicial === 'never' ? 'otorgar' : 'retirar';
  test('Al fallar al ' + operacion + ' se conservan los términos y el estado anterior', async ({ page }) => {
    await preparar(page, { foto: 'revoked', analisis: inicial, fallo: true });
    await ingresar(page);
    await marcarTerminos(page);
    await expect(analisis(page)).toBeChecked();
    if (inicial === 'granted') await analisis(page).uncheck();
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByText(/Tus términos quedaron aceptados/)).toBeVisible();
    expect(await eventos(page)).toEqual(['aceptó', inicial === 'never' ? 'otorga análisis' : 'retira análisis']);
    await expect(page.getByRole('dialog', { name: 'Actualizamos nuestros documentos' })).toHaveCount(0);
    await page.evaluate(() => { location.hash = '/mas'; });
    await page.getByRole('button', { name: 'Mis permisos' }).click();
    const control = page.getByRole('switch', { name: /Análisis interno/ });
    await expect(control).toBeEnabled();
    await expect(control).toBeChecked({ checked: inicial === 'granted' });
  });
}

test('Retirar análisis desde la puerta sigue siendo posible sin abrir el Aviso', async ({ page }) => {
  await preparar(page, { foto: 'revoked', analisis: 'granted' });
  await ingresar(page);
  await expect(analisis(page)).toBeChecked();
  await page.evaluate(async () => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api');
    api.getPrivacyNotice = async () => { throw Error('Aviso no disponible'); };
  });
  await page.getByText('Más información', { exact: true }).click();
  await page.getByRole('button', { name: 'Mis permisos' }).click();
  const control = page.getByRole('switch', { name: /Análisis interno/ });
  await expect(control).toBeChecked();
  await control.click();
  await expect(control).not.toBeChecked();
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await expect(analisis(page)).not.toBeChecked();
  await marcarTerminos(page);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Actualizamos nuestros documentos' })).toHaveCount(0);
  expect(await eventos(page)).toEqual(['retira análisis', 'aceptó']);
});

test('Configuración separa Privacidad de Mis permisos', async ({ page }, info) => {
  await preparar(page, { foto: 'granted', analisis: 'granted' });
  await ingresar(page);
  await marcarTerminos(page);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Actualizamos nuestros documentos' })).toHaveCount(0);
  await page.evaluate(() => { location.hash = '/mas'; });
  const seccion = page.getByRole('region', { name: 'Privacidad', exact: true });
  await expect(seccion.getByRole('switch', { name: 'Sugerencias para dividir' })).toBeVisible();
  await expect(seccion.getByRole('switch', { name: /foto|análisis/i })).toHaveCount(0);
  await seccion.scrollIntoViewIfNeeded();
  await captura(page, info, 'privacidad-320');
  await page.getByRole('button', { name: 'Mis permisos' }).click();
  await expect(page.getByRole('switch', { name: /Análisis interno/ })).toBeChecked();
  await expect(page.getByRole('switch', { name: /Mostrar mi foto/ })).toBeChecked();
  await captura(page, info, 'mis-permisos-320');
});

test('Una sesión vencida durante el guardado del usuario descarta la elección', async ({ page }) => {
  await altaConCorreo(page);
  await expect(foto(page)).toBeChecked();
  await page.getByRole('button', { name: 'Registrarme' }).click();
  await page.getByRole('textbox', { name: 'Tu @usuario' }).fill('ejemplolocal');
  await conRecursoRetenido(page, '**/prueba-guardar-arroba', async () => {
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Tu @usuario' })).toBeDisabled();
    await page.evaluate(async () => {
      const ruta = '/src/api/storage.ts';
      const { clearSession } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api/storage');
      clearSession();
    });
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  }, async ruta => { await ruta.fulfill({ body: 'ok' }); });
  await expect.poll(() => eventos(page)).toEqual(['guardó @']);
  await ingresar(page);
  await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toBeVisible();
  expect(await eventos(page)).toEqual(['guardó @']);
});

for (const finalidad of ['foto', 'analisis'] as const) {
  for (const previo of ['granted', 'never'] as const) {
    test(`Lectura fallida de ${finalidad} con estado ${previo}: acepta sin escribir permisos`, async ({ page }) => {
      await preparar(page, { foto: 'revoked', analisis: 'revoked', [finalidad]: previo, lecturaFallida: finalidad });
      await ingresar(page);
      await expect(page.getByText(/No pudimos confirmar el estado del permiso/)).toBeVisible();
      await expect(finalidad === 'foto' ? foto(page) : analisis(page)).toHaveCount(0);
      await expect(finalidad === 'foto' ? analisis(page) : foto(page)).not.toBeChecked();
      await marcarTerminos(page);
      await page.getByRole('button', { name: 'Continuar', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toBeVisible();
      expect(await eventos(page)).toEqual(['aceptó']);
    });
  }
}

test('Alta rechazada por correo: elegir @ después de entrar con otra cuenta no otorga permisos', async ({ page }) => {
  await altaConCorreo(page);
  await expect(foto(page)).toBeChecked();
  await expect(analisis(page)).toBeChecked();
  await page.evaluate(async () => {
    const fachada = '/src/api/index.ts';
    const errores = '/src/api/http.ts';
    const { api } = await import(/* @vite-ignore */ fachada) as typeof import('../src/api');
    const { HttpError } = await import(/* @vite-ignore */ errores) as typeof import('../src/api/http');
    api.register = async () => { throw new HttpError(409, { error: 'registration_not_available' }); };
  });
  await page.getByRole('button', { name: 'Registrarme' }).click();
  await expect(page.getByText(/No pudimos crear la cuenta/)).toBeVisible();
  await page.getByRole('button', { name: /Ya tengo cuenta/ }).click();
  await ingresar(page, 'otra@example.invalid');
  await page.getByRole('textbox', { name: 'Tu @usuario', exact: true }).fill('otrapersona');
  await page.route('**/prueba-guardar-arroba', ruta => ruta.fulfill({ body: 'ok' }));
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toBeVisible();
  expect(await eventos(page)).toEqual(['guardó @']);
});

test('Alta con @ apagado: aplica la elección al crear la cuenta', async ({ page }) => {
  await altaConCorreo(page, false);
  await expect(foto(page)).toBeChecked();
  await analisis(page).uncheck();
  await page.getByRole('button', { name: 'Registrarme' }).click();
  await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toBeVisible();
  await expect.poll(() => eventos(page)).toEqual(['otorga foto']);
  await expect(page.getByRole('textbox', { name: 'Tu @usuario' })).toHaveCount(0);
});

test('Google en ventana emergente conserva el retiro de una cuenta existente al elegir @', async ({ page }) => {
  await preparar(page, { alta: true, foto: 'never', analisis: 'revoked' });
  await page.evaluate(async () => {
    localStorage.setItem('payme.app.mock.google_sin_cuenta.v1', 'false');
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api');
    const continuar = api.googleContinue.bind(api);
    api.googleContinue = async solicitud => {
      const respuesta = await continuar(solicitud);
      (window as unknown as { eventosPermisos: string[] }).eventosPermisos.push(respuesta.created ? 'creada' : 'existente');
      return respuesta;
    };
  });
  await page.getByRole('button', { name: 'Crea tu cuenta' }).click();
  await marcarTerminos(page);
  await expect(foto(page)).toBeChecked();
  await expect(analisis(page)).toBeChecked();
  await page.getByRole('button', { name: 'Continuar con Google', exact: true }).click();
  await page.getByRole('textbox', { name: 'Tu @usuario', exact: true }).fill('ejemplolocal');
  expect(await eventos(page)).toEqual(['existente']);
  await page.route('**/prueba-guardar-arroba', ruta => ruta.fulfill({ body: 'ok' }));
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toBeVisible();
  expect(await eventos(page)).toEqual(['existente', 'guardó @']);
});
