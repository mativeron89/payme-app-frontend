import { allowsWalletRoute } from './api/releaseGates';
import { replaceRoute, type PageId } from './router';

/**
 * ORDEN 4C · el gate de las rutas del riel saldo, como llamada ejecutable.
 *
 * ## Qué defecto cierra
 *
 * La redirección funcionaba, pero **su único test sobrevivía a que la
 * redirección desapareciera**: `releaseGates.test.ts` afirma
 * `allowsWalletRoute(false, 'cargar') === false`, o sea *"la ruta está
 * prohibida"*, y eso sigue siendo cierto aunque nadie actúe en consecuencia.
 * Borrar `replaceRoute('home')` dejaba la suite entera en verde.
 *
 * Es el mismo antipatrón que 4B: una defensa **declarada** que no se comprueba
 * **ejecutada**. Un predicado correcto que nadie obedece no protege nada, y
 * acá lo que no protegería es la ratificación de wallet durmiente — cero UI y
 * cero rutas en real y en mock.
 *
 * ## Por qué es un módulo y no dos líneas dentro del `useEffect`
 *
 * Por la misma razón que `invitationCustody.ts`: sin librería de render —por
 * ratificación de Mati— un efecto **no se ejecuta** en la suite
 * (`renderToStaticMarkup` monta el árbol pero no corre efectos). Mientras la
 * llamada viviera adentro del efecto, ningún test podía morir al neutralizarla.
 *
 * Acá sí muere: `walletRouteGuard.test.ts` recorre la cadena entera —capability
 * → decisión → `replaceRoute` → historial → hash— y se pone rojo si se corta
 * cualquier eslabón. Lo que queda en `App.tsx` es **una** llamada, y que siga
 * ahí lo fija el guardarraíl de fuente de ese mismo archivo.
 *
 * ## Por qué `replaceRoute` y no `navigate`
 *
 * `navigate` deja `#/cargar` viva en el historial y el botón Atrás la recupera.
 * **Una ruta a la que no se puede entrar tampoco se puede volver** — es el mismo
 * mecanismo por el que Back revivía el token de una invitación (4B).
 *
 * ## Qué NO hace este módulo, y es a propósito
 *
 * No mira el modo (`IS_MOCK`), no mira la URL, no mira la sesión y no recibe
 * ningún parámetro por cuenta, rol o restaurante. Su firma es
 * `(walletRailEnabled, page)` y nada más: **no hay por dónde inyectar un
 * permiso por principal**, que es exactamente lo que la ratificación prohíbe.
 * El único que decide es el backend, vía `walletRail.ts`.
 */
export function enforceWalletRouteGuard(walletRailEnabled: boolean, page: PageId): boolean {
  const bloqueada = !allowsWalletRoute(walletRailEnabled, page);
  // ⭐ La llamada efectiva. Si desaparece, la ruta bloqueada se queda donde
  // está y `App.tsx` renderiza `null`: una pantalla en blanco que además
  // conserva `#/cargar` en la barra de direcciones y en el historial.
  if (bloqueada) replaceRoute('home');
  return bloqueada;
}
