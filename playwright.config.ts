import { defineConfig, devices } from '@playwright/test';

/**
 * ORDEN 5 · el runner de navegador que cierra las anclas de 4B y 4C.
 *
 * ## Por qué existe, y por qué recién ahora
 *
 * Las órdenes 4B y 4C dejaron dos anclas **declaradas**: el botón Atrás real y
 * la redirección real necesitan un navegador, y esta suite no tenía ninguno —por
 * ratificación de Mati, que prohibió jsdom y Testing Library—. Playwright entra
 * en orden propia, autorizada explícitamente por Mati, y **no reemplaza nada**:
 * los 479 tests de vitest siguen exactamente donde estaban. Esto se suma arriba.
 *
 * ## Pocos caminos, y críticos
 *
 * Cuatro recorridos, por orden explícita. Los tests de navegador son lentos y
 * frágiles: se usan para los caminos donde una falla significa que alguien con
 * la tarjeta en la mano no puede terminar de pagar, nunca para cubrir todo. Lo
 * que se puede probar sin navegador **se sigue probando sin navegador**.
 *
 * ## Contra qué corre
 *
 * Contra el **modo mock** (`--mode mock` → `.env.mock` → `VITE_MOCK=1`), nunca
 * contra el backend real: ninguno de estos recorridos puede tocar dinero de
 * verdad ni depender de que haya un backend levantado.
 *
 * **Puerto 5176 y `strictPort`**, a propósito. El 5174 es `npm run dev` y el
 * 5175 es el riel de mock de otra sesión (`.claude/launch.json`). Elegir un
 * puerto propio es la misma lección que dejó `.env.mock`: **nunca le pises la
 * configuración corriendo a otra sesión abierta sobre el mismo repo**. Con
 * `strictPort`, si el 5176 está ocupado esto FALLA en vez de saltar a otro
 * puerto y correr contra vaya a saber qué.
 */
export default defineConfig({
  testDir: './e2e',

  // Sin `.only` colado en CI, y reintentos sólo ahí: un test que necesita
  // reintentar en local es un test que hay que arreglar, no reintentar.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  fullyParallel: true,

  // 10 s por expectativa. Si algo tarda más que eso en aparecer en una app mock
  // servida desde localhost, no está lento: está roto.
  expect: { timeout: 10_000 },

  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: 'http://localhost:5176',

    /**
     * 🔴 Acá decía `on-first-retry`, con el comentario *"traza sólo cuando algo
     * falla"*. **La traza nunca se capturaba en local, y el comentario tapaba
     * el hueco**: `retries` es 0 fuera de CI, así que no hay primer reintento
     * al cual engancharse. Una rama muerta con cartel de rama viva.
     *
     * Se descubrió el 2026-08-10 con un intermitente que apareció 3 de 6
     * corridas: `page.goto('/')` y la app no pinta nada hasta el timeout de
     * 30 s. Quedaron una captura en blanco y nada más — **y la captura la
     * borra la corrida siguiente**. Segunda vez que ese flake obligaba a
     * re-derivar todo desde cero, porque la anterior no dejó evidencia.
     *
     * 🔴 **Por qué NO se arregló subiendo `retries` en local.** Sería la otra
     * forma de que `on-first-retry` disparara, y es peor: **reintentar hasta
     * que pase es exactamente la conducta que vacía una compuerta de
     * publicación**, sólo que automatizada y sin que nadie la vea.
     * `retain-on-failure` deja la evidencia SIN reintentar nada.
     *
     * Costo MEDIDO, no estimado: verdes sin trace 175 · 167 · 208 s; la primera
     * con trace, 228 s **con dos timeouts de 30 s adentro** → ~168 s de trabajo
     * efectivo, dentro del rango previo. **El sobrecosto es chico.** Y se
     * descarta al pasar: una corrida verde no deja archivos (acreditado con una
     * sonda de dos tests, uno rojo y uno verde).
     *
     * ⭐ **Se pagó solo en la PRIMERA corrida.** El intermitente apareció, dejó
     * dos traces, y la causa estaba adentro: **`net::ERR_NETWORK_CHANGED`**, 25
     * requests abortados **en 8 ms** en un trace y 2 en el otro. No es
     * contención ni Vite: **la red del equipo cambia de configuración durante la
     * corrida y Chromium mata lo que está en vuelo**, se cae parte del grafo de
     * módulos y React nunca monta. Cuatro días de «ambiental» los cerró un
     * archivo de 356 KB.
     */
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  /**
   * **Un solo proyecto, y es un teléfono.** Esta app se usa en la mesa de un
   * restaurante: el desktop es el caso secundario. Correr la misma suite en tres
   * navegadores multiplicaría el tiempo y la fragilidad sin cubrir el riesgo
   * real, que es el móvil.
   *
   * Chromium con viewport y touch de iPhone, en vez del descriptor completo
   * `devices['iPhone 14']`: ese descriptor pide **WebKit**, y bajar un segundo
   * navegador para lo mismo no se justifica hoy. Queda anotado que Safari real
   * es el navegador de más riesgo de esta app —el link llega por WhatsApp y se
   * abre en un WebView de iOS— y que esto NO lo cubre.
   */
  projects: [
    {
      name: 'movil',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],

  webServer: {
    command: 'npx --no-install vite --port 5176 --strictPort --mode mock',
    url: 'http://localhost:5176',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
