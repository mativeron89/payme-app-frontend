import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { sacarFoto } from './_camara';

/**
 * AF-VIAJES · D242 · los recorridos de Viajes con la capacidad ENCENDIDA (el
 * seam del mock; el dueño la publica apagada hasta el Aviso). Sin la capacidad,
 * nada cambia: `viajes-apagado.spec.ts`.
 *
 * El mock replica App Backend 2.171.0 con la semilla del prototipo de Mati:
 * «Cancún 2026» (abierto, 4 personas; Debes $542; Diego no eligió en «Mariscos
 * El Faro»), «Monterrey fin de semana» (esperando pagos; Luis marcó $750 y
 * Sofía debe $300), «Oaxaca puente» y «Valle de Bravo» (cerrados) y la
 * invitación de Sofía a «Mazatlán diciembre».
 */
const CANCUN = 'd1000000-0000-4000-8000-000000000001';
const MONTERREY = 'd1000000-0000-4000-8000-000000000002';
const OAXACA = 'd1000000-0000-4000-8000-000000000003';
const MAZATLAN = 'd1000000-0000-4000-8000-000000000005';
const MARISCOS = 'd2000000-0000-4000-8000-000000000105';

async function conViajes(page: Page, extra: Record<string, string> = {}): Promise<void> {
  await page.addInitScript((seams) => {
    localStorage.setItem('payme.app.mock.viajes.v1', 'encendido');
    for (const [k, v] of Object.entries(seams)) localStorage.setItem(k, v);
  }, extra);
  await ingresar(page);
}

/** D250 · dentro de Cancún abierto, el círculo de la cámara escanea para el viaje. */
/** D263 · «¿Quién pagó?» también tiene casillas con los nombres: la de «¿Quiénes estuvieron?», por su grupo. */
function presente(page: Page, nombre: RegExp) {
  return page.getByRole('group', { name: '¿Quiénes estuvieron?', exact: true }).getByRole('checkbox', { name: nombre });
}

function circuloDelViaje(page: Page) {
  return page.getByRole('button', { name: 'Escanear ticket para Cancún 2026', exact: true });
}

/** Navegación de la app (sin recargar: lo escaneado vive en memoria). */
async function ir(page: Page, ruta: string): Promise<void> {
  await page.evaluate((u) => {
    history.pushState(null, '', u);
    dispatchEvent(new PopStateEvent('popstate'));
  }, ruta);
}

