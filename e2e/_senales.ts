import type { Page } from '@playwright/test';

/**
 * Espía del SCROLL, una de las tres señales de «frena explicando»
 * (`SISTEMA_DISENO.md` §5 bis · E).
 *
 * ## Por qué existe este archivo, y no es comodidad
 *
 * La regla exige **toast + scroll + pulso, las tres juntas**, y cada una se
 * afirma distinto:
 *
 * - el **toast** es texto en pantalla: `getByText`;
 * - el **pulso** deja una clase en el DOM: `toHaveClass`;
 * - el **scroll NO DEJA RASTRO**. `scrollIntoView` mueve el viewport y no
 *   cambia el DOM. Afirmar «el elemento está visible» no sirve de testigo — si
 *   ya estaba en pantalla, pasa igual sin que nadie haya scrolleado. **Ésa es
 *   la señal que necesita un espía, y es la única.**
 *
 * 🔴 **ESTO NACE DE UN BLOCK, no de prolijidad.** El dictamen P62 de Codex
 * plantó tres mutantes individuales —borrar el `scrollIntoView`, borrar el
 * `setItemsPulse`, borrar el `return`— y `mesa-igual-continuar` quedó **verde en
 * los tres**. El test observaba una sola de las tres señales obligatorias y la
 * declaraba como si cubriera las tres.
 *
 * ## Qué hace el espía, y por qué es UNO solo
 *
 * `scrollIntoView` se envuelve y **registra sobre qué elemento se llamó**: así
 * la señal pasa de invisible a afirmable, y borrar la llamada en el código deja
 * el registro vacío. Se instala con `addInitScript`, o sea antes de que corra un
 * solo módulo de la app.
 *
 * 🔴 **EL PULSO NO NECESITA ESPÍA, Y HABERLE PUESTO UNO FUE MI ERROR.** Escribí
 * primero un `MutationObserver` sobre el atributo `class`, suponiendo que la
 * clase se apagaría demasiado rápido para verla. **Lo medí y la suposición era
 * falsa**: una sonda leyó `card tk-fold tk-fold--pending tk-fold--pulse` mucho
 * después del click, porque bajo Playwright el `animationend` no llega a
 * dispararse y la clase **queda puesta**.
 *
 * O sea que el pulso se afirma con `toHaveClass`, que es un testigo directo,
 * determinista y que Playwright reintenta solo. Perdí un rato depurando un
 * observer que no hacía falta — y esa maquinaria, si quedaba en el repo, era
 * deuda que alguien iba a tener que entender. **Un espía se justifica cuando la
 * señal NO deja rastro; el scroll es el único de los tres que cumple eso.**
 */

/** Lo que el espía juntó desde que cargó la página. */
export interface Senales {
  /** `className` (o tag) de cada elemento sobre el que se llamó `scrollIntoView`. */
  readonly scrolls: readonly string[];
}

interface VentanaEspiada extends Window {
  __senales?: { scrolls: string[] };
}

/**
 * Instala el espía. Va ANTES de `page.goto`, siempre.
 *
 * No altera el comportamiento: `scrollIntoView` sigue llamando al original. Un
 * espía que cambia lo que mide no es un espía.
 */
export async function espiarScroll(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as VentanaEspiada;
    const registro = { scrolls: [] as string[] };
    w.__senales = registro;

    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (
      this: Element,
      ...args: Parameters<Element['scrollIntoView']>
    ): void {
      registro.scrolls.push(this.className || this.tagName);
      original.apply(this, args);
    };

  });
}

/** Lee lo que el espía juntó hasta ahora. */
export async function leerScrolls(page: Page): Promise<Senales> {
  return page.evaluate(() => {
    const w = window as VentanaEspiada;
    return { scrolls: w.__senales?.scrolls ?? [] };
  });
}
