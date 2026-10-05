import { expect, test } from '@playwright/test';
import { ingresar } from './_app';

/**
 * 🔴 **El corte se declara donde se prueba** (Q6, resuelta por medición).
 *
 * El default del mock es `sandbox` —describe el flujo completo que la app sabe
 * hacer, no el corte—, así que un recorrido que ejercita el corte fija su modo
 * antes del render. Es también lo que hace significativa cualquier ausencia que
 * se afirme después: se afirma sobre un estado declarado, no sobre uno que
 * todavía viaja.
 */
async function conRielApagado(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
  });
}

/**
 * 🔴 CORTE DEL VIERNES (APP-FE-FRIDAY-NO-PAY-GUARD-02, 2026-09-01) · el
 * checkout del participante está cerrado en producción pública sin pagos. En
 * esta pantalla eso significa: el círculo ya no es «Continuar» hacia el pago,
 * es «Listo» y cierra el flujo hacia Inicio; la pantalla de pago no se alcanza
 * desde ningún control; y elegir NO reserva nada —el corte va ANTES del lock—.
 * Los dos recorridos que pagaban se reescribieron para acreditar eso; el
 * feedback de «Continuar sin elegir» (toast + scroll + pulso) queda dormido con
 * el control, en la rama sin corte de `MesaDetailView`.
 *
 * H-14 (auditoría 2026-08-06): EN PARTES IGUALES, MARCAR ES INFORMATIVO — Y EL
 * GATE LO DECÍA OBLIGATORIO.
 *
 * Marcar en la mesa igual es una declaración separada y no cambia el slot;
 * el gate viejo exigía seleccionar igual y contradecía esa semántica. El seed
 * agravaba: PA-3121 tenía `items: []` —un estado
 * IMPOSIBLE en producción, `POST /mesas` exige `.min(1)`— y el Continuar
 * quedaba apagado PARA SIEMPRE: la persona no podía pagar su parte de $155.
 *
 * Las dos mitades se afirman a propósito, porque el fix tenía alcance exacto:
 * en `igual` el gate NO exige selección; en `consumo` la selección SÍ
 * determina el monto y el gate NO se toca. Si la segunda mitad cae, el fix se
 * pasó de alcance.
 */

