import { expect, test, type Locator, type Page } from '@playwright/test';
import { abrirMesaConLink, ingresar } from './_app';

/**
 * AF-QUE-CONSUMISTE · decisión 90 de Mati · «¿Qué consumiste?» construido del
 * diseño de Claude Design (`ops/bibliotecario-claude-20260917/
 * DISENO_CLAUDE_DESIGN_QUE_CONSUMISTE_20260926/PANTALLA-que-consumiste.md`,
 * sha256 fabae11b…). Un caso por estado del diseño y por regla.
 *
 * Mesa del mock: la del organizador (La Parolaccia, $840.00, 4 personas), con
 * los pagos apagados como en producción. Para «Queda ½» y «Lo eligió otro» se
 * plantan tenencias de OTRA persona (`who: 'guest'`) en el estado del mock, en
 * memoria y con su `persist()`, y se recarga.
 */

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png` });
}

async function abrirMesa(page: Page, modo: 'consumo' | 'igual' = 'consumo'): Promise<string> {
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
  await ingresar(page);
  const mesa = await abrirMesaConLink(page, { sinGarantia: true, modo });
  await page.goto(`/mesa/${mesa.code}`);
  await expect(page.getByRole('heading', { name: '¿Qué consumiste?', exact: true })).toBeVisible();
  return mesa.code;
}

/** Otra persona tomó ½ Pizza y el Tiramisú entero: «Queda ½» y «Lo eligió otro». */
async function plantarAjenos(page: Page, code: string): Promise<void> {
  await page.evaluate(async (c) => {
    const ruta = '/src/api/mock/store.ts';
    const store = await import(/* @vite-ignore */ ruta) as {
      state: { mesas: Array<{ code: string; items: Array<{ name: string; claims: unknown[] }> }> };
      persist: () => void;
    };
    const mesa = store.state.mesas.find((m) => m.code === c);
    if (!mesa) throw new Error(`mesa ${c} ausente`);
    mesa.items.find((i) => i.name === 'Pizza Margherita')!.claims = [
      { who: 'guest', fraction_bps: 5000, amount_cents: null, status: 'locked' },
    ];
    mesa.items.find((i) => i.name === 'Tiramisú')!.claims = [
      { who: 'guest', fraction_bps: 10000, amount_cents: null, status: 'locked' },
    ];
    store.persist();
    await new Promise<void>((r) => queueMicrotask(r));
  }, code);
  await page.reload();
  await expect(page.getByRole('heading', { name: '¿Qué consumiste?', exact: true })).toBeVisible();
}

/**
 * El renglón por el plato (`data-plato`), no por su texto: con el selector
 * abierto el renglón muestra las porciones en lugar del nombre, como el diseño.
 * El primero si hay dos (el mock separa los dos Tiramisú).
 */
const renglon = (page: Page, nombre: string): Locator =>
  page.locator(`.qc-renglon[data-plato="${nombre}"]`).first();
/** El alto del renglón visible (`.qc-fila`), sin el separador de 1 px. */
const alto = (l: Locator) => l.locator('.qc-fila').evaluate((e) => e.getBoundingClientRect().height);
const arriba = (l: Locator) => l.evaluate((e) => e.getBoundingClientRect().top);
/**
 * Regla 7 por su efecto, no por cómo se escribe: los trazos que se PINTAN.
 * `check` es el glifo del círculo marcado; `M9 9l6 6` es el trazo de la X de
 * `x-circle` (`src/components/Icon.tsx`). Una guarda textual sobre el código
 * sólo ve una forma de escribirlo (`'x-circle'`), y el mutante con comillas
 * dobles le pasó por al lado.
 */
const CHECK = 'M5 12.5l4.7 4.7L19 7.5';
const TRAZO_X = 'M9 9l6 6';

test.describe('AF-QUE-CONSUMISTE · «¿Qué consumiste?» del diseño', () => {
  /**
   * «Estados que muestra el ejemplo» del diseño, todos juntos y en el mismo
   * orden: sin elegir (Tagliatelle, Risotto, Vino), «Queda ½» (Pizza), «Lo eligió
   * otro» (primer Tiramisú, a mitad de la lista), mío entero (segundo Tiramisú) y
   * mío ½ (Agua mineral). Es la captura que va lado a lado con el prototipo.
   */
  test('el ejemplo del diseño · los cinco estados a la vez, y «Mi parte · 2 platos» $90.00', async ({ page }) => {
    const code = await abrirMesa(page);
    await plantarAjenos(page, code);
    await page.getByRole('button', { name: 'Tiramisú', exact: true }).click();
    await page.locator('.qc-renglon[data-plato="Tiramisú"]').nth(1).getByRole('radio', { name: 'Entero' }).click();
    await page.getByRole('button', { name: 'Agua mineral', exact: true }).click();
    await renglon(page, 'Agua mineral').getByRole('radio', { name: '½' }).click();

    const estados = await page.locator('.qc-renglon').evaluateAll((rs) => rs.map((r) => [
      r.getAttribute('data-plato'),
      r.querySelector('[data-estado]')?.getAttribute('data-estado'),
      r.querySelector('.qc-pildora')?.textContent ?? null,
    ]));
    expect(estados).toEqual([
      ['Tagliatelle Bolognese', 'libre', null],
      ['Risotto ai Funghi', 'libre', null],
      ['Pizza Margherita', 'queda', 'Queda ½'],
      ['Tiramisú', 'tomado', null],
      ['Tiramisú', 'mio', 'Entero'],
      ['Agua mineral', 'mio', '½'],
      ['Vino tinto (copa)', 'libre', null],
    ]);
    await expect(page.locator('.mi-parte')).toContainText('Mi parte · 2 platos');
    await expect(page.locator('.mi-parte-amt')).toHaveText('$90.00');
    await capturar(page, 'qc-00-ejemplo');

    await renglon(page, 'Agua mineral').getByRole('button', { name: /^Cambiar la porción/ }).click();
    await expect(renglon(page, 'Agua mineral').getByRole('radio', { name: '½' })).toHaveAttribute('aria-checked', 'true');
    await capturar(page, 'qc-00-ejemplo-selector');
  });

  test('lo que se reemplaza ya no está: ni «¿Cuánto tomas tú?», ni «Tu parte:», ni la X roja, ni el borde punteado', async ({ page }) => {
    await abrirMesa(page);
    await expect(page.locator('.qc-lista')).not.toHaveClass(/tk-fold--pending/);
    await page.getByRole('button', { name: 'Tagliatelle Bolognese', exact: true }).click();
    await expect(page.getByText('¿Cuánto tomas tú?')).toHaveCount(0);
    await expect(page.getByText(/^Tu parte:/)).toHaveCount(0);
    await expect(page.locator('.mi-soltar, .mi-frac')).toHaveCount(0);
  });

  test('reglas 3 y 4 · marcar abre el selector EN el renglón con Entero · ½ · ⅓ · ¼ + «Soltar», y elegir lo cierra', async ({ page }) => {
    await abrirMesa(page);
    const tagliatelle = renglon(page, 'Tagliatelle Bolognese');
    await page.getByRole('button', { name: 'Tagliatelle Bolognese', exact: true }).click();
    const selector = tagliatelle.getByRole('radiogroup', { name: 'Porción de Tagliatelle Bolognese' });
    await expect(selector).toBeVisible();
    await expect(selector.getByRole('radio')).toHaveText(['Entero', '½', '⅓', '¼']);
    // Nace marcado con la mayor que cabe: Entero.
    await expect(selector.getByRole('radio', { name: 'Entero' })).toHaveAttribute('aria-checked', 'true');
    await expect(tagliatelle.getByRole('button', { name: 'Soltar', exact: true })).toBeVisible();
    await capturar(page, 'qc-02-selector');

    await selector.getByRole('radio', { name: '½' }).click();
    await expect(selector).toHaveCount(0);
    // Regla 2 · el renglón propio: la píldora con su porción y tu parte, sin el precio del plato.
    await expect(tagliatelle.locator('[data-estado="mio"]')).toBeVisible();
    await expect(tagliatelle.getByRole('button', { name: 'Cambiar la porción de Tagliatelle Bolognese: ½' })).toHaveText('½');
    await expect(tagliatelle.locator('.qc-parte')).toHaveText('$97.50');
    await expect(tagliatelle).not.toContainText('$195.00');
    // Regla 8 · «Mi parte · 1 plato» y el monto.
    await expect(page.locator('.mi-parte')).toContainText('Mi parte · 1 plato');
    await expect(page.locator('.mi-parte-amt')).toHaveText('$97.50');
    await capturar(page, 'qc-03-mio-medio');
  });

  test('regla 3 · la píldora vuelve a abrir el selector; «Soltar» deja el plato libre', async ({ page }) => {
    await abrirMesa(page);
    const risotto = renglon(page, 'Risotto ai Funghi');
    await page.getByRole('button', { name: 'Risotto ai Funghi', exact: true }).click();
    await risotto.getByRole('radio', { name: '⅓' }).click();
    await risotto.getByRole('button', { name: /^Cambiar la porción de Risotto ai Funghi/ }).click();
    await expect(risotto.getByRole('radio', { name: '⅓' })).toHaveAttribute('aria-checked', 'true');
    await risotto.getByRole('button', { name: 'Soltar', exact: true }).click();
    await expect(risotto.locator('[data-estado="libre"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Risotto ai Funghi', exact: true })).toBeVisible();
  });

  test('regla 7 · también se suelta tocando el círculo marcado', async ({ page }) => {
    await abrirMesa(page);
    const vino = renglon(page, 'Vino tinto (copa)');
    await page.getByRole('button', { name: 'Vino tinto (copa)', exact: true }).click();
    await vino.getByRole('radio', { name: 'Entero' }).click();
    const circulo = vino.getByRole('button', { name: 'Soltar Vino tinto (copa)' });
    await expect(circulo.locator('path')).toHaveAttribute('d', CHECK);
    await expect(page.locator(`.qc-lista path[d="${TRAZO_X}"]`)).toHaveCount(0);
    await circulo.click();
    await expect(vino.locator('[data-estado="libre"]')).toBeVisible();
  });

  test('reglas 5 y 6 · «Queda ½» como píldora que se puede tocar, sin Entero; «Lo eligió otro» en rojo pastel, con candado y sin nombre', async ({ page }) => {
    const code = await abrirMesa(page);
    await plantarAjenos(page, code);

    const pizza = renglon(page, 'Pizza Margherita');
    await expect(pizza.locator('[data-estado="queda"]')).toBeVisible();
    await expect(pizza.locator('.qc-pildora--queda')).toHaveText('Queda ½');
    await expect(pizza.locator('.qc-precio')).toHaveText('$185.00');

    const tiramisu = renglon(page, 'Tiramisú');
    const otro = tiramisu.locator('[data-estado="tomado"]');
    await expect(otro).toBeVisible();
    await expect(otro).toContainText('Lo eligió otro');
    await expect(otro.locator('.qc-candado')).toBeVisible();
    expect(await otro.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(251, 231, 227)');
    // No es tocable: el renglón no tiene ningún botón.
    await expect(tiramisu.getByRole('button')).toHaveCount(0);
    await capturar(page, 'qc-05-queda-y-otro');

    // Tomar lo que queda: sin Entero.
    await page.getByRole('button', { name: 'Pizza Margherita, Queda ½' }).click();
    await expect(pizza.getByRole('radio')).toHaveText(['½', '⅓', '¼']);
    await expect(pizza.getByRole('radio', { name: '½' })).toHaveAttribute('aria-checked', 'true');
  });

  test('regla 4 · con una sola opción se marca directo, sin abrir el selector', async ({ page }) => {
    const code = await abrirMesa(page);
    // Queda ¼ del Agua mineral: la única porción que cabe es ¼.
    await page.evaluate(async (c) => {
      const ruta = '/src/api/mock/store.ts';
      const store = await import(/* @vite-ignore */ ruta) as {
        state: { mesas: Array<{ code: string; items: Array<{ name: string; claims: unknown[] }> }> };
        persist: () => void;
      };
      const mesa = store.state.mesas.find((m) => m.code === c)!;
      mesa.items.find((i) => i.name === 'Agua mineral')!.claims = [
        { who: 'guest', fraction_bps: 7500, amount_cents: null, status: 'locked' },
      ];
      store.persist();
      await new Promise<void>((r) => queueMicrotask(r));
    }, code);
    await page.reload();
    const agua = renglon(page, 'Agua mineral');
    await page.getByRole('button', { name: 'Agua mineral, Queda ¼' }).click();
    await expect(agua.getByRole('radiogroup')).toHaveCount(0);
    await expect(agua.locator('[data-estado="mio"] .qc-pildora')).toHaveText('¼');
  });

  test('regla 1 · todos los renglones miden lo mismo: elegir, cambiar la porción o soltar no mueve la lista', async ({ page }) => {
    const code = await abrirMesa(page);
    await plantarAjenos(page, code);
    const libre = renglon(page, 'Risotto ai Funghi');
    const siguiente = renglon(page, 'Pizza Margherita');
    expect(await alto(libre)).toBeCloseTo(48, 0);
    expect(await alto(renglon(page, 'Tiramisú'))).toBeCloseTo(48, 0);
    const antes = await arriba(siguiente);

    await page.getByRole('button', { name: 'Risotto ai Funghi', exact: true }).click();
    // Abierto: el selector vive en el renglón; el siguiente no baja.
    const conSelector = await arriba(siguiente);
    await libre.getByRole('radio', { name: '½' }).click();
    const cerrado = await arriba(siguiente);
    // El propio mide 44 + 3 + 3 (diseño): 2 px más que el normal de 48.
    for (const [cuando, y] of [['con el selector', conSelector], ['con la píldora', cerrado]] as const) {
      expect(Math.abs(y - antes), `el siguiente se movió ${y - antes}px ${cuando}`).toBeLessThanOrEqual(2);
    }
    await libre.getByRole('button', { name: /^Cambiar la porción/ }).click();
    await libre.getByRole('button', { name: 'Soltar', exact: true }).click();
    expect(Math.abs((await arriba(siguiente)) - antes)).toBeLessThanOrEqual(1);
  });

  test('definición 4 · zona táctil de 44 px sin agrandar lo visible', async ({ page }) => {
    await abrirMesa(page);
    const tagliatelle = renglon(page, 'Tagliatelle Bolognese');
    await page.getByRole('button', { name: 'Tagliatelle Bolognese', exact: true }).click();
    const opcion = tagliatelle.getByRole('radio', { name: '½' });
    const soltar = tagliatelle.getByRole('button', { name: 'Soltar', exact: true });
    const medir = (l: Locator) => l.evaluate((e) => {
      const r = e.getBoundingClientRect();
      const x = r.left + r.width / 2;
      // Un toque 6 px por encima y por debajo de lo visible cae en el mismo control.
      const arriba = document.elementFromPoint(x, r.top - 6);
      const abajo = document.elementFromPoint(x, r.bottom + 6);
      return { visible: Math.round(r.height), arriba: arriba === e, abajo: abajo === e };
    });
    expect(await medir(opcion)).toEqual({ visible: 28, arriba: true, abajo: true });
    expect(await medir(soltar)).toEqual({ visible: 30, arriba: true, abajo: true });
    await opcion.click();
    const pildora = tagliatelle.getByRole('button', { name: /^Cambiar la porción/ });
    expect(await medir(pildora)).toEqual({ visible: 30, arriba: true, abajo: true });
  });

  test('regla 8 · la barra de avance y el reloj arriba, en la burbuja del título; abajo «Mi parte · N platos» y «Listo»', async ({ page }) => {
    await abrirMesa(page);
    const burbuja = page.locator('.mesa-selection-title');
    await expect(burbuja.getByRole('progressbar')).toBeVisible();
    await expect(burbuja.locator('.mi-meta-amt')).toHaveText(/^\$\d+\.\d{2} \/ \$840\.00 \(\d+%\)$/);
    await expect(burbuja.locator('.mi-count')).toBeVisible();
    await page.getByRole('button', { name: 'Tagliatelle Bolognese', exact: true }).click();
    await renglon(page, 'Tagliatelle Bolognese').getByRole('radio', { name: 'Entero' }).click();
    await page.getByRole('button', { name: 'Risotto ai Funghi', exact: true }).click();
    await renglon(page, 'Risotto ai Funghi').getByRole('radio', { name: '½' }).click();
    await expect(page.locator('.mi-parte')).toContainText('Mi parte · 2 platos');
    await expect(page.locator('.mi-parte-amt')).toHaveText('$305.00');
    await expect(page.getByRole('button', { name: 'Listo', exact: true })).toBeVisible();
    await capturar(page, 'qc-08-mi-parte');
  });

  test('definición 2 · una porción ya guardada fuera del selector (⅔) se sigue mostrando, pero no se ofrece', async ({ page }) => {
    const code = await abrirMesa(page);
    await page.evaluate(async (c) => {
      const ruta = '/src/api/mock/store.ts';
      const store = await import(/* @vite-ignore */ ruta) as {
        state: { mesas: Array<{ code: string; items: Array<{ name: string; claims: unknown[] }> }> };
        persist: () => void;
      };
      const mesa = store.state.mesas.find((m) => m.code === c);
      if (!mesa) throw new Error(`mesa ${c} ausente`);
      mesa.items.find((i) => i.name === 'Tagliatelle Bolognese')!.claims = [
        { who: 'user', fraction_bps: 6667, amount_cents: null, status: 'locked' },
      ];
      store.persist();
    }, code);
    await page.reload();
    const tagliatelle = renglon(page, 'Tagliatelle Bolognese');
    await expect(tagliatelle.locator('[data-estado="registrado"] .qc-pildora')).toHaveText('⅔');
    // Al marcar otro plato el selector ofrece sólo las cuatro: ni ⅔ ni ¾.
    await page.getByRole('button', { name: 'Risotto ai Funghi', exact: true }).click();
    await expect(renglon(page, 'Risotto ai Funghi').getByRole('radio')).toHaveText(['Entero', '½', '⅓', '¼']);
    await expect(page.getByRole('radio', { name: '⅔' })).toHaveCount(0);
    await expect(page.getByRole('radio', { name: '¾' })).toHaveCount(0);
    await capturar(page, 'qc-10-porcion-guardada');
  });

  test('definición 3 · en «partes iguales» se elige la porción igual que por consumo', async ({ page }) => {
    await abrirMesa(page, 'igual');
    await expect(page.locator('.mesa-selection-context')).toContainText('partes iguales');
    const tagliatelle = renglon(page, 'Tagliatelle Bolognese');
    await page.getByRole('button', { name: 'Tagliatelle Bolognese', exact: true }).click();
    await expect(tagliatelle.getByRole('radio')).toHaveText(['Entero', '½', '⅓', '¼']);
    await tagliatelle.getByRole('radio', { name: '½' }).click();
    await expect(tagliatelle.locator('[data-estado="mio"] .qc-pildora')).toContainText('½');
    // En «igual» la porción es una declaración: no se inventa un precio por
    // plato. Lo que se paga es el casillero fijo ($840 ÷ 4) de «Mi parte».
    await expect(tagliatelle.locator('.qc-parte')).toHaveCount(0);
    await expect(page.locator('.mi-parte-amt')).toHaveText('$210.00');
    await capturar(page, 'qc-09-igual');
  });
});
