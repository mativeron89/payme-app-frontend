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

/** Navegación de la app (sin recargar: lo escaneado vive en memoria). */
async function ir(page: Page, ruta: string): Promise<void> {
  await page.evaluate((u) => {
    history.pushState(null, '', u);
    dispatchEvent(new PopStateEvent('popstate'));
  }, ruta);
}

test('1a · Inicio: «Viajes» reemplaza a «Asociadas» y lanza Abiertos, Cerrados y Crear viaje', async ({ page }) => {
  await conViajes(page);
  await expect(page.getByRole('tab', { name: 'Asociadas', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Viajes', exact: true }).click();
  await expect(page.getByRole('button', { name: /Abiertos\s*2 viajes/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Cerrados\s*2 viajes/ })).toBeVisible();
  await page.getByRole('button', { name: /Abiertos/ }).click();
  await expect(page).toHaveURL(/\/viajes\/abiertos$/);
  await expect(page.getByText('Cancún 2026', { exact: true })).toBeVisible();
  await expect(page.getByText('Debes $542', { exact: true })).toBeVisible();
  await expect(page.getByText('Esperando pagos · faltan 2', { exact: true })).toBeVisible();
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
  await expect(page.getByText('Debes $542', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Escanear ticket', exact: true }).click();
  await sacarFoto(page);
  await expect(page).toHaveURL(new RegExp(`/viaje-ticket-nuevo/${CANCUN}$`));
  await expect(page.getByRole('heading', { name: 'Ticket nuevo' })).toBeVisible();
  await expect(page.getByText('Lo pagaste tú', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: /En partes iguales/ }).click();
  await expect(page.getByText('Se divide entre los marcados. Desmarca a quien no estuvo.')).toBeVisible();
  await page.getByRole('checkbox', { name: /Diego Torres/ }).click();
  await expect(page.getByRole('checkbox', { name: /Diego Torres/ })).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('button', { name: 'Compartir con el viaje', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/viaje/${CANCUN}$`));
  await expect(page.getByText('Tickets · 6', { exact: false })).toBeVisible();
  // $840 entre los tres que estuvieron (sin Diego): a mí me tocan $280. Con Diego serían $210.
  await expect(page.getByText('$280', { exact: true })).toBeVisible();
  await expect(page.getByText('$210', { exact: true })).toHaveCount(0);
});

test('la cámara del viaje no ofrece «Cargarlo a mano» (el ticket exige el recibo)', async ({ page }) => {
  await conViajes(page, { 'payme.app.mock.n179.ocr.v1': 'no_items' });
  await ir(page, `/viaje/${CANCUN}`);
  await page.getByRole('button', { name: 'Escanear ticket', exact: true }).click();
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
  await page.getByRole('button', { name: 'Escanear ticket', exact: true }).click();
  await sacarFoto(page);
  await page.getByRole('radio', { name: /Pagar el total/ }).click();
  await page.getByRole('button', { name: 'Compartir con el viaje', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/viaje/${CANCUN}$`));
  await page.getByRole('button', { name: 'Escanear ticket', exact: true }).click();
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
  // $542 + $285 de los tacos.
  await expect(page.getByText('Debes $827', { exact: true })).toBeVisible();
});

test('1l · el balance en vivo y lo que falta repartir', async ({ page }) => {
  await conViajes(page);
  await ir(page, `/viaje-balance/${CANCUN}`);
  await expect(page.getByText('Falta elegir en 1 ticket', { exact: true })).toBeVisible();
  await expect(page.getByText(/Quedan \$565 sin repartir en Mariscos El Faro del 8 oct\. Se suman cuando Diego/)).toBeVisible();
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
});

test('1h → 1i · «Por lo que pidió cada uno» lleva a elegir lo propio del ticket recién cargado', async ({ page }) => {
  await conViajes(page);
  await ir(page, `/viaje/${CANCUN}`);
  await page.getByRole('button', { name: 'Escanear ticket', exact: true }).click();
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
  await expect(page).toHaveURL(/\/viajes\/abiertos$/);
  await expect(page.getByText('Mazatlán diciembre', { exact: true })).toHaveCount(0);
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