test.describe('Continuar en la mesa (H-14)', () => {
  test('partes iguales: Listo persiste incluso vacío y permanece en Mis ítems (corte)', async ({ page }) => {
    await conRielApagado(page);
    await ingresar(page);
    await page.evaluate(async () => {
      const route = '/src/api/mock/store.ts';
      const module = await import(/* @vite-ignore */ route);
      const mesa = module.state.mesas.find((candidate: { code: string }) => candidate.code === 'PA-3121');
      mesa.status = 'open';
      mesa.guarantee_mode = false;
      mesa.guarantee_method = 'none';
      mesa.closure_reason = null;
      module.persist();
    });
    await page.goto('/#/mesa/PA-3121');
    await expect(page.locator('.mesa-selection-title')).toContainText('partes iguales');
    await expect(page.getByText('Los pagos llegan pronto; tu selección queda registrada.')).toHaveCount(0);

    // La mesa igual del seed ahora tiene ítems reales (el contrato los exige).
    await expect(page.getByText('Omakase para dos')).toBeVisible();

    // Sin tocar ningún ítem: la fila ya dice "Mi parte" con el casillero.
    await expect(page.getByText('Mi parte')).toBeVisible();
    await expect(page.getByText('$155').first()).toBeVisible();

    // 🔴 CORTE · el círculo es «Listo», habilitado, y el vacío también viaja
    // como reemplazo explícito. Con el guardado OK vuelve a Inicio (decisión
    // 32); al reentrar, la nota fija lo dice. Desde la decisión 90 el círculo
    // dice «Listo» con o sin pagos: el corte se mide por a dónde lleva.
    const listo = page.getByRole('button', { name: 'Listo', exact: true });
    await expect(listo).toBeEnabled();
    await listo.click();
    await expect.poll(() => page.evaluate(() => location.pathname)).toBe('/home');
    await page.goto('/#/mesa/PA-3121');
    // Vacío→vacío no deja fila ni `updated_at`: al reentrar no hay nota, el
    // círculo vuelve a ser «Listo». El éxito lo acreditó la vuelta a Inicio.
    await expect(page.getByRole('button', { name: 'Listo', exact: true })).toBeEnabled();
    await expect(page).toHaveURL(/:\d+\/mesa\/PA-3121$/);
    // En el contrato owner, vacío→vacío es replay exacto y por eso no crea
    // fila: el éxito se acredita por la respuesta canónica, no por una fila.
    await page.reload();
    await expect(page.locator('.qc-renglon [data-estado="mio"]')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Pagar mi parte' })).toHaveCount(0);
  });

  /**
   * Decisión 90 (definición 2) sacó ¾ y ⅔ del selector. Lo que este recorrido
   * cuida no cambió: con pagos, la porción declarada en «igual» viaja como dato
   * y el importe sigue saliendo del casillero igualitario.
   */
  test('partes iguales: la porción declarada viaja como dato y no altera el casillero', async ({ page }) => {
    await ingresar(page);
    // AF-HIGIENE-2 · hasta 0.200.0 el N se escribía en el estado GUARDADO del
    // mock (`localStorage`), que el store en memoria no vuelve a leer sin
    // recargar: el test corría con N desconocido. Ahora va al store que lee la
    // app, y se afirma que llegó. Hoy el selector es el mismo con N=4 que sin N
    // (`porcionesDisponibles`: tope = N ?? 4); el N fija el escenario ante un
    // cambio de la rama «N desconocido».
    const nMesa = () => page.evaluate(async () => {
      const storePath = '/src/api/mock/store.ts';
      const store = await import(/* @vite-ignore */ storePath) as {
        state: { mesas: Array<{ code: string; original_participants?: number | null }> };
      };
      return store.state.mesas.find((candidate) => candidate.code === 'PA-3121')?.original_participants ?? null;
    });
    await page.evaluate(async () => {
      const storePath = '/src/api/mock/store.ts';
      const store = await import(/* @vite-ignore */ storePath) as {
        state: { mesas: Array<{ code: string; original_participants?: number | null }> };
        persist: () => void;
      };
      const mesa = store.state.mesas.find((candidate) => candidate.code === 'PA-3121')!;
      mesa.original_participants = 4;
      store.persist();
    });
    await page.goto('/#/mesa/PA-3121');
    expect(await nMesa()).toBe(4);

    await page.getByRole('button', { name: 'Omakase para dos', exact: true }).click();
    const fracciones = page.getByRole('radiogroup', { name: 'Porción de Omakase para dos' });
    await expect(fracciones.getByRole('radio')).toHaveText(['Entero', '½', '⅓', '¼']);
    await fracciones.getByRole('radio', { name: '⅓', exact: true }).click();

    // No hay preview monetario por plato en igualdad: la fracción es una
    // declaración separada y el monto sigue siendo el slot fijo.
    await expect(page.locator('.qc-parte')).toHaveCount(0);
    const filaMiParte = page.locator('.mi-parte');
    await expect(filaMiParte).toContainText('$155');

    // Captura el body real sin sustituir su respuesta: la prueba llega hasta
    // el mock normal y acredita que ⅓ viaja como dato declarado, mientras el
    // importe continúa saliendo del casillero igualitario.
    await page.evaluate(async () => {
      const ruta = '/src/api/index.ts';
      const modulo = await import(/* @vite-ignore */ ruta);
      const original = modulo.api.payMesa.bind(modulo.api);
      modulo.api.payMesa = async (...args: Parameters<typeof original>) => {
        localStorage.setItem('payme.app.e2e.equal-pay-body.v1', JSON.stringify(args[1]));
        return original(...args);
      };
    });
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Pagar mi parte' })).toBeVisible();
    await expect(page.getByText('Tu parte · $155', { exact: true })).toBeVisible();
    await page.getByRole('radio', { name: '0%', exact: true }).click();
    await page.getByRole('radio', { name: /Santander.*4532/ }).click();
    await page.getByRole('button', { name: 'Pagar', exact: true }).click();
    await expect(page.getByText('¡Listo!')).toBeVisible();

    const body = await page.evaluate(() => JSON.parse(
      localStorage.getItem('payme.app.e2e.equal-pay-body.v1') ?? 'null',
    ));
    expect(body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ fraction_bps: 3333 }),
    ]));
  });

  /**
   * 🔴 CORTE · lo que H-14 cuida en `consumo` —la selección determina el
   * monto— sigue vivo y se afirma igual (`.qc-parte`, fila «Mi parte»). Lo
   * que cambia es el final: no hay «Continuar», no hay pantalla de pago, y
   * elegir NO reserva el ítem —el corte va ANTES de `api.lockItems`, así que
   * los `claims` del mock quedan como estaban—. Sin esa última afirmación, un
   * corte puesto DESPUÉS del lock pasaría igual y dejaría ítems reservados diez
   * minutos para nadie.
   *
   * El feedback «toast + scroll + pulso» del Continuar sin elegir (§5 bis · E,
   * P62) queda dormido con el control; vuelve con él.
   */
  test('consumo: elegir sigue vivo, NINGÚN control lleva al pago y la selección SÍ queda registrada (corte)', async ({ page }) => {
    await conRielApagado(page);
    await ingresar(page);
    await page.goto('/#/mesa/PA-2847');
    await expect(page.locator('.mesa-selection-title')).toContainText('cada uno lo suyo');
    await expect(page.getByText('Los pagos llegan pronto; tu selección queda registrada.')).toHaveCount(0);

    await expect(page.getByText('Tagliatelle Bolognese')).toBeVisible();
    await expect(page.getByText('Elige lo que consumiste', { exact: true })).toHaveCount(0);

    // La única salida del círculo es «Listo», y lleva a Inicio (abajo).
    await expect(page.getByRole('button', { name: 'Listo', exact: true })).toBeEnabled();

    const claimsDe = () => page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('payme_mock_state_v1')!);
      const mesa = st.mesas.find((m: { code: string }) => m.code === 'PA-2847');
      const item = mesa.items.find((i: { name: string }) => i.name === 'Tagliatelle Bolognese');
      return (item.claims ?? []).length as number;
    });
    const antes = await claimsDe();

    // La selección y su aritmética siguen: es lo que la pantalla ofrece.
    await page.getByText('Tagliatelle Bolognese').click();
    const fracciones = page.getByRole('radiogroup', { name: 'Porción de Tagliatelle Bolognese' });
    await expect(fracciones.getByRole('radio')).toHaveText(['Entero', '½', '⅓', '¼']);
    // ⅓ de $195 no es exacto: 6499.35 centavos se redondean a 6499.
    await fracciones.getByRole('radio', { name: '⅓', exact: true }).click();
    await expect(page.locator('.qc-renglon[data-plato="Tagliatelle Bolognese"] .qc-parte')).toHaveText('$64.99');
    const filaMiParte = page.locator('.mi-parte');
    await expect(filaMiParte).toContainText('$64.99');

    // Con la selección hecha sigue sin haber pago.
    await expect(page.getByRole('heading', { name: 'Pagar mi parte' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    // Decisión 32 · registra y vuelve a Inicio.
    await expect.poll(() => page.evaluate(() => location.pathname)).toBe('/home');

    /**
     * 🔴 **D-R8 invirtió esta aserción, y el motivo viejo era correcto.**
     *
     * Decía: *«nada se reservó: el corte fue ANTES del lock»*, porque un lock
     * sin pago detrás era un ítem retenido diez minutos para nadie. **Con C3 ese
     * motivo desaparece**: el dueño publica `item_lock_seconds: null` con el
     * dinero apagado, o sea que la reserva NO vence. Sin vencimiento, reservar
     * es lo único que hace verdadera la promesa que la persona acaba de leer —
     * «tu selección queda registrada»—, y no hacerlo dejaba ese aviso mintiendo.
     */
    await expect(page.getByText('Los pagos llegan pronto; tu selección queda registrada.')).toHaveCount(0);
    expect(await claimsDe(), 'la selección no quedó registrada: el aviso promete algo que no ocurre').toBeGreaterThan(antes);
  });
});

