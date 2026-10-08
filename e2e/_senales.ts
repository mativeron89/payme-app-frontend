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

interface VentanaConAvisos extends Window {
  __avisos?: string[];
}

/**
 * D231 · espía de los TOASTS, para afirmar que NO salió ninguno.
 *
 * 🔴 **`toHaveCount(0)` sobre el toast NO sirve de testigo, y lo cazó un
 * mutante.** La aserción reintenta hasta 5 s, y el toast se apaga solo a los
 * 2,4 s: con el toast de vuelta en el código, la aserción esperaba a que se
 * fuera y pasaba en verde. Una ausencia que se afirma esperando se cumple
 * siempre que lo prohibido sea pasajero.
 *
 * Por eso se anota cada texto que el toast llega a mostrar, desde que carga la
 * página, y al final se afirma que la lista está vacía (o lo que tenga).
 */
export async function espiarAvisos(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as VentanaConAvisos;
    const vistos: string[] = [];
    w.__avisos = vistos;
    const anotar = () => {
      document.querySelectorAll('.toast:not(.toast-hidden)').forEach((el) => {
        const texto = el.textContent ?? '';
        if (texto && vistos[vistos.length - 1] !== texto) vistos.push(texto);
      });
    };
    const empezar = () => {
      new MutationObserver(anotar).observe(document.body, {
        subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'],
      });
    };
    if (document.body) empezar();
    else document.addEventListener('DOMContentLoaded', empezar);
  });
}

/** Los textos que mostró el toast desde que cargó la página. */
export async function avisosVistos(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as VentanaConAvisos).__avisos ?? []);
}

interface VentanaConCargas extends Window {
  __cargas?: string[];
  __buscados?: string[];
}

/**
 * D237 · espía de los ESTADOS DE CARGA de las pestañas, para afirmar que en la
 * segunda visita no aparece ninguno (ni un cuadro). Como con los toasts, una
 * ausencia no se afirma esperando: se graba lo que aparece y al final se mira.
 *
 * Anota, en cada cambio del DOM:
 * - `sk:<clase>` por cada esqueleto (`.sk`, `.sk-neutro`) y `filas-sk:<n>` con
 *   cuántas filas esqueleto de lista hay a la vez (`.pago-row.sk`);
 * - `cargando:<texto>` por cada `.loading` que diga «Cargando…»;
 * - `texto:<t>` si aparece en la página alguno de los textos de
 *   `window.__buscados` (se pueden sumar después de cargar, ver `buscarTexto`);
 * - `iniciales:<nombre>` si la fila de un amigo de `window.__conFoto` se dibuja
 *   sin su foto.
 */
export async function espiarCargas(page: Page, opciones: { conFoto?: string[] } = {}): Promise<void> {
  await page.addInitScript((conFoto: string[]) => {
    const w = window as VentanaConCargas;
    const vistas: string[] = [];
    w.__cargas = vistas;
    w.__buscados = [];
    const anotar = () => {
      document.querySelectorAll('.sk, .sk-neutro').forEach((el) => vistas.push(`sk:${el.className}`));
      const filas = document.querySelectorAll('.pago-row.sk').length;
      if (filas > 0) vistas.push(`filas-sk:${filas}`);
      document.querySelectorAll('.loading').forEach((el) => {
        const texto = el.textContent ?? '';
        if (/Cargando/.test(texto)) vistas.push(`cargando:${texto}`);
      });
      const cuerpo = document.body.textContent ?? '';
      for (const buscado of w.__buscados ?? []) if (cuerpo.includes(buscado)) vistas.push(`texto:${buscado}`);
      document.querySelectorAll('.friend-row').forEach((fila) => {
        for (const nombre of conFoto) {
          if ((fila.textContent ?? '').includes(nombre) && !fila.querySelector('.friend-avatar-image')) vistas.push(`iniciales:${nombre}`);
        }
      });
    };
    const empezar = () => {
      new MutationObserver(anotar).observe(document.body, {
        subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'],
      });
    };
    if (document.body) empezar();
    else document.addEventListener('DOMContentLoaded', empezar);
  }, opciones.conFoto ?? []);
}

/** Suma un texto a buscar desde ahora (por ejemplo, el código de una mesa recién creada). */
export async function buscarTexto(page: Page, texto: string): Promise<void> {
  await page.evaluate((t) => { (window as VentanaConCargas).__buscados?.push(t); }, texto);
}

/** Cuántas anotaciones hay hasta ahora: se usa como marca. */
export async function marcaDeCargas(page: Page): Promise<number> {
  return page.evaluate(() => (window as VentanaConCargas).__cargas?.length ?? 0);
}

/** Las anotaciones desde la marca, sin repetidas. */
export async function cargasDesde(page: Page, marca: number): Promise<string[]> {
  return page.evaluate((m) => [...new Set(((window as VentanaConCargas).__cargas ?? []).slice(m))], marca);
}
