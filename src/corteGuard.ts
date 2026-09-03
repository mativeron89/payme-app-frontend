import { allowsCorteRoute, type RielDelCorte } from './api/releaseGates';
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
 * parámetro por cuenta, rol o restaurante. Su firma es `(page, rail)` y nada
 * más: **no hay por dónde inyectar una excepción por principal.**
 *
 * 🔴 **F2 · el segundo parámetro es la capability del dueño, no una opción.**
 * Antes el predicado leía una constante de este repo; ahora recibe el estado de
 * `money_rail` y falla cerrado con él: mientras el riel no sea autoritativo con
 * los pagos habilitados, la ruta se bloquea. Eso incluye el primer render, en el
 * que el backend todavía no contestó — y ahí bloquear es lo correcto: una
 * pantalla de alta de tarjeta que aparece un instante y desaparece es peor que
 * no aparecer.
 *
 * ## Lo que este guard NO cierra
 *
 * `case 'cuenta'` y `case 'tarjetas'` siguen en `App.tsx`, durmientes: los
 * diez call sites de `cuenta` preservados por ratificación no se tocan, y con
 * el guard delante ninguno llega al `case`. Desactivar no es borrar.
 */
export function enforceCorteRouteGuard(page: PageId, rail: RielDelCorte): boolean {
  /**
   * 🔴 **No se redirige hasta que el dueño contestó, y esto corrige un defecto
   * de producto medido.**
   *
   * La primera versión redirigía también con el riel en `pending`. Efecto: al
   * entrar directo a `#/tarjetas` —o al recargar ahí— la persona era **expulsada
   * a Inicio antes de que el dueño dijera si hay pagos**, aunque los hubiera.
   * Perdía su ruta por una carrera, no por una decisión.
   *
   * ⚠️ **Los 2198 unitarios pasaban con ese defecto adentro**; lo cazó el
   * navegador. Por eso la espera vive ACÁ y no en el `useEffect` de `App.tsx`:
   * en un efecto no se ejecuta en esta suite —el módulo entero existe por esa
   * razón— y una guarda que nadie puede ver morir es una nota, no una defensa.
   *
   * 🔴 **Cortar la VISTA es otra decisión y NO se toca**: `allowsCorteRoute`
   * sigue fail-closed en `pending`, así que la superficie de tarjetas no se
   * muestra mientras no se sepa. Lo que espera es la EXPULSIÓN, no la
   * ocultación.
   */
  if (rail.status !== 'authoritative') return false;
  const bloqueada = !allowsCorteRoute(page, rail);
  // ⭐ La llamada efectiva. Si desaparece, la ruta bloqueada se queda donde
  // está y `App.tsx` renderiza `null`: una pantalla en blanco que además
  // conserva `#/tarjetas` en la barra de direcciones y en el historial.
  if (bloqueada) replaceRoute('home');
  return bloqueada;
}