for (const width of [320, 390]) {
  test(`Mis ítems conserva scroll propio y deja el final sobre la barra · ${width}×844`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await ingresar(page);
    await page.goto('/#/mesa/PA-2847');

    // Dos platos marcados. Desde la decisión 90 el selector vive DENTRO del
    // renglón y hay uno solo abierto a la vez (regla 3: «nada flota encima de
    // otros platos»): marcar el segundo cierra el del primero.
    await page.getByRole('button', { name: 'Tagliatelle Bolognese', exact: true }).click();
    await page.getByRole('button', { name: 'Risotto ai Funghi', exact: true }).click();
    await expect(page.getByRole('radiogroup')).toHaveCount(1);

    const scroll = page.locator('.screen > .scroll.flow-scroll');
    const shell = page.locator('.app');
    const initial = await scroll.evaluate((node) => ({
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      overflowY: getComputedStyle(node).overflowY,
    }));
    expect(initial.scrollHeight).toBeGreaterThan(initial.clientHeight);
    expect(initial.overflowY).toBe('auto');

    const outer = await shell.evaluate((node) => ({
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      overflow: getComputedStyle(node).overflow,
    }));
    expect(outer.scrollHeight).toBe(outer.clientHeight);
    expect(outer.overflow).toBe('hidden');

    const atEnd = await scroll.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
      return {
        max: node.scrollHeight - node.clientHeight,
        scrollTop: node.scrollTop,
      };
    });
    expect(atEnd.scrollTop).toBeGreaterThanOrEqual(atEnd.max - 1);

    const lastItem = await page.getByRole('button', { name: 'Vino tinto (copa)', exact: true }).boundingBox();
    const lastAction = await page.getByRole('button', { name: 'Invitar amigos de PayMe', exact: true }).boundingBox();
    const appbar = await page.locator('.screen > .appbar-block .appbar').boundingBox();
    expect(lastItem).not.toBeNull();
    expect(lastAction).not.toBeNull();
    expect(appbar).not.toBeNull();
    expect(lastItem!.y).toBeGreaterThanOrEqual(0);
    expect(lastAction!.y).toBeGreaterThanOrEqual(0);
    expect(lastAction!.y + lastAction!.height).toBeLessThanOrEqual(appbar!.y + 1);
  });
}
