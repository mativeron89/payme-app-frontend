import type { Route } from '../router';

/**
 * AF-INICIO-TRAS-INGRESO · a dónde va la app DESPUÉS de entrar.
 *
 * Mati, en Chrome del iPhone: «entra bien con Google pero no ingresa de una al
 * Inicio, ingresa a "Más"». La causa: cerrar sesión no tocaba la URL
 * (`AuthContext.logout`) y la pantalla de ingreso se dibuja sobre la ruta que
 * haya (`App.tsx`: `if (!session) return <LoginScreen />`). Al volver a entrar,
 * la app mostraba la ruta que quedó de la sesión anterior.
 *
 * La regla: después de todo ingreso, Inicio. La única excepción es un enlace
 * de entrada que la persona abrió PARA eso, y que la lleva a su destino como
 * hasta ahora:
 *
 * - la invitación a una mesa (`/mesa/CODE` con su token, en la URL o en custodia);
 * - el QR del restaurante (`/scan?r=…`);
 * - una invitación de alta (`signup_invitation`) vista mientras no había sesión.
 *
 * Una ruta cualquiera que quedó de antes (Más, Configuración…) NO es una
 * entrada: va a Inicio.
 */
export interface EntradaDeIngreso {
  /** El token de la invitación de ESTA mesa, si hay (`tokenForMesa`). */
  readonly tokenDeInvitacion: string | null;
  /** Hubo una invitación de alta disponible mientras no había sesión. */
  readonly invitacionDeAlta: boolean;
}

/** ¿La ruta actual es un enlace de entrada que se respeta después de entrar? */
export function conservaRutaTrasIngreso(route: Route, entrada: EntradaDeIngreso): boolean {
  if (route.page === 'mesa' && route.param && entrada.tokenDeInvitacion) return true;
  if (route.page === 'scan' && route.query.get('r')) return true;
  return entrada.invitacionDeAlta;
}

/**
 * Qué hacer cuando cambia la sesión. Sólo el paso de «sin sesión» a «con
 * sesión» es un ingreso: una sesión que se restaura al cargar la página no
 * pasa por acá (la persona abrió esa ruta con la sesión viva), y un cambio de
 * una sesión a otra tampoco.
 */
export function trasCambioDeSesion(
  habiaSesion: boolean,
  haySesion: boolean,
  conserva: () => boolean,
): 'inicio' | 'quedarse' {
  if (habiaSesion || !haySesion) return 'quedarse';
  return conserva() ? 'quedarse' : 'inicio';
}

/**
 * AF-INVITACION-TRAS-GOOGLE · a qué mesa volver después de entrar, si a alguna.
 *
 * La vuelta de Google en la misma pestaña llega a la raíz y la ruta ya no dice
 * de qué mesa venía la persona. La marca (`retornoTrasIngreso.ts`) lo recuerda,
 * pero vale SÓLO si la invitación custodiada es de esa misma mesa: sin eso, una
 * marca vieja de la mesa A llevaría a A a quien después abrió el link de B. El
 * token nombra su mesa; la marca también.
 */
export function mesaDeRetorno(
  marca: { readonly code: string } | null,
  codigoCustodiado: string | null,
): string | null {
  return marca && codigoCustodiado && marca.code === codigoCustodiado ? marca.code : null;
}
