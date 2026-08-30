import { expect, test, type Page, type Request, type Route } from '@playwright/test';

/**
 * APP-FE-META-PUBLIC-COMPLIANCE-01 · las dos superficies públicas, en navegador.
 *
 * ## Qué acredita esto que la unidad no puede
 *
 * Los tests de `src/` prueban el parser, el cliente y cada vista con el estado
 * puesto a mano. Lo que **sólo** se puede afirmar acá es el efecto observable
 * sobre la página servida:
 *
 *   · que un ACCESO DIRECTO y un RELOAD REAL a una ruta limpia levanten la
 *     página —el fallback, no el ruteo interno—;
 *   · que en esas rutas no queden `localStorage`, `sessionStorage` ni cookies,
 *     que es lo que el orden de `main.tsx` promete y su forma no demuestra;
 *   · que el `confirmation_code` no exista en ningún lado salvo el pathname;
 *   · qué requests salen de verdad.
 *
 * 🔴 **El censo de storage es la pieza que cierra el hueco declarado en
 * `main.tsx`.** Los `import` están izados, así que los módulos de la app se
 * evalúan igual en la rama pública. Que eso no deje rastro no se puede afirmar
 * leyendo el archivo: se mide acá, sobre el efecto.
 *
 * ## Contra qué corre
 *
 * Contra el riel mock (`vite --mode mock`), donde `VITE_API_URL` no está y el
 * cliente cae a `http://localhost:3000`. Ese endpoint **no existe** en la
 * corrida: cada test intercepta con `page.route` y sirve la respuesta del caso.
 * Es a propósito — el aviso legal no se inventa ni se copia, así que no hay
 * riel mock de aviso y los estados se producen en la red, no en el repo.
 *
 * ⚠️ Al interceptar hay que devolver `access-control-allow-origin`: la request
 * es cross-origin (5176 → 3000) y sin esa cabecera el navegador la corta antes
 * de que el cliente vea nada, y todos los casos darían «no verificable» —
 * verde por el motivo equivocado. Por eso hay un caso ✅ por cada endpoint: si
 * el CORS estuviera mal, esos dos caen.
 */

/** 24 caracteres, múltiplo de 4: un `confirmation_code` válido y reconocible. */
const CODIGO = 'SENTINELAxyz012345_-abcd';
const RUTA_ELIMINACION = `/facebook-data-deletion/${CODIGO}`;

const PATRON_AVISO = '**/api/legal/aviso_privacidad';
const PATRON_STATUS = '**/api/auth/facebook/data-deletion/status/**';

const AVISO = {
  legal_text: {
    kind: 'aviso_privacidad',
    version: '1.4.0',
    hash: 'a'.repeat(64),
    effective_from: '2026-08-01T00:00:00Z',
    body: 'Responsable del tratamiento: PayMe.\n\nFinalidades del tratamiento.',
  },
};

const CORS = { 'access-control-allow-origin': '*' } as const;

/** Sirve `cuerpo` como JSON con CORS. `tipo: null` omite el content-type. */
function json(
  cuerpo: unknown,
  { status = 200, tipo = 'application/json' }: { status?: number; tipo?: string | null } = {},
) {
  return async (route: Route): Promise<void> => {
    await route.fulfill({
      status,
      headers: { ...CORS, ...(tipo === null ? {} : { 'content-type': tipo }) },
      body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
    });
  };
}

/** Todo lo que la página pidió y todo lo que dijo por consola. */
interface Censo {
  readonly pedidos: Request[];
  readonly consola: string[];
  readonly errores: string[];
}

function censar(page: Page): Censo {
  const censo: Censo = { pedidos: [], consola: [], errores: [] };
  page.on('request', (r) => censo.pedidos.push(r));
  page.on('console', (m) => censo.consola.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => censo.errores.push(String(e)));
  return censo;
}

/** Los hosts distintos del propio origen de la página. */
const hostsExternos = (censo: Censo): string[] => [
  ...new Set(
    censo.pedidos
      .map((r) => new URL(r.url()).host)
      .filter((h) => h !== 'localhost:5176'),
  ),
];

/**
 * Las URLs DISTINTAS que la página le pidió al backend.
 *
 * 🔴 Se filtra por HOST y no por «contiene `/api/`», y se de-duplica. Las dos
 * decisiones vienen de haber medido mal antes:
 *
 * ① el dev server de Vite sirve **cada módulo como un request**, así que
 *    `/src/api/storage.ts` entraba al censo como si fuera una llamada al
 *    backend. Son módulos same-origin del propio artefacto, y en un build de
 *    producción no existen: la pregunta del censo es a QUÉ BACKEND le habla la
 *    página, y eso se contesta por host.
 * ② en desarrollo `StrictMode` monta, desmonta y vuelve a montar, así que un
 *    efecto correcto dispara su fetch DOS veces. Eso no es un reintento del
 *    cliente —que **no** reintenta, acreditado en `src/api/publicLegal.test.ts`
 *    contando llamadas—: es React en dev. El censo pregunta *cuáles* endpoints,
 *    no *cuántas veces*, y por eso compara el conjunto.
 */
