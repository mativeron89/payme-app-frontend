import { expect, test } from '@playwright/test';
import { abrirMesaConLink, ingresar } from './_app';

/**
 * GATE DE ADMISIÓN (v2.45.0, ratificado 2026-08-06) · LA VENTANA DE LA MESA
 * MUERTA, CERRADA EN PANTALLA.
 *
 * El defecto que esto mata se midió en vivo en la auditoría: "Te sumaste a la
 * mesa ✓" seguido de "Mesa liquidada" — éxito hacia la nada. El emisor cerró
 * las dos puertas con UN predicado (`mesaViva`) y marcó el listado; acá se
 * afirma lo que la persona VE en cada superficie:
 *
 * 1. Pantalla D (link): "Esta mesa ya cerró", terminal, y la línea que cierra
 *    el círculo del recién registrado antes de soltarlo a un Inicio vacío.
 * 2. Avisos: la tarjeta de mesa muerta viene APAGADA de nacimiento — ni
 *    desaparece (parecería un bug) ni invita a un camino muerto.
 * 3. 🔴 PUERTA B EN POSITIVO: `fully_paid` está VIVA por decisión ratificada
 *    — es la mesa que un espejo apurado apaga por parecerse a "ya no hay nada
 *    que hacer acá". Se afirma que ENTRA, no sólo que otras no.
 *
 * ## Límite declarado del harness · el caso AUSENTE no se puede montar acá
 *
 * C-01 exige que un `mesa_joinable` ausente/null/malformado tampoco habilite.
 * Esos casos **no son alcanzables desde el navegador en modo mock**: el
 * adaptador corre EN PROCESO (no hay HTTP que interceptar con `page.route`) y
 * el mock siempre computa el campo, porque modela v2.45.0 correctamente.
 * Producirlos exigiría un emisor de otra versión o un flag de simulación —
 * inventar superficie para probar. Viven en `invitacionAdmision.test.ts`, que
 * recorre los seis casos; acá se acredita el CABLEADO con los dos estados
 * que el mock sí produce (admite / cerrada).
 */

/**
 * Muta el estado persistido con la pantalla QUIETA y recién después recarga.
 *
 * Dos carreras pagadas para llegar a esta forma: (1) mutar y navegar por hash
 * sin recargar deja al mock con su copia EN MEMORIA — el tweak no existe para
 * la app y el próximo persist() lo pisa; (2) mutar + hash + reload en el
 * MISMO evaluate deja que el hashchange monte la pantalla nueva y su GET
 * persista el estado viejo antes de que la recarga gane (racy: en un
 * navegador salía, en el otro no). La secuencia estable: mutar en una
 * pantalla sin llamadas pendientes → reload (re-hidrata del tweak) → recién
 * ahí navegar por hash.
 */
function matarMesa(a: { code: string; status: string; clearSession?: boolean }) {
  const st = JSON.parse(localStorage.getItem('payme_mock_state_v1')!);
  st.mesas.find((m: { code: string }) => m.code === a.code).status = a.status;
  localStorage.setItem('payme_mock_state_v1', JSON.stringify(st));
  if (a.clearSession) localStorage.removeItem('payme_app_session__mock');
}

test('pantalla D: el link a una mesa muerta lo dice, cierra el círculo y no ofrece reintentar', async ({ page }) => {
  await ingresar(page);
  const mesa = await abrirMesaConLink(page);

  // La mesa muere DESPUÉS de emitir el link — la ventana exacta del defecto.
  const hashLink = mesa.link.slice(mesa.link.indexOf('#'));
  await page.evaluate(matarMesa, { code: mesa.code, status: 'settled', clearSession: true });
  await page.reload();
  await page.goto(`/${hashLink}`);
  await expect(page.getByText('Te invitaron a una mesa')).toBeVisible();
  await page.getByRole('button', { name: 'Crear cuenta gratis' }).click();
  await page.getByPlaceholder('Nombre').fill('Tardía');
  await page.getByPlaceholder('Apellido').fill('AlLink');
  await page.getByPlaceholder('Email').fill('tardia@demo.mx');
  await page.getByPlaceholder('Contraseña').fill('demo-e2e');
  await page.getByRole('button', { name: 'Registrarme', exact: true }).click();

  // La D, textual de Diseño: qué pasó, sin restaurante, sin reintento.
  await expect(page.getByText('Esta mesa ya cerró')).toBeVisible();
  await expect(page.getByText('Hablá con quien te invitó si creés que es un error.')).toBeVisible();
  await expect(page.getByText('Tu cuenta ya está lista — podés abrir tu propia mesa cuando quieras.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reintentar' })).toHaveCount(0);

  // La salida es el círculo, y funciona.
  await page.getByRole('button', { name: 'Ir a PayMe' }).click();
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
});

test('Avisos: la invitación a mesa muerta viene apagada de nacimiento, sin Sumarme', async ({ page }) => {
  await ingresar(page);
  await page.evaluate(matarMesa, { code: 'PA-4520', status: 'settled' });
  await page.reload();
  await page.goto('/#/avisos');

  // La tarjeta NO desapareció: sigue diciendo quién invitó y a dónde…
  await expect(page.getByText('Sofía te invitó a')).toBeVisible();
  await expect(page.getByText('Hanzo Sushi')).toBeVisible();
  // …pero está apagada: dice qué pasó y no ofrece entrar.
  await expect(page.getByText('Esta mesa ya cerró')).toBeVisible();
  await expect(page.getByRole('button', { name: /Sumarme/ })).toHaveCount(0);
});

test('🔴 puerta B en POSITIVO: la mesa pagada entera pero viva ADMITE entrar', async ({ page }) => {
  await ingresar(page);
  await page.evaluate(matarMesa, { code: 'PA-4520', status: 'fully_paid' });
  await page.reload();
  await page.goto('/#/avisos');

  // fully_paid NO apaga la tarjeta: decisión B, ratificada.
  const sumarme = page.getByRole('button', { name: 'Sumarme', exact: true });
  await expect(sumarme).toBeVisible();
  await expect(sumarme).toBeEnabled();
  await sumarme.click();

  await expect(page.getByText('Te sumaste a la mesa ✓')).toBeVisible();
  await expect(page).toHaveURL(/#\/mesa\/PA-4520/);
  // Adentro, la pantalla honesta del estado que la mesa tiene: pagos
  // registrados, pendiente de cierre. Entró — que era el punto.
  await expect(page.getByText('Pagos registrados')).toBeVisible();
});
