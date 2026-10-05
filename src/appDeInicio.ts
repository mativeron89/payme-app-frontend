/**
 * D179 · E179b · la barra de abajo en la app de inicio de iOS, con los números
 * REALES del iPhone de Mati (panel de diagnóstico, 0.214.0, recién abierta y sin
 * scrollear; captura 11):
 *
 *   innerHeight 794 · clientHeight 793 · 100dvh 794 · 100svh 793
 *   100vh 852 · 100lvh 852 · outerHeight 852 · pantalla 852
 *   .app 0–794 · barra 704–794 · insets 59/34 · standalone true
 *
 * WebKit arranca la app de inicio con el viewport de layout corto (≈ 58 pt, casi
 * el inset de arriba), pero `100vh`/`100lvh` ya valen el alto de la pantalla.
 * `.app` medía `100dvh` (794) y la barra, anclada a su borde, terminaba 58 pt
 * antes del borde real.
 *
 * Lo que hace: marca `<html>` con una clase, sólo en la app de inicio de iOS
 * (`navigator.standalone === true`), y con ella la cadena `html → body → #root →
 * .app` mide `100lvh` (ver `global.css`). Safari normal no la tiene: ahí `100vh`
 * pondría la barra debajo de la barra del navegador.
 *
 * 0.214.0 probó otra cosa, un scroll de 1 px y vuelta al arrancar (el
 * «empujón»), y NO alcanzó: la captura 11 se tomó más de un segundo después de
 * abrir, con los dos empujones ya corridos, y el viewport seguía en 794. Un
 * scroll por código no hace que WebKit recalcule. Se retiró en 0.216.0.
 *
 * Distinto de 0.210.5, que CORTÓ la barra en 793: aquella hacía `.app`
 * `position: fixed` con el alto forzado por JS; WebKit recorta las capas fijas
 * al viewport corto. Ésta deja `.app` en el flujo (`relative`) y sólo cambia la
 * unidad. Deducido, no medido acá: que WebKit pinte el contenido del flujo hasta
 * 852 (debajo de 794 hoy se ve el fondo gris de la página, que es lo que sugiere
 * que sí). Lo dice el iPhone de Mati.
 */
export const CLASE_APP_DE_INICIO = 'app-de-inicio-ios';

/** La app de inicio de iOS: `navigator.standalone === true`, y nada más. */
export function esAppDeInicioIOS(nav: Navigator): boolean {
  return (nav as Navigator & { standalone?: unknown }).standalone === true;
}

/** Pone la clase en `<html>` si es la app de inicio de iOS. Va antes del primer render. */
export function marcarAppDeInicio(win: Window = window): boolean {
  const es = esAppDeInicioIOS(win.navigator);
  if (es) win.document.documentElement.classList.add(CLASE_APP_DE_INICIO);
  return es;
}