const backendPedido = (censo: Censo): string[] => [
  ...new Set(
    censo.pedidos.map((r) => r.url()).filter((u) => u.startsWith('http://localhost:3000')),
  ),
];

test.describe('/privacy · el aviso vigente sale del owner', () => {
  test('✅ acceso directo y RELOAD real muestran el aviso, versión y vigencia', async ({ page }) => {
    await page.route(PATRON_AVISO, json(AVISO));

    await page.goto('/privacy');
    await expect(page.getByRole('heading', { name: 'Aviso de privacidad' })).toBeVisible();
    await expect(page.getByText('Responsable del tratamiento: PayMe.')).toBeVisible();
    await expect(page.getByText('Versión 1.4.0')).toBeVisible();
    await expect(page.getByText('2026-08-01')).toBeVisible();

    // 🔴 El reload es el que prueba el fallback de ruta limpia: sin él sólo se
    // acreditaría que la app navegó internamente hasta acá, que no es el caso
    // de uso —Meta abre la URL en frío—.
    await page.reload();
    await expect(page.getByText('Responsable del tratamiento: PayMe.')).toBeVisible();
  });

  test('🔴 no verificable: lo dice, NO inventa aviso y reintenta sólo si se lo piden', async ({ page }) => {
    let pedidos = 0;
    await page.route(PATRON_AVISO, async (route) => {
      pedidos += 1;
      await json({ error: 'nope' }, { status: 500 })(route);
    });

    await page.goto('/privacy');
    await expect(page.getByText('No pudimos leer el aviso vigente')).toBeVisible();
    await expect(page.getByText('Responsable del tratamiento')).toHaveCount(0);

    /**
     * 🔴 EXACTAMENTE UNA REQUEST POR CARGA, y una más sólo al pulsar.
     *
     * ⚠️ Esto antes toleraba hasta DOS y lo declaraba como límite del
     * instrumento: `StrictMode` monta dos veces los efectos en desarrollo. La
     * auditoría diferencial lo devolvió como corrección, con razón — «hasta
     * dos» no distingue el doble montaje de un reintento real. **La rama
     * pública quedó fuera de `StrictMode`** (ver `main.tsx`), así que acá el
     * número es exacto y un reintento escondido se ve.
     */
    expect(pedidos, `pidió ${pedidos} veces la primera carga, y debe pedir 1`).toBe(1);

    /**
     * 🔴 VENTANA MEDIDA · la única espera por tiempo de este archivo, y va con
     * su motivo. La convención del repo prohíbe `waitForTimeout` porque
     * esperar tiempo para una aserción POSITIVA es apostar a la velocidad de la
     * máquina. Acá la aserción es NEGATIVA —que no pase nada—, y observar una
     * ausencia sin dejar correr el tiempo es imposible.
     */
    await page.waitForTimeout(1_500);
    expect(pedidos, 'reintentó solo durante la ventana medida').toBe(1);

    await page.getByRole('button', { name: 'Reintentar' }).click();
    await expect.poll(() => pedidos, { message: 'el botón no volvió a pedir' }).toBe(2);
    await page.waitForTimeout(1_000);
    expect(pedidos, 'el reintento manual disparó más de una request').toBe(2);
  });

  /**
   * 🔴 Y LA MISMA CUENTA EN LA PÁGINA DE ELIMINACIÓN, que no tiene botón: ahí
   * una sola request por carga es todo lo que puede haber.
   */
  test('🔴 eliminación: exactamente UNA request por carga, y ninguna repetición', async ({ page }) => {
    let consultas = 0;
    await page.route(PATRON_STATUS, async (route) => {
      consultas += 1;
      await json({ status: 'pending' })(route);
    });

    await page.goto(RUTA_ELIMINACION);
    await expect(page.getByText('Pendiente', { exact: true })).toBeVisible();
    expect(consultas, `consultó ${consultas} veces en una carga`).toBe(1);

    await page.waitForTimeout(1_500);
    expect(consultas, 'volvió a consultar sola').toBe(1);

    // Y una recarga es una carga nueva: una más, no dos.
    await page.reload();
    await expect(page.getByText('Pendiente', { exact: true })).toBeVisible();
    expect(consultas, 'la recarga no pidió exactamente una vez').toBe(2);
  });

  test('🔴 un 200 con shape inválido NO se publica como aviso', async ({ page }) => {
    await page.route(PATRON_AVISO, json({ legal_text: { kind: 'aviso_campanas' } }));
    await page.goto('/privacy');
    await expect(page.getByText('No pudimos leer el aviso vigente')).toBeVisible();
  });
});