test('1a · D246 · Inicio: «Viajes» reemplaza a «Asociadas»; Abiertos y Cerrados se eligen y la lista va debajo de «Crear viaje»', async ({ page }) => {
  await conViajes(page);
  await expect(page.getByRole('tab', { name: 'Asociadas', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Viajes', exact: true }).click();
  const inicio = page.url();
  const abiertos = page.getByRole('button', { name: /Abiertos\s*2 viajes/ });
  const cerrados = page.getByRole('button', { name: /Cerrados\s*2 viajes/ });
  // Al entrar, Abiertos, con su lista en la misma pantalla.
  await expect(abiertos).toHaveAttribute('aria-pressed', 'true');
  await expect(cerrados).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText('Cancún 2026', { exact: true })).toBeVisible();
  // D255-6 · cada fila, sólo la inicial y el nombre.
  await expect(page.locator('.vj-inicio-fila')).toHaveText(['CCancún 2026', 'MMonterrey fin de semana']);
  expect(page.url()).toBe(inicio);
  await cerrados.click();
  await expect(cerrados).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Oaxaca puente', { exact: true })).toBeVisible();
  await expect(page.locator('.vj-inicio-fila').first()).toHaveText('OOaxaca puente');
  await expect(page.getByText('Cancún 2026', { exact: true })).toHaveCount(0);
  expect(page.url()).toBe(inicio);
  // En otra pestaña la lista no está; al volver a Viajes, de nuevo Abiertos.
  await page.getByRole('tab', { name: 'Cuenta', exact: true }).click();
  await expect(page.getByText('Oaxaca puente', { exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Viajes', exact: true }).click();
  await expect(abiertos).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Cancún 2026', { exact: true })).toBeVisible();
  await cerrados.click();
  // Tocar un viaje lo abre.
  await page.getByText('Oaxaca puente', { exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/viaje-cerrado/${OAXACA}$`));
});

test('D245 · la pantalla del viaje: el monto en rojo con «−», «Miembros» se abre y los dos botones', async ({ page }) => {
  await conViajes(page);
  await ir(page, `/viaje/${CANCUN}`);
  await expect(page.getByRole('heading', { name: 'Cancún 2026', level: 1 })).toBeVisible();
  await expect(page.locator('.vjv-monto-deuda')).toHaveText(/^\u2212\$542/);
  await expect(page.getByText('Tu balance', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Mariscos El Faro', { exact: true })).toHaveCount(0);
  const miembros = page.getByRole('button', { name: /^Miembros/ });
  await expect(miembros).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('Sofía Ramírez', { exact: true })).toHaveCount(0);
  await miembros.click();
  await expect(miembros).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('Sofía Ramírez', { exact: true })).toBeVisible();
  // D245 · con su foto quien la tiene (Luis y Sofía en el mock).
  await expect(page.locator('.vjv-miembros-lista .vj-avatar-foto')).toHaveCount(2);
  await page.getByRole('button', { name: 'Carga manual', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/viaje-gasto/${CANCUN}$`));
  await expect(page.getByRole('heading', { name: 'Carga manual', level: 1 })).toBeVisible();
  await expect(page.getByText('¿Entre quiénes?', { exact: true })).toBeVisible();
});

test('1d/1e · crear e invitar desde Amigos y por @usuario', async ({ page }) => {
  await conViajes(page);
  await ir(page, '/viaje-nuevo');
  await page.getByLabel('Nombre del viaje').fill('Puebla 2026');
  const buscar = page.getByPlaceholder('Busca en Amigos o escribe @usuario');
  await buscar.fill('sof');
  await page.getByRole('button', { name: 'Agregar', exact: true }).first().click();
  await buscar.fill('@mari');
  await expect(page.getByText('Otros usuarios de PayMe', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Agregar', exact: true }).first().click();
  await page.getByRole('button', { name: 'Crear viaje', exact: true }).click();
  await expect(page).toHaveURL(/\/viaje\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Puebla 2026' })).toBeVisible();
});

test('1d · el 429 del dueño se dice, sin crear nada', async ({ page }) => {
  await conViajes(page, { 'payme.app.mock.viajes.limite.v1': '429' });
  await ir(page, '/viaje-nuevo');
  await page.getByLabel('Nombre del viaje').fill('Puebla 2026');
  await page.getByPlaceholder('Busca en Amigos o escribe @usuario').fill('sof');
  await page.getByRole('button', { name: 'Agregar', exact: true }).first().click();
  await page.getByRole('button', { name: 'Crear viaje', exact: true }).click();
  await expect(page.getByText('Muchas invitaciones seguidas. Prueba en unos minutos.')).toBeVisible();
  await expect(page).toHaveURL(/\/viaje-nuevo$/);
});

test('1f · aceptar la invitación desde Avisos suma al viaje', async ({ page }) => {
  await conViajes(page);
  await ir(page, '/avisos');
  await expect(page.getByText('Sofía Ramírez te invitó al viaje Mazatlán diciembre.', { exact: false })).toBeVisible();
  // La única invitación pendiente de la bandeja (las solicitudes de amistad viven en Amigos).
  await page.getByRole('button', { name: 'Aceptar', exact: true }).click();
  await expect(page.getByText(/· Aceptaste$/)).toBeVisible();
  await ir(page, `/viaje/${MAZATLAN}`);
  await expect(page.getByRole('heading', { name: 'Mazatlán diciembre' })).toBeVisible();
});

test('1f · rechazar la invitación no suma: el viaje da el 404 de siempre', async ({ page }) => {
  await conViajes(page);
  await ir(page, '/avisos');
  await expect(page.getByText('Sofía Ramírez te invitó al viaje Mazatlán diciembre.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Rechazar', exact: true }).click();
  await expect(page.getByText(/· Rechazaste$/)).toBeVisible();
  await ir(page, `/viaje/${MAZATLAN}`);
  await expect(page.getByText('Este viaje ya no está disponible.')).toBeVisible();
});

test('1g/1h · escanear dentro del viaje, en partes iguales y sin Diego', async ({ page }) => {
  await conViajes(page, { 'payme.app.mock.viajes.fecha.v1': '2026-10-09T14:20' });
  await ir(page, `/viaje/${CANCUN}`);
  await expect(page.locator('.vjv-monto-deuda')).toHaveText(/^\u2212\$542/);
  await circuloDelViaje(page).click();
  await sacarFoto(page);
  await expect(page).toHaveURL(new RegExp(`/viaje-ticket-nuevo/${CANCUN}$`));
  await expect(page.getByRole('heading', { name: 'Ticket nuevo' })).toBeVisible();
  // D255-6 · D263 · «¿Quién pagó?», con «Tú» marcado por defecto y sólo «Tú».
  const quienPago = page.getByRole('group', { name: '¿Quién pagó?', exact: true });
  await expect(quienPago.getByRole('checkbox', { name: 'Tú', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(quienPago.locator('[role="checkbox"][aria-checked="true"]')).toHaveCount(1);
  await page.getByRole('radio', { name: /En partes iguales/ }).click();
  await expect(page.getByText('Se divide entre los marcados. Desmarca a quien no estuvo.')).toBeVisible();
  await presente(page, /Diego Torres/).click();
  await expect(presente(page, /Diego Torres/)).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('button', { name: 'Compartir con el viaje', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/viaje/${CANCUN}$`));
  // Pagué $840 y me tocan $280 (entre los tres que estuvieron): −$542 + $560 = $18 a favor, en verde.
  await expect(page.locator('.vjv-monto-a-favor')).toHaveText(/^\$18/);
  await page.getByRole('button', { name: 'Ver balance del viaje', exact: true }).click();
  // En Consumos, el más nuevo arriba, con su total (respuesta A).
  const primero = page.locator('.vjb-consumo').first();
  await expect(primero).toContainText('Tacos El Güero');
  await expect(primero.locator('.vjb-consumo-monto')).toHaveText('$840');
  // Y lo pagué yo: «Pagó» suma los $840 a los $960 de Bar La Ola.
  await page.getByRole('tab', { name: 'Miembros', exact: true }).click();
  await expect(page.locator('.vjb-fila').filter({ hasText: 'Tú' }).locator('.vjb-cifra')).toHaveText('$1,800');
});

test('🔴 D250 · en el viaje no está «Escanear ticket»: el círculo escanea para el viaje y el escaneo lo dice', async ({ page }) => {
  await conViajes(page);
  await ir(page, `/viaje/${CANCUN}`);
  await expect(page.getByRole('button', { name: 'Carga manual', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Escanear ticket', exact: true })).toHaveCount(0);
  const circulo = circuloDelViaje(page);
  await expect(circulo).toHaveText('Nueva');
  // El título no espera la red: con el dueño lento, el nombre que dejó el viaje ya está.
  await page.evaluate(() => localStorage.setItem('payme.app.mock.latencia.v1', '5000'));
  await circulo.click();
  await expect(page).toHaveURL(new RegExp(`/scan/${CANCUN}$`));
  await expect(page.getByRole('heading', { name: 'Ticket para Cancún 2026', level: 1 })).toBeVisible({ timeout: 1500 });
});

test('D250 · desde un ticket del viaje abierto, el círculo también escanea para el viaje', async ({ page }) => {
  await conViajes(page);
  await ir(page, `/viaje-balance/${CANCUN}`);
  await page.locator('.vjb-consumo').filter({ hasText: 'Bar La Ola' }).click();
  await expect(page).toHaveURL(new RegExp(`/viaje-ticket/${CANCUN}\\.`));
  await circuloDelViaje(page).click();
  await expect(page).toHaveURL(new RegExp(`/scan/${CANCUN}$`));
});

test('D250 · desde Balance, el círculo también escanea para el viaje', async ({ page }) => {
  await conViajes(page);
  await ir(page, `/viaje-balance/${CANCUN}`);
  await expect(page.getByRole('tab', { name: 'Consumos', exact: true })).toBeVisible();
  await circuloDelViaje(page).click();
  await expect(page).toHaveURL(new RegExp(`/scan/${CANCUN}$`));
});

test('D250 · desde Inicio y con el viaje esperando pagos, el círculo de siempre', async ({ page }) => {
  await conViajes(page);
  const nueva = page.getByRole('button', { name: 'Nueva', exact: true });
  await nueva.click();
  await expect(page).toHaveURL(/\/scan$/);
  await expect(page.getByRole('heading', { name: 'Escanea el ticket', level: 1 })).toBeVisible();
  await ir(page, `/viaje/${MONTERREY}`);
  await expect(page.getByText('Monterrey fin de semana', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Escanear ticket para/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Nueva', exact: true }).click();
  await expect(page).toHaveURL(/\/scan$/);
});

test('D250 · el escaneo de un viaje recargado pide el nombre para su título', async ({ page }) => {
  await conViajes(page);
  await page.goto(`/scan/${CANCUN}`);
  await expect(page.getByRole('heading', { name: 'Ticket para Cancún 2026', level: 1 })).toBeVisible();
});

test('la cámara del viaje no ofrece «Cargarlo a mano» (el ticket exige el recibo)', async ({ page }) => {
  await conViajes(page, { 'payme.app.mock.n179.ocr.v1': 'no_items' });
  await ir(page, `/viaje/${CANCUN}`);
  await circuloDelViaje(page).click();
  await sacarFoto(page);
  await expect(page.getByText('No pudimos leer el ticket', { exact: true })).toBeVisible();
  await expect(page.getByText('Prueba sacar la foto de nuevo con más luz.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cargarlo a mano', exact: true })).toHaveCount(0);
  // «Volver» de la cámara del viaje vuelve al viaje.
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/viaje/${CANCUN}$`));
});

test('1k · el mismo ticket escaneado otra vez no se carga dos veces', async ({ page }) => {
  await conViajes(page, { 'payme.app.mock.viajes.huella.v1': 'h1' });
  await ir(page, `/viaje/${CANCUN}`);
  await circuloDelViaje(page).click();
  await sacarFoto(page);
  await page.getByRole('radio', { name: /Pagar el total/ }).click();
  await page.getByRole('button', { name: 'Compartir con el viaje', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/viaje/${CANCUN}$`));
  await circuloDelViaje(page).click();
  await sacarFoto(page);
  await expect(page.getByText('Este ticket ya está en el viaje', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Elegir lo que consumí', exact: true })).toBeVisible();
});

test('1i · elegir lo que consumí cambia el balance; nunca se ve qué eligió otro', async ({ page }) => {
  await conViajes(page);
  await ir(page, `/viaje-ticket/${CANCUN}.${MARISCOS}`);
  await expect(page.getByText('Diego · falta elegir', { exact: true })).toBeVisible();
  await expect(page.getByText('¿Qué consumiste?', { exact: true })).toBeVisible();
  await page.getByText('Tacos de pescado (3)', { exact: true }).click();
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/viaje/${CANCUN}$`));
  // $542 + $285 de los tacos, en rojo con el «−».
  await expect(page.locator('.vjv-monto-deuda')).toHaveText(/^\u2212\$827/);
});

test('D244 · carga manual: «Listo» pide una descripción y un monto mayor que cero', async ({ page }) => {
  await conViajes(page);
  await ir(page, `/viaje-gasto/${CANCUN}`);
  const listo = page.getByRole('button', { name: 'Listo', exact: true });
  const descripcion = page.getByLabel('Descripción', { exact: true });
  const monto = page.getByLabel('Monto', { exact: true });
  await expect(listo).toBeDisabled();
  await descripcion.fill('Gasolina');
  await expect(listo).toBeDisabled();
  await monto.fill('0');
  await expect(listo).toBeDisabled();
  await monto.fill('1,250.50');
  await expect(listo).toBeEnabled();
  await expect(page.getByText('Total $1,250.50', { exact: true })).toBeVisible();
  await descripcion.fill('   ');
  await expect(listo).toBeDisabled();
});

test('D244 · carga manual de punta a punta: «Listo» guarda, vuelve al viaje y el gasto aparece primero', async ({ page }) => {
  await conViajes(page);
  await ir(page, `/viaje/${CANCUN}`);
  await page.getByRole('button', { name: 'Carga manual', exact: true }).click();
  await page.getByLabel('Descripción', { exact: true }).fill('Gasolina');
  await page.getByLabel('Monto', { exact: true }).fill('900');
  // Diego no va: entre tres, $300 cada uno.
  await presente(page, /Diego Torres/).click();
  await expect(presente(page, /Diego Torres/)).toHaveAttribute('aria-checked', 'false');
  // Un doble toque es un solo gasto (la llave de idempotencia y el botón apagado mientras guarda).
  await page.getByRole('button', { name: 'Listo', exact: true }).dblclick();
  await expect(page).toHaveURL(new RegExp(`/viaje/${CANCUN}$`));
  await expect(page.getByText('Cargaste el gasto.', { exact: true })).toBeVisible();
  // −$542 + $900 − $300 = $58 a favor.
  await expect(page.locator('.vjv-monto-a-favor')).toHaveText(/^\$58/);
  await page.getByRole('button', { name: 'Ver balance del viaje', exact: true }).click();
  const primero = page.locator('.vjb-consumo').first();
  await expect(primero).toContainText('Gasolina');
  await expect(primero.locator('.vjb-consumo-monto')).toHaveText('$900');
  await expect(page.locator('.vjb-consumo').filter({ hasText: 'Gasolina' })).toHaveCount(1);
  await page.getByRole('tab', { name: 'Miembros', exact: true }).click();
  await expect(page.locator('.vjb-fila').filter({ hasText: 'Tú' }).locator('.vjb-cifra')).toHaveText('$1,860');
  // Se abre como un ticket «En partes iguales», con Diego desmarcado.
  await page.getByRole('tab', { name: 'Consumos', exact: true }).click();
  await primero.click();
  await expect(page).toHaveURL(new RegExp(`/viaje-ticket/${CANCUN}\\.`));
  await expect(page.getByRole('checkbox', { name: /Diego Torres/ })).toHaveAttribute('aria-checked', 'false');
});

test('D244 · si alguien de los elegidos salió del viaje: se avisa, se vuelve a pedir el viaje y no se borra lo escrito', async ({ page }) => {
  await conViajes(page, { 'payme.app.mock.viajes.gasto.v1': 'alguien_salio' });
  await ir(page, `/viaje-gasto/${CANCUN}`);
  await expect(presente(page, /Diego Torres/)).toBeVisible();
  await page.getByLabel('Descripción', { exact: true }).fill('Gasolina');
  await page.getByLabel('Monto', { exact: true }).fill('900');
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  await expect(page.getByText('Alguien ya no está en el viaje. Revisa entre quiénes.', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/viaje-gasto/${CANCUN}$`));
  // Diego ya no está en la lista; lo escrito sigue.
  await expect(presente(page, /Diego Torres/)).toHaveCount(0);
  await expect(page.getByLabel('Descripción', { exact: true })).toHaveValue('Gasolina');
  await expect(page.getByLabel('Monto', { exact: true })).toHaveValue('900');
  // Y ahora sí se carga, entre los tres que quedan.
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/viaje/${CANCUN}$`));
  await expect(page.getByText('Cargaste el gasto.', { exact: true })).toBeVisible();
});

test('D244 · si la respuesta se pierde, reintentar es el mismo gasto (la misma llave), nunca otro', async ({ page }) => {
  await conViajes(page, { 'payme.app.mock.viajes.gasto.v1': 'respuesta_perdida' });
  await ir(page, `/viaje-gasto/${CANCUN}`);
  await page.getByLabel('Descripción', { exact: true }).fill('Gasolina');
  await page.getByLabel('Monto', { exact: true }).fill('900');
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  await expect(page.getByText('No pudimos guardarlo. Prueba de nuevo.', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/viaje-gasto/${CANCUN}$`));
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/viaje/${CANCUN}$`));
  await page.getByRole('button', { name: 'Ver balance del viaje', exact: true }).click();
  await expect(page.locator('.vjb-consumo').first()).toContainText('Gasolina');
  await expect(page.locator('.vjb-consumo').filter({ hasText: 'Gasolina' })).toHaveCount(1);
});

test('D245 · Balance: «Consumos» (el más nuevo arriba, abre el ticket) y «Miembros»', async ({ page }) => {
  await conViajes(page);
  await ir(page, `/viaje-balance/${CANCUN}`);
  // D255-3 · sin la burbuja «Balance»: las pestañas en la cabecera.
  await expect(page.getByRole('heading', { name: 'Balance' })).toHaveCount(0);
  await expect(page.locator('header.hdr').getByRole('tab', { name: 'Consumos', exact: true })).toHaveAttribute('aria-selected', 'true');
  const consumos = page.locator('.vjb-consumo');
  await expect(consumos).toHaveCount(5);
  await expect(consumos.first()).toContainText('Mariscos El Faro');
  await expect(consumos.first()).toContainText('Falta que elija 1');
  await expect(consumos.last()).toContainText('Fonda Doña Mary');
  await page.getByRole('tab', { name: 'Miembros', exact: true }).click();
  await expect(page.locator('.vjb-miembros .vjb-fila')).toHaveCount(4);
  // Lo que pagó cada uno, del dueño (`pagado_cents`): $960, $4,040, $1,280 y $380.
  await expect(page.locator('.vjb-miembros .vjb-cifra')).toHaveText(['$960', '$4,040', '$1,280', '$380']);
  // Luis y Sofía tienen foto en el mock; Diego y yo, iniciales.
  const fotos = page.locator('.vjb-miembros .vj-avatar-foto');
  await expect(fotos).toHaveCount(2);
  for (const src of await fotos.evaluateAll((xs) => xs.map((x) => (x as HTMLImageElement).src))) expect(src).toMatch(/^blob:/);
  await expect(page.locator('.vjb-miembros .vjb-fila').filter({ hasText: 'Diego Torres' }).locator('.vj-avatar')).toHaveText('DT');
  await page.getByRole('tab', { name: 'Consumos', exact: true }).click();
  await consumos.first().click();
  await expect(page).toHaveURL(new RegExp(`/viaje-ticket/${CANCUN}\\.${MARISCOS}$`));
});

test('1m/1n · cerrar con alguien sin elegir y el ida y vuelta de «Ya pagué»', async ({ page }) => {
  await conViajes(page);
  await ir(page, `/viaje/${CANCUN}`);
  await page.getByRole('button', { name: 'Cerrar viaje', exact: true }).click();
  await expect(page.getByText(/Diego Torres todavía no eligió en Mariscos El Faro del 8 oct\. Si cierras ahora, los \$565 que faltan se le asignan a Diego\./)).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar viaje', exact: true }).click();
  await expect(page.getByText(/Tú le transfieres \$542 a Luis Pérez/)).toBeVisible();
  await page.getByRole('button', { name: 'Ya pagué', exact: true }).click();
  await expect(page.getByText('Esperando que Luis confirme', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Deshacer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ya pagué', exact: true })).toBeVisible();
});

test('1o/1p · «No me llegó» y «Recibí»: con todo pagado pasa a Cerrados', async ({ page }) => {
  await conViajes(page);
  await ir(page, `/viaje/${MONTERREY}`);
  await expect(page.getByText('Luis marcó que te pagó. Revisa tu banco y confírmalo.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'No me llegó', exact: true }).click();
  await expect(page.getByText('Luis marcó que te pagó. Revisa tu banco y confírmalo.', { exact: true })).toHaveCount(0);
  for (let i = 0; i < 2; i += 1) {
    await page.getByRole('button', { name: 'Recibí', exact: true }).first().click();
  }
  await expect(page).toHaveURL(new RegExp(`/viaje-cerrado/${MONTERREY}$`));
});

test('1q · salir: con consumos no; sin consumos sí', async ({ page }) => {
  await conViajes(page);
  await ir(page, `/viaje/${CANCUN}`);
  await page.getByRole('button', { name: 'Salir del viaje', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Salir del viaje', exact: true }).click();
  await expect(page.getByText('Todavía no puedes salir de Cancún 2026', { exact: true })).toBeVisible();
  // H02 · D242-1: marcar «Ya pagué» solo no alcanza.
  await expect(page.getByText(/Podrás salir cuando se cierre el viaje y tus transferencias estén confirmadas\.$/)).toBeVisible();
});

test('1h → 1i · «Por lo que pidió cada uno» lleva a elegir lo propio del ticket recién cargado', async ({ page }) => {
  await conViajes(page);
  await ir(page, `/viaje/${CANCUN}`);
  await circuloDelViaje(page).click();
  await sacarFoto(page);
  await expect(page.getByRole('radio', { name: /Por lo que pidió cada uno/ })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Compartir con el viaje', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/viaje-ticket/${CANCUN}\\.[0-9a-f-]{36}$`));
  await expect(page.getByText('¿Qué consumiste?', { exact: true })).toBeVisible();
  await expect(page.getByText('Tagliatelle Bolognese', { exact: true })).toBeVisible();
});

test('1q · sin consumos se sale: la invitación aceptada y salir del viaje', async ({ page }) => {
  await conViajes(page);
  await ir(page, '/avisos');
  await page.getByRole('button', { name: 'Aceptar', exact: true }).click();
  await expect(page.getByText(/· Aceptaste$/)).toBeVisible();
  await ir(page, `/viaje/${MAZATLAN}`);
  await page.getByRole('button', { name: 'Salir del viaje', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Salir del viaje', exact: true }).click();
  // H02 · a Inicio, con la pestaña Viajes, y el viaje ya no está.
  await expect(page.getByRole('tab', { name: 'Viajes', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: /Abiertos/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Cancún 2026', { exact: true })).toBeVisible();
  await expect(page.getByText('Mazatlán diciembre', { exact: true })).toHaveCount(0);
});

test('🔴 H02 · esperando pagos: «Salir del viaje» al pie; con transferencias mías sin confirmar, la hoja dice cuántas', async ({ page }) => {
  await conViajes(page);
  await ir(page, `/viaje/${MONTERREY}`);
  await page.getByRole('button', { name: 'Salir del viaje', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Salir del viaje', exact: true }).click();
  await expect(page.getByText('Todavía no puedes salir de Monterrey fin de semana', { exact: true })).toBeVisible();
  await expect(page.getByText('Tienes 2 transferencias sin confirmar. Podrás salir cuando todas estén confirmadas.', { exact: true }))
    .toBeVisible();
  await page.getByRole('button', { name: 'Entendido', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/viaje/${MONTERREY}$`));
});

test('🔴 H02 · con todo confirmado se sale de un viaje cerrado: Inicio › Viajes y ya no está en Cerrados', async ({ page }) => {
  await conViajes(page);
  await ir(page, `/viaje/${MONTERREY}`);
  for (let i = 0; i < 2; i += 1) {
    await page.getByRole('button', { name: 'Recibí', exact: true }).first().click();
  }
  await expect(page).toHaveURL(new RegExp(`/viaje-cerrado/${MONTERREY}$`));
  await page.getByRole('button', { name: 'Salir del viaje', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('¿Salir de Monterrey fin de semana?', { exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Salir del viaje', exact: true }).click();
  await expect(page.getByText('Saliste de Monterrey fin de semana.', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Viajes', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: /Cerrados/ }).click();
  await expect(page.getByText('Oaxaca puente', { exact: true })).toBeVisible();
  await expect(page.getByText('Monterrey fin de semana', { exact: true })).toHaveCount(0);
  await ir(page, `/viaje-cerrado/${MONTERREY}`);
  await expect(page.getByText('Este viaje ya no está disponible.', { exact: true })).toBeVisible();
  // El pedido de la pestaña es de una sola vez: la próxima vez, Inicio abre como siempre.
  await ir(page, '/');
  await expect(page.getByRole('tab', { name: 'Cuenta', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('1t · cada aviso del viaje lleva a su lugar', async ({ page }) => {
  await conViajes(page);
  await ir(page, '/avisos');
  await page.getByText('Luis Pérez cargó un ticket nuevo en Cancún 2026', { exact: false }).click();
  await expect(page).toHaveURL(new RegExp(`/viaje-ticket/${CANCUN}\\.${MARISCOS}$`));
  await ir(page, '/avisos');
  await page.getByText('Oaxaca puente quedó cerrado.', { exact: false }).click();
  await expect(page).toHaveURL(new RegExp(`/viaje-cerrado/${OAXACA}$`));
  await ir(page, '/avisos');
  await page.getByRole('button', { name: 'Revisar', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/viaje/${MONTERREY}$`));
});

test('1r/1s · Cerrados: sólo lo propio', async ({ page }) => {
  await conViajes(page);
  await ir(page, '/viajes/cerrados');
  await expect(page.getByText('Oaxaca puente', { exact: true })).toBeVisible();
  await page.getByText('Oaxaca puente', { exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/viaje-cerrado/${OAXACA}$`));
  await expect(page.getByText('$2,230', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Lugares visitados · 5/i)).toBeVisible();
});

test('🔴 el 404 de un viaje ajeno o inexistente es uno solo (n325)', async ({ page }) => {
  await conViajes(page);
  await ir(page, '/viaje/d1000000-0000-4000-8000-000000000099');
  await expect(page.getByText('Este viaje ya no está disponible.')).toBeVisible();
});
