import { allowsCorteRoute } from './api/releaseGates';
import { replaceRoute, type PageId } from './router';

/**
 * CORTE DEL VIERNES · el gate de las rutas de tarjetas, como llamada ejecutable.
 *
 * Orden `APP-FE-FRIDAY-NO-PAY-GUARD-02-CLAUDE` (2026-09-01). El porqué del
 * corte y su predicado viven en `releaseGates.ts`; acá vive sólo el ACTO de
 * sacar a la persona de `#/tarjetas` y `#/cuenta`.
 *
 * ## Por qué es un módulo y no dos líneas dentro del `useEffect` de `App`
 *
 * Es el mismo molde que `walletRouteGuard.ts`, y por la misma razón: sin
 * librería de render —por ratificación de Mati— un efecto **no se ejecuta** en
 * la suite, así que mientras la redirección viviera adentro del efecto, ningún
 * test podría morir al neutralizarla. Una defensa declarada que nadie comprueba
 * ejecutada es lo mismo que no tenerla.
 *
 * Acá sí muere: `corteGuard.test.ts` recorre la cadena entera —predicado →
 * decisión → `replaceRoute` → historial → hash— y se pone rojo si se corta
 * cualquier eslabón. Lo que queda en `App.tsx` es **una** llamada, y que siga
 * ahí lo fija el guardarraíl de fuente de ese mismo test.
 *
 * ## Por qué `replaceRoute` y no `navigate`
 *
 * `navigate` deja `#/tarjetas` viva en el historial y el botón Atrás la
 * recupera. **Una ruta a la que no se puede entrar tampoco se puede volver.**
 *
 * ## Qué NO hace este módulo, y es a propósito
 *
 * No mira el modo, no mira la URL, no mira la sesión y no recibe ningún
 * parámetro por cuenta, rol o restaurante. Su firma es `(page)` y nada más:
 * **no hay por dónde inyectar una excepción por principal.**
 *
 * ## Lo que este guard NO cierra
 *
 * `case 'cuenta'` y `case 'tarjetas'` siguen en `App.tsx`, durmientes: los
 * diez call sites de `cuenta` preservados por ratificación no se tocan, y con
 * el guard delante ninguno llega al `case`. Desactivar no es borrar.
 */
export function enforceCorteRouteGuard(page: PageId): boolean {
  const bloqueada = !allowsCorteRoute(page);
  // ⭐ La llamada efectiva. Si desaparece, la ruta bloqueada se queda donde
  // está y `App.tsx` renderiza `null`: una pantalla en blanco que además
  // conserva `#/tarjetas` en la barra de direcciones y en el historial.
  if (bloqueada) replaceRoute('home');
  return bloqueada;
}