test.describe('/facebook-data-deletion · la matriz de estados', () => {
  const casos = [
    ['pendiente', json({ status: 'pending' }), 'Pendiente'],
    ['completada', json({ status: 'completed' }), 'Completada'],
    ['no encontrada (404)', json({ error: 'not_found' }, { status: 404 }), 'No encontrada'],
    ['5xx', json({}, { status: 503 }), 'No verificable'],
    ['shape inválido con 200', json({ status: 'deleted' }), 'No verificable'],
    ['MIME inválido con 200', json('<html></html>', { tipo: 'text/html' }), 'No verificable'],
    ['JSON roto', json('{"status":', {}), 'No verificable'],
  ] as const;

  for (const [nombre, handler, esperado] of casos) {
    test(`✅ ${nombre} ⇒ «${esperado}»`, async ({ page }) => {
      await page.route(PATRON_STATUS, handler);
      await page.goto(RUTA_ELIMINACION);
      await expect(page.getByText(esperado, { exact: true })).toBeVisible();
    });
  }

  /**
   * Red cortada. **No es el deadline**: el deadline de 8 s se acredita en
   * `src/api/publicLegal.test.ts`, que puede moverlo. Acá se prueba el otro
   * camino que llega al mismo veredicto, y se dice cuál es cuál.
   */
  test('✅ red cortada ⇒ «No verificable»', async ({ page }) => {
    await page.route(PATRON_STATUS, (route) => route.abort('connectionfailed'));
    await page.goto(RUTA_ELIMINACION);
    await expect(page.getByText('No verificable', { exact: true })).toBeVisible();
  });

  test('🔴 un código con forma inválida NO consulta nada y dice No encontrada', async ({ page }) => {
    let consultas = 0;
    await page.route(PATRON_STATUS, async (route) => {
      consultas += 1;
      await json({ status: 'completed' })(route);
    });

    await page.goto('/facebook-data-deletion/corto');
    await expect(page.getByText('No encontrada', { exact: true })).toBeVisible();
    expect(consultas, 'un código inválido salió a la red igual').toBe(0);
  });

  test('✅ acceso directo y RELOAD real sobre la ruta con código', async ({ page }) => {
    await page.route(PATRON_STATUS, json({ status: 'pending' }));
    await page.goto(RUTA_ELIMINACION);
    await expect(page.getByText('Pendiente', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('Pendiente', { exact: true })).toBeVisible();
  });
});

test.describe('🔴 CENSO DE RED · cada página pide su endpoint owner y nada más', () => {
  test('/privacy no pide sesión, config, Stripe, GIS, Meta ni analytics', async ({ page }) => {
    const censo = censar(page);
    await page.route(PATRON_AVISO, json(AVISO));
    await page.goto('/privacy');
    await expect(page.getByText('Responsable del tratamiento: PayMe.')).toBeVisible();

    expect(backendPedido(censo), 'salió una request que no es el aviso owner')
      .toEqual(['http://localhost:3000/api/legal/aviso_privacidad']);
    expect(hostsExternos(censo), 'la página habló con un host que no es su backend')
      .toEqual(['localhost:3000']);
    expect(censo.errores, 'la página tiró un error').toEqual([]);
  });

  test('/facebook-data-deletion pide sólo el status, con su código', async ({ page }) => {
    const censo = censar(page);
    await page.route(PATRON_STATUS, json({ status: 'pending' }));
    await page.goto(RUTA_ELIMINACION);
    await expect(page.getByText('Pendiente', { exact: true })).toBeVisible();

    expect(backendPedido(censo)).toEqual([
      `http://localhost:3000/api/auth/facebook/data-deletion/status/${CODIGO}`,
    ]);
    expect(hostsExternos(censo)).toEqual(['localhost:3000']);
    expect(censo.errores).toEqual([]);
  });

  /**
   * 🔴 CONTROL POSITIVO DEL CENSO · SE PLANTA UNA LLAMADA DE MÁS.
   *
   * La primera versión de este control abría `/` y esperaba ver un `GET
   * /api/config`. **La premisa era falsa y el test lo demostró:** la corrida es
   * en modo mock, donde el adapter contesta en memoria y la app **nunca** habla
   * con `localhost:3000`. O sea que el control positivo se apoyaba en tráfico
   * que no existe.
   *
   * Lo que sí discrimina, y no depende del riel: plantar una llamada extra
   * desde la propia página y exigir que el censo la vea y rompa la igualdad.
   * Sin esto, el `toEqual([un solo endpoint])` de los tests de arriba podría
   * estar pasando con un instrumento mudo.
   */
  test('🔴 el censo DISCRIMINA · una llamada de más al backend se ve', async ({ page }) => {
    const censo = censar(page);
    await page.route(PATRON_AVISO, json(AVISO));
    await page.route('**/api/config', json({ features: {} }));

    await page.goto('/privacy');
    await expect(page.getByText('Responsable del tratamiento: PayMe.')).toBeVisible();

    const limpio = backendPedido(censo);
    expect(limpio, 'la página limpia no pidió sólo su endpoint owner')
      .toEqual(['http://localhost:3000/api/legal/aviso_privacidad']);

    await page.evaluate(
      () => fetch('http://localhost:3000/api/config').catch(() => undefined),
    );
    await expect.poll(
      () => backendPedido(censo).length,
      { message: 'el censo no registró la llamada plantada: es un instrumento mudo' },
    ).toBe(2);
    expect(backendPedido(censo), 'el censo no distingue una llamada de más')
      .not.toEqual(limpio);
  });

  test('🔴 la request del status no lleva `referer` con el código', async ({ page }) => {
    let cabeceras: Record<string, string> = {};
    await page.route(PATRON_STATUS, async (route) => {
      cabeceras = route.request().headers();
      await json({ status: 'pending' })(route);
    });
    await page.goto(RUTA_ELIMINACION);
    await expect(page.getByText('Pendiente', { exact: true })).toBeVisible();

    expect(cabeceras['referer'] ?? '', 'el código viajó como referer')
      .not.toContain('SENTINELA');
    expect(cabeceras['cookie'], 'viajó una cookie a una ruta pública').toBeUndefined();
    expect(cabeceras['authorization'], 'viajó un token').toBeUndefined();
  });
});

test.describe('🔴 CENSO DE RASTRO · el código no existe fuera del pathname', () => {
  test('ni en DOM, ni en título, ni en storage, ni en cookies, ni en consola', async ({ page }) => {
    const censo = censar(page);
    await page.route(PATRON_STATUS, json({ status: 'pending' }));
    await page.goto(RUTA_ELIMINACION);
    await expect(page.getByText('Pendiente', { exact: true })).toBeVisible();

    const rastro = await page.evaluate(() => ({
      html: document.documentElement.outerHTML,
      titulo: document.title,
      local: JSON.stringify(Object.entries(localStorage)),
      sesion: JSON.stringify(Object.entries(sessionStorage)),
      cookies: document.cookie,
      pathname: location.pathname,
    }));

    // Control positivo: el sentinela TIENE que estar donde sí se permite.
    expect(rastro.pathname, 'el código no llegó ni a la URL: no se probó nada')
      .toContain('SENTINELA');

    expect(rastro.html, 'el código salió al DOM').not.toContain('SENTINELA');
    expect(rastro.titulo, 'el código salió al título').not.toContain('SENTINELA');
    expect(rastro.local, 'el código quedó en localStorage').not.toContain('SENTINELA');
    expect(rastro.sesion, 'el código quedó en sessionStorage').not.toContain('SENTINELA');
    expect(rastro.cookies, 'el código quedó en una cookie').not.toContain('SENTINELA');
    expect(censo.consola.join('\n'), 'el código salió por consola').not.toContain('SENTINELA');
  });

  /**
   * 🔴 EL BOOTSTRAP DE SESIÓN NO CORRE · MEDIDO SOBRE SU EFECTO, no sobre su
   * ausencia de rastro.
   *
   * ⚠️ **Este test existe porque el mutante sobrevivió.** Cambié
   * `if (!rutaPublica)` por `if (true)` en `main.tsx` —o sea, los tres
   * bootstraps corriendo también en las rutas públicas— y **los 26 tests de
   * este archivo pasaron en verde**. El censo de storage no lo veía porque en
   * un `/privacy` pelado no hay token que capturar: el bootstrap corría y no
   * escribía nada. Un verde sobre el camino sano no dice nada del degradado.
   *
   * Lo que sí discrimina es EJERCITAR el camino: `bootstrapRecoveryTokenCapture`
   * **limpia el fragmento** cuando encuentra un token ahí. Si corre, el hash se
   * va; si no corre, queda intacto. Se abre la ruta pública con un fragmento de
   * recovery puesto y se exige que siga ahí.
   *
   * (El token es sintético y la página pública no lo lee ni lo muestra: lo que
   * se observa es si ALGUIEN lo tocó.)
   */
  test('🔴 con un fragmento de recovery puesto, el bootstrap NO lo captura', async ({ page }) => {
    await page.route(PATRON_AVISO, json(AVISO));
    const fragmento = '#/recovery?token=' + 'r'.repeat(43);

    await page.goto(`/privacy${fragmento}`);
    await expect(page.getByText('Responsable del tratamiento: PayMe.')).toBeVisible();

    expect(
      await page.evaluate(() => location.hash),
      'el fragmento se limpió: corrió un bootstrap de sesión en una ruta pública',
    ).toBe(fragmento);
  });

  /**
   * 🔴 CONTROL POSITIVO DEL TESTIGO. Si el bootstrap NO limpiara el fragmento
   * en ningún caso, el test de arriba pasaría con la guarda rota. La misma URL
   * sobre la app normal tiene que quedar limpia.
   */
  test('🔴 y en la app normal ese mismo fragmento SÍ se limpia', async ({ page }) => {
    const fragmento = '#/recovery?token=' + 'r'.repeat(43);
    await page.goto(`/${fragmento}`);
    await expect.poll(
      () => page.evaluate(() => location.hash),
      { message: 'el bootstrap no limpió el fragmento: el testigo no sirve como control' },
    ).not.toContain('token=');
  });

  /**
   * 🔴 CERO LECTURAS Y CERO ESCRITURAS DE STORAGE · INSTRUMENTADO ANTES DE QUE
   * CARGUE EL DOCUMENTO.
   *
   * ⚠️ **La versión anterior de este test miraba `localStorage.length` al final
   * y no alcanzaba.** El grafo privado se evaluaba igual —los `import`
   * estáticos están izados— y llegaba a un `localStorage.getItem()` de
   * inicialización. Una LECTURA no cambia `length`: el censo daba 0 y el
   * defecto seguía ahí. Lo encontró la auditoría diferencial de Codex.
   *
   * Ahora se instrumenta `Storage.prototype` con `addInitScript`, que corre
   * **antes de cualquier script de la página**, y se planta un valor sentinela
   * para que exista algo que leer. Cualquier `getItem`/`setItem`/`removeItem`/
   * `clear`/`key` queda registrado con su clave, venga de donde venga.
   */
  test('🔴 las dos rutas públicas no LEEN ni ESCRIBEN storage, ni dejan cookies', async ({ page, context }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __ops?: string[] };
      w.__ops = [];
      const metodos = ['getItem', 'setItem', 'removeItem', 'clear', 'key'] as const;
      for (const metodo of metodos) {
        const original = Storage.prototype[metodo] as (...a: unknown[]) => unknown;
        (Storage.prototype as unknown as Record<string, unknown>)[metodo] =
          function registrado(this: Storage, ...args: unknown[]): unknown {
            w.__ops!.push(`${metodo}(${String(args[0] ?? '')})`);
            return original.apply(this, args);
          };
      }
      // Hay algo que leer: sin sentinela, «cero lecturas» podría ser sólo un
      // storage vacío que nadie se molestó en consultar.
      localStorage.setItem('payme-centinela', 'valor-centinela');
      w.__ops = [];
    });

    await page.route(PATRON_AVISO, json(AVISO));
    await page.route(PATRON_STATUS, json({ status: 'pending' }));

    for (const [ruta, testigo] of [
      ['/privacy', 'Responsable del tratamiento: PayMe.'],
      [RUTA_ELIMINACION, 'Pendiente'],
    ] as const) {
      await page.goto(ruta);
      await expect(page.getByText(testigo)).toBeVisible();

      const ops = await page.evaluate(
        () => (window as unknown as { __ops: string[] }).__ops,
      );
      expect(ops, `${ruta} tocó storage: ${ops.join(' · ')}`).toEqual([]);
      expect(
        await page.evaluate(() => document.cookie),
        `${ruta} escribió cookies`,
      ).toBe('');
      expect(await context.cookies(), `${ruta} dejó cookies en el contexto`).toEqual([]);
    }
  });

  /**
   * 🔴 CONTROL POSITIVO DE LA INSTRUMENTACIÓN. Si el parche de
   * `Storage.prototype` no registrara nada, el test de arriba pasaría con la
   * app entera tocando storage. Se abre la app normal, que sí lo usa.
   */
  test('🔴 el instrumento de storage REGISTRA · la app normal sí lo toca', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __ops?: string[] };
      w.__ops = [];
      const original = Storage.prototype.getItem;
      Storage.prototype.getItem = function registrado(this: Storage, clave: string) {
        w.__ops!.push(`getItem(${clave})`);
        return original.call(this, clave);
      };
    });

    await page.goto('/');
    await expect(page.getByPlaceholder('Email')).toBeVisible();
    const ops = await page.evaluate(() => (window as unknown as { __ops: string[] }).__ops);
    expect(ops.length, 'el instrumento no vio nada: no sirve como censo').toBeGreaterThan(0);
  });
});

