import { expect, test } from '@playwright/test';
import { ingresar } from './_app';

/**
 * IDIOMA · lo único que caza la copy que sigue en español CON TODO EN VERDE.
 *
 * 🔴 POR QUÉ ESTE RECORRIDO EXISTE, y son tres fallas reales del 2026-08-10:
 *
 *  1. **La guarda de cobertura no alcanza.** `traduccion.test.ts` mira los
 *     `t()` que EXISTEN, no los que faltan. El bloque de demo de `Más` quedó
 *     con el rótulo en inglés y el cuerpo en español —JSX partido en dos
 *     líneas— y la guarda pasó en verde.
 *  2. **Un detector de español escrito a mano tampoco.** El mío no vio «Pago en
 *     curso»: la frase no lleva ni un acento y ninguna de sus palabras estaba
 *     en mi lista. **Un discriminador incompleto informa lo mismo que una
 *     pantalla limpia.**
 *  3. **Lo que sí funciona es DERIVAR la lista**: si un texto visible coincide
 *     EXACTAMENTE con una clave del diccionario, es español que tenía
 *     traducción y no se aplicó. Sin lista a mano y sin heurística.
 *
 * ⚠️ Lo que NO cubre, dicho: copy compuesta cuya forma final no es una clave
 * (se arma interpolando), datos del restaurante, nombres de personas y copy del
 * backend que el mock replica. Esas cuatro clases se ven en español a propósito.
 *
 * 🔴 **Y EL LÍMITE QUE MÁS ENGAÑA, medido el 2026-08-11: este barrido mide UNA
 * PANTALLA, no una pantalla POSIBLE.**
 *
 * `· Vence 08/28` quedó en español dentro de la app en inglés **con este
 * recorrido en verde**. La traducción existía; el código nunca la usaba. No la
 * vio porque **la fila sólo se renderiza cuando hay tarjetas cargadas**, y el
 * DOM que se recorre es el del estado en el que uno está.
 *
 * ```
 * el barrido ve   lo RENDERIZADO en el estado actual
 * no ve           filas condicionadas por datos, estados de error,
 *                 pantallas detrás de un flujo, superficie gateada por IS_MOCK
 * ```
 *
 * **Recorrer más rutas no lo arregla: hay que recorrer más ESTADOS**, y eso no
 * se deriva de una lista de rutas. Queda como límite declarado, no resuelto —
 * la red que lo agarra sigue siendo mirar la pantalla con datos distintos.
 */

const RUTAS = ['home', 'mesas', 'amigos', 'mas', 'tarjetas', 'avisos', 'pagos'] as const;

test.describe('la app en inglés no deja copy en español', () => {
  test('🔴 ningún texto visible coincide con una clave del diccionario', async ({ page }) => {
    await ingresar(page);

    // Se cambia el idioma por la MISMA fila que usa una persona, no tocando
    // `localStorage`: si el selector se rompe, esto tiene que caer con él.
    await page.goto('/#/mas');
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    const sinTraducir: Record<string, string[]> = {};
    for (const ruta of RUTAS) {
      await page.goto(`/#/${ruta}`);
      await page.waitForTimeout(400);
      const hits = await page.evaluate(async () => {
        /**
         * 🔴 El especificador va por VARIABLE, y no es estilo: este `import()`
         * lo resuelve VITE EN EL NAVEGADOR, pero `tsc` type-chequea el archivo
         * e intenta resolverlo como módulo del proyecto — y falla.
         *
         * Lo destapó CI, no mi gate local, y el motivo importa más que el
         * defecto: **yo verifiqué con `tsc -b` y CI corre `npm run typecheck`,
         * que son comandos distintos.** Verificar con un instrumento que no es
         * el del gate deja pasar justo lo que el gate mira.
         */
        const ruta = '/src/i18n/' + 'en.ts';
        const mod = await import(/* @vite-ignore */ ruta);
        const claves = new Set(
          Object.keys((mod as { EN: Record<string, string> }).EN)
            // Las plantillas nunca aparecen literales en pantalla, y las que
            // traducen a sí mismas («Email») no son defecto.
            .filter((k) => !k.includes('{') && (mod as { EN: Record<string, string> }).EN[k] !== k),
        );
        const out: string[] = [];
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          const s = (n.textContent ?? '').trim();
          if (!s || !claves.has(s)) continue;
          const el = n.parentElement;
          if (!el) continue;
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) out.push(s);
        }
        return [...new Set(out)];
      });
      if (hits.length) sinTraducir[ruta] = hits;
    }

    expect(
      sinTraducir,
      'Estas frases tienen traducción y se están mostrando en español:\n'
        + JSON.stringify(sinTraducir, null, 2),
    ).toEqual({});
  });

  /**
   * 🔴 CONTROL POSITIVO. Sin esto, el test de arriba pasaría en verde con el
   * diccionario vacío, con el selector roto o con el walker mirando el nodo
   * equivocado — y «cero hallazgos» se leería como «está todo traducido».
   */
  test('🔴 SONDA · el recorrido SÍ puede encontrar algo · si no, no prueba nada', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/mas');
    await page.getByRole('button', { name: 'EN', exact: true }).click();

    const loVio = await page.evaluate(async () => {
      const ruta = '/src/i18n/' + 'en.ts';        // ver la nota de arriba
      const mod = await import(/* @vite-ignore */ ruta);
      const EN = (mod as { EN: Record<string, string> }).EN;
      const clave = Object.keys(EN).find((k) => !k.includes('{') && EN[k] !== k)!;
      const d = document.createElement('div');
      d.textContent = clave;                 // se planta español CON traducción
      document.body.appendChild(d);
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let visto = false;
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if ((n.textContent ?? '').trim() === clave) { visto = true; break; }
      }
      d.remove();
      return visto;
    });
    expect(loVio, 'el barrido no ve una violación plantada: no prueba nada').toBe(true);
  });

  test('el selector cambia el idioma y sobrevive a la recarga', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/mas');
    await expect(page.getByText('Idioma', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await expect(page.getByText('Language', { exact: true })).toBeVisible();

    // Por dispositivo (`D-IDIOMA-2`): sin backend, sobrevive al reload.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByText('Language', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'ES', exact: true }).click();
    await expect(page.getByText('Idioma', { exact: true })).toBeVisible();
  });
});