test.describe('accesibilidad y reflow', () => {
  const ANCHOS = [320, 390, 768, 1180] as const;

  /**
   * 🔴 ESPERAR A QUE EL SPLASH SE VAYA, y no es prolijidad.
   *
   * `#splash` es un overlay fijo de `index.html` que se retira en el primer
   * `requestAnimationFrame` después del montaje. **`toBeVisible()` sobre el
   * texto de la página puede ser verdadero mientras el splash lo tapa**, y la
   * primera corrida lo demostró: la captura de `eliminacion-768.png` salió
   * siendo el splash —el logo sobre navy— con el test en verde. Una evidencia
   * que no muestra lo que dice mostrar es peor que no tenerla.
   */
  const pantallaLista = async (page: Page): Promise<void> => {
    await expect(page.locator('#splash')).toHaveCount(0);
  };

  for (const ancho of ANCHOS) {
    test(`✅ ${ancho}px · sin scroll horizontal, con captura`, async ({ page }, info) => {
      await page.route(PATRON_AVISO, json(AVISO));
      await page.setViewportSize({ width: ancho, height: 900 });
      await page.goto('/privacy');
      await expect(page.getByRole('heading', { name: 'Aviso de privacidad' })).toBeVisible();
      await pantallaLista(page);

      const desborde = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(desborde, `la página desborda ${desborde}px a lo ancho`).toBeLessThanOrEqual(0);

      await page.screenshot({
        path: `test-results/meta-public/privacy-${ancho}.png`,
        fullPage: true,
      });
      info.annotations.push({ type: 'captura', description: `privacy-${ancho}.png` });
    });
  }

  test(`✅ ${ANCHOS.join('/')} · la página de eliminación también, con captura`, async ({ page }) => {
    await page.route(PATRON_STATUS, json({ status: 'pending' }));
    for (const ancho of ANCHOS) {
      await page.setViewportSize({ width: ancho, height: 900 });
      await page.goto(RUTA_ELIMINACION);
      await expect(page.getByText('Pendiente', { exact: true })).toBeVisible();
      await pantallaLista(page);
      const desborde = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(desborde, `desborda a ${ancho}px`).toBeLessThanOrEqual(0);
      await page.screenshot({
        path: `test-results/meta-public/eliminacion-${ancho}.png`,
        fullPage: true,
      });
    }
  });

  test('✅ landmarks, un solo h1 y el regreso a la app', async ({ page }) => {
    await page.route(PATRON_AVISO, json(AVISO));
    await page.goto('/privacy');
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('contentinfo')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Volver a PayMe' }))
      .toHaveAttribute('href', 'https://app.paymemx.com/');
  });

  /**
   * 🔴 CONTRASTE MEDIDO EN EL NAVEGADOR, contra el fondo EFECTIVO.
   *
   * No se copian los ratios de los comentarios del CSS: se leen los colores
   * computados del elemento vivo y se recorre hacia arriba hasta encontrar el
   * primer fondo no transparente, que es el que la persona ve detrás. Un ratio
   * escrito a mano en un comentario envejece; éste se vuelve a medir en cada
   * corrida.
   *
   * Para el indicador de foco el fondo que cuenta es el del ANCESTRO, no el del
   * control: `outline-offset: 2px` lo dibuja por fuera. Ese detalle es el que
   * destapó que un único color de foco para los tres controles dejaba al botón
   * en 2.39:1.
   */
  const SONDA_CONTRASTE = `
    (() => {
      const canal = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
      const lum = ([r, g, b]) => 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
      const rgb = (v) => (v.match(/\\d+(\\.\\d+)?/g) || []).slice(0, 3).map(Number);
      const opaco = (v) => { const p = (v.match(/\\d+(\\.\\d+)?/g) || []); return p.length < 4 || Number(p[3]) === 1; };
      const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
      const fondoDe = (nodo) => {
        for (let n = nodo; n; n = n.parentElement) {
          const bg = getComputedStyle(n).backgroundColor;
          if (bg && bg !== 'transparent' && opaco(bg) && !/rgba\\(0, 0, 0, 0\\)/.test(bg)) return rgb(bg);
        }
        return [255, 255, 255];
      };
      window.__contraste = (sel, quien) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        // El color del indicador sólo existe con el elemento ENFOCADO: la regla
        // vive en \`:focus-visible\`. Sin esto se lee el \`outlineColor\` por
        // defecto —\`currentColor\`— y el número no dice nada del foco.
        if (quien === 'foco') el.focus();
        const cs = getComputedStyle(el);
        const fondoPropio = fondoDe(el);
        const fondoDetras = fondoDe(el.parentElement || el);
        return quien === 'texto'
          ? ratio(rgb(cs.color), fondoPropio)
          : ratio(rgb(cs.outlineColor), fondoDetras);
      };
      return true;
    })()
  `;

  test('🔴 CONTRASTE · texto AA (4.5:1) en las dos páginas', async ({ page }) => {
    await page.route(PATRON_AVISO, json(AVISO));
    await page.goto('/privacy');
    await expect(page.getByText('Responsable del tratamiento: PayMe.')).toBeVisible();
    await page.evaluate(SONDA_CONTRASTE);

    const medir = (sel: string): Promise<number | null> =>
      page.evaluate((s) => (window as never as { __contraste: (a: string, b: string) => number | null })
        .__contraste(s, 'texto'), sel);

    for (const sel of ['.pub-marca', '.pub-h1', '.pub-meta', '.pub-cuerpo', '.pub-volver']) {
      const r = await medir(sel);
      expect(r, `${sel} no existe en la página: la medición sería vacía`).not.toBeNull();
      expect(r!, `${sel} da ${r!.toFixed(2)}:1 y AA pide 4.5:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('🔴 CONTRASTE · texto AA en eliminación, en sus cuatro estados', async ({ page }) => {
    for (const [cuerpo, marca] of [
      [{ status: 'pending' }, 'Pendiente'],
      [{ status: 'completed' }, 'Completada'],
      [{ error: 'x' }, 'No verificable'],
    ] as const) {
      await page.unrouteAll();
      await page.route(PATRON_STATUS, json(cuerpo));
      await page.goto(RUTA_ELIMINACION);
      await expect(page.getByText(marca, { exact: true })).toBeVisible();
      await page.evaluate(SONDA_CONTRASTE);

      for (const sel of ['.pub-badge', '.pub-nota']) {
        const r = await page.evaluate((s) => (window as never as {
          __contraste: (a: string, b: string) => number | null
        }).__contraste(s, 'texto'), sel);
        expect(r, `${sel} no está en el estado ${marca}`).not.toBeNull();
        expect(r!, `${sel} en ${marca} da ${r!.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  /**
   * 🔴 EL FOCO CONTRA SU FONDO EFECTIVO · ≥3:1 en los tres controles, y con el
   * control negativo que prueba que la sonda discrimina.
   */
  test('🔴 FOCO · indicador ≥3:1, y la sonda ve cuando NO se cumple', async ({ page }) => {
    await page.route(PATRON_AVISO, json({}, { status: 500 }));
    await page.goto('/privacy');
    await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible();
    await page.evaluate(SONDA_CONTRASTE);

    const foco = (sel: string): Promise<number | null> =>
      page.evaluate((s) => (window as never as {
        __contraste: (a: string, b: string) => number | null
      }).__contraste(s, 'foco'), sel);

    for (const sel of ['.pub-marca', '.pub-boton', '.pub-volver']) {
      const r = await foco(sel);
      expect(r, `${sel} no existe`).not.toBeNull();
      expect(r!, `el foco de ${sel} da ${r!.toFixed(2)}:1 y el mínimo es 3:1`)
        .toBeGreaterThanOrEqual(3);
    }

    /**
     * 🔴 CONTROL NEGATIVO limpio→roto→restaurado. Se le pone al botón el mismo
     * cian que lleva la marca —el color que la versión anterior usaba para los
     * tres— y se exige que la sonda lo repruebe. Sin esto, «≥3:1» podría ser
     * una sonda que devuelve un número alto siempre.
     */
    const limpio = await foco('.pub-boton');
    await page.evaluate(() => {
      const el = document.querySelector('.pub-boton') as HTMLElement;
      el.style.outlineColor = '#0fb5c9';
    });
    const roto = await foco('.pub-boton');
    expect(roto!, `el cian sobre el tinte claro debería reprobar y dio ${roto!.toFixed(2)}:1`)
      .toBeLessThan(3);

    await page.evaluate(() => {
      (document.querySelector('.pub-boton') as HTMLElement).style.outlineColor = '';
    });
    expect(await foco('.pub-boton'), 'no se restauró el estado limpio').toBeCloseTo(limpio!, 2);
  });

  /**
   * 🔴 ZOOM 200 % · se emula halvando el viewport, y lo digo en vez de
   * llamarlo «zoom» a secas: al 200 % el viewport CSS mide la mitad, así que
   * un ancho de 320 se comporta como 160. Es la equivalencia de reflow, no el
   * zoom del navegador —que Playwright no expone—.
   */
  for (const ancho of ANCHOS) {
    test(`🔴 ZOOM 200% a ${ancho}px · sin scroll horizontal, clipping ni overlap`, async ({ page }) => {
      await page.route(PATRON_AVISO, json(AVISO));
      await page.setViewportSize({ width: Math.round(ancho / 2), height: 640 });
      await page.goto('/privacy');
      await expect(page.getByRole('heading', { name: 'Aviso de privacidad' })).toBeVisible();
      await pantallaLista(page);

      const medida = await page.evaluate(() => {
        const raiz = document.documentElement;
        const clip: string[] = [];
        for (const el of Array.from(document.querySelectorAll('.pub *'))) {
          // Un texto recortado se delata porque su contenido es más ancho que
          // su caja y no hay scroll propio declarado.
          if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'visible') {
            clip.push(`${el.className}: ${el.scrollWidth}>${el.clientWidth}`);
          }
        }
        const caja = (s: string) => document.querySelector(s)!.getBoundingClientRect();
        const [top, main, pie] = ['.pub-top', '.pub-main', '.pub-pie'].map(caja);
        return {
          desborde: raiz.scrollWidth - raiz.clientWidth,
          clip,
          solapa: top!.bottom > main!.top + 1 || main!.bottom > pie!.top + 1,
        };
      });

      expect(medida.desborde, `desborda ${medida.desborde}px al 200%`).toBeLessThanOrEqual(0);
      expect(medida.clip, `contenido recortado al 200%: ${medida.clip.join(' · ')}`).toEqual([]);
      expect(medida.solapa, 'los landmarks se solapan al 200%').toBe(false);
    });
  }

  /**
   * 🔴 REDUCED-MOTION DEL SPLASH, medido sobre la hoja SERVIDA.
   *
   * El splash vive en un `<style>` de `index.html`, que esta orden no autoriza
   * a tocar; su animación se contiene desde `global.css`. Para medir la regla
   * real —y no una copia— se inserta un `#splash` de sonda y se lee su estilo
   * computado: el que responde es el stylesheet cargado, no el test.
   *
   * ⚠️ **Límite declarado:** en `npm run dev` la hoja la inyecta el módulo, así
   * que la ventana ANTERIOR al montaje no queda cubierta en ese riel. En el
   * build de producción `global.css` es un `<link>` del `<head>`, posterior al
   * `<style>` inline y con la misma especificidad, así que gana desde el primer
   * pintado.
   */
  test('🔴 REDUCED-MOTION · el splash pierde el fundido y conserva sus tiempos', async ({ page }) => {
    await page.route(PATRON_AVISO, json(AVISO));

    const animacionDelSplash = async (): Promise<{ dur: string; delay: string }> =>
      page.evaluate(() => {
        const sonda = document.createElement('div');
        sonda.id = 'splash';
        document.body.appendChild(sonda);
        const cs = getComputedStyle(sonda);
        const r = { dur: cs.animationDuration, delay: cs.animationDelay };
        sonda.remove();
        return r;
      });

    // limpio: con movimiento, el fundido de 200ms/400ms
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { name: 'Aviso de privacidad' })).toBeVisible();
    const conMovimiento = await animacionDelSplash();
    expect(conMovimiento.dur, 'la sonda no ve la animación original: mediría en vacío')
      .toBe('0.2s, 0.4s');

    // reducido: sin fundido, MISMOS tiempos de aparición y rendición
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Aviso de privacidad' })).toBeVisible();
    const reducido = await animacionDelSplash();
    expect(reducido.dur, 'sigue habiendo fundido con reduced-motion').toBe('0.001s, 0.001s');
    expect(
      reducido.delay,
      'se perdieron los tiempos: el splash debe seguir apareciendo a 300ms y rindiéndose a 12s',
    ).toBe(conMovimiento.delay);

    await page.emulateMedia({ reducedMotion: null });
  });

  /**
   * 🔴 `aria-live` ACOTADO AL CAMBIO DE ESTADO. El aviso legal completo vivía
   * adentro de la región viva y un lector de pantalla lo leía entero al
   * llegar la respuesta. Ahora la región cubre «cargando» y el error, y el
   * cuerpo queda afuera sin moverse de lugar en el orden de lectura.
   */
  test('🔴 ARIA-LIVE · la región viva no contiene el cuerpo legal', async ({ page }) => {
    await page.route(PATRON_AVISO, json(AVISO));
    await page.goto('/privacy');
    await expect(page.getByText('Responsable del tratamiento: PayMe.')).toBeVisible();

    const vivo = await page.evaluate(() => {
      const region = document.querySelector('[aria-live]');
      return {
        existe: region !== null,
        cantidad: document.querySelectorAll('[aria-live]').length,
        texto: region?.textContent ?? '',
        contieneCuerpo: region?.querySelector('.pub-cuerpo') !== null
          && region?.querySelector('.pub-cuerpo') !== undefined,
        cuerpoEnLaPagina: document.querySelector('.pub-cuerpo')?.textContent ?? '',
      };
    });

    expect(vivo.existe, 'no hay región viva').toBe(true);
    expect(vivo.cantidad, 'hay más de una región viva compitiendo').toBe(1);
    expect(vivo.contieneCuerpo, 'el aviso legal completo está dentro del aria-live').toBe(false);
    expect(vivo.texto, 'la región viva quedó anunciando el aviso')
      .not.toContain('Responsable del tratamiento');
    // Control positivo: el cuerpo SÍ está en la página, sólo que afuera.
    expect(vivo.cuerpoEnLaPagina, 'el cuerpo desapareció de la página')
      .toContain('Responsable del tratamiento');
  });

  test('✅ TECLADO · se llega al reintento y al regreso, con foco visible', async ({ page }) => {
    await page.route(PATRON_AVISO, json({}, { status: 500 }));
    await page.goto('/privacy');
    await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible();

    // Tres tabs: marca → reintentar → volver. Se afirma el ORDEN, que es lo que
    // decide si alguien que navega con teclado llega al control que necesita.
    const foco = async (): Promise<string> =>
      page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');

    await page.keyboard.press('Tab');
    expect(await foco()).toBe('PayMe');
    await page.keyboard.press('Tab');
    expect(await foco()).toBe('Reintentar');
    await page.keyboard.press('Tab');
    expect(await foco()).toBe('Volver a PayMe');

    // 3px de grosor y 2px de separación, en los tres controles: es la forma
    // que la orden fija, y se lee del estilo computado del elemento enfocado.
    for (const sel of ['.pub-marca', '.pub-boton', '.pub-volver']) {
      const trazo = await page.evaluate((s) => {
        const el = document.querySelector(s) as HTMLElement;
        el.focus();
        const cs = getComputedStyle(el);
        return { ancho: cs.outlineWidth, offset: cs.outlineOffset, estilo: cs.outlineStyle };
      }, sel);
      expect(trazo.ancho, `${sel} no dibuja 3px de foco`).toBe('3px');
      expect(trazo.offset, `${sel} no separa el foco 2px`).toBe('2px');
      expect(trazo.estilo, `${sel} no tiene un outline sólido`).toBe('solid');
    }
  });
});
