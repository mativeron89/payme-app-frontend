import type { Api } from '../../api';
import { ejemploLocal, type EjemploLocal } from './estadoEjemplo';
import { esCodigoDeEjemplo } from './fixtureEjemplo';
import {
  bloquearEnEjemplo,
  detalleDeEjemplo,
  participantesDeEjemplo,
  reemplazarInformativaEnEjemplo,
  seleccionInformativaDeEjemplo,
  soltarEnEjemplo,
} from './mesaDeEjemplo';

/**
 * D363 · D367 · el borde del `api` mientras dura la mesa de ejemplo.
 *
 * Plan técnico §4.2: la red de seguridad debajo de las costuras de pantalla.
 * Cada método de la fachada tiene UNA clase, y el tipo obliga a que estén todos:
 *
 * - **local** · se contesta de memoria cuando el código es el del ejemplo. Son
 *   los que `MesaScreen` pide por su cuenta (incluido el refresco solo de
 *   `getMesa`), así que un corte sólo en los botones no alcanzaba.
 * - **cortado** · mientras el ejemplo está activo se rechaza sin salir, con
 *   cualquier argumento: mesa, ticket, OCR, invitaciones a mesa, solicitudes,
 *   propina, pagos y dinero. `createMesa` está acá: aunque alguien rompa la
 *   costura de «Continuar», el ejemplo no puede crear una mesa real.
 * - **pasa** · lo de siempre de la app (sesión, avisos, amigos, viajes, las
 *   lecturas de Inicio). El ejemplo no lo pide, y cortarlo rompería lo que la
 *   persona haga de verdad mientras tanto.
 *
 * 🔴 Y una regla aparte de la clase (enmienda 1 de `d363_front`, punto 4): un
 * método que recibe un **código de mesa** y lo recibe con `PA-1224` nunca sale a
 * la red, con el ejemplo apagado o encendido. Así un `#/mesa/PA-1224` recargado
 * no le pega al servidor aunque el guard de `App.tsx` faltara.
 *
 * Con el ejemplo apagado y otro código, todo pasa tal cual: la envoltura no
 * cambia nada de la app de siempre.
 */

export type ClaseDelMetodo = 'local' | 'cortado' | 'pasa';

export const CLASIFICACION_DEL_EJEMPLO = {
  // Configuración, legales, sesión y cuenta.
  getConfig: 'pasa',
  getPrivacyNotice: 'pasa',
  getLegalText: 'pasa',
  getLegalAcceptance: 'pasa',
  getNotificationPreferences: 'pasa',
  putNotificationPreferences: 'pasa',
  acceptLegal: 'pasa',
  login: 'pasa',
  register: 'pasa',
  googleLogin: 'pasa',
  googleRedirectRedeem: 'pasa',
  googleRegister: 'pasa',
  googleContinue: 'pasa',
  googleRedirectSignup: 'pasa',
  googleContinueLink: 'pasa',
  getLinkedProviders: 'pasa',
  googleLink: 'pasa',
  googleLinkRedirectStart: 'pasa',
  googleLinkRedirectComplete: 'pasa',
  facebookLoginStart: 'pasa',
  facebookRegisterStart: 'pasa',
  facebookLoginComplete: 'pasa',
  facebookRegisterComplete: 'pasa',
  requestRecovery: 'pasa',
  completeRecovery: 'pasa',
  logout: 'pasa',
  restoreSession: 'pasa',
  onSessionExpired: 'pasa',
  onLegalAcceptanceRequired: 'pasa',
  onUsernameRequired: 'pasa',
  getUsername: 'pasa',
  getUsernameSuggestion: 'pasa',
  putUsername: 'pasa',
  searchUsernames: 'pasa',
  getUsernameAvatar: 'pasa',
  getMe: 'pasa',
  getProfileIdentity: 'pasa',
  updateProfileIdentity: 'pasa',
  getProfileAvatar: 'pasa',
  putProfileAvatar: 'pasa',
  deleteProfileAvatar: 'pasa',

  // Abrir una mesa: restaurante, ticket, OCR y la creación con su garantía.
  getRestaurant: 'cortado',
  resolveRestaurant: 'cortado',
  scanTicket: 'cortado',
  createMesa: 'cortado',
  getMesaCreation: 'cortado',
  confirmGuarantee3ds: 'cortado',

  // Historial y listas de mesas: lecturas de Inicio y de Mesas.
  getHistory: 'pasa',
  getMyMesas: 'pasa',
  getMovement: 'pasa',
  getOpenMesas: 'pasa',
  ocultarPago: 'pasa',
  mostrarPago: 'pasa',

  // La mesa: lo que `MesaScreen` pide solo se contesta de memoria; el resto, cortado.
  getMesa: 'local',
  getInformativeSelection: 'local',
  replaceInformativeSelection: 'local',
  lockItems: 'local',
  releaseItems: 'local',
  getMesaParticipants: 'local',
  closeMesa: 'cortado',
  fijarPropinaDeLaMesa: 'cortado',
  ocultarMesa: 'cortado',
  mostrarMesa: 'cortado',
  getParticipantAvatar: 'cortado',
  requestJoin: 'cortado',
  getJoinRequest: 'cortado',
  cancelJoinRequest: 'cortado',
  getMesaJoinRequests: 'cortado',
  acceptJoinRequest: 'cortado',
  rejectJoinRequest: 'cortado',
  payMesa: 'cortado',
  createInvitation: 'cortado',
  inviteFriend: 'cortado',
  getShortfallDetail: 'cortado',

  // Dinero: saldo, recargas, transferencias y tarjetas.
  getBalance: 'cortado',
  getWalletTransactions: 'cortado',
  topupOxxo: 'cortado',
  topupCard: 'cortado',
  getTopup: 'cortado',
  getClabe: 'cortado',
  createTransfer: 'cortado',
  listTransfers: 'cortado',
  getPaymentMethods: 'cortado',
  setDefaultPaymentMethod: 'cortado',
  removePaymentMethod: 'cortado',
  createSetupIntent: 'cortado',
  attachPaymentMethod: 'cortado',

  // Avisos e invitaciones recibidas: lo que Inicio lee y la tarjeta de la
  // invitación (que va arriba de la del Tutorial, Q5). Aceptar una invitación
  // real lleva su propio id: ningún dato del ejemplo puede llegar ahí.
  getNotifications: 'pasa',
  getUnreadCount: 'pasa',
  markNotificationRead: 'pasa',
  markAllNotificationsRead: 'pasa',
  deleteNotification: 'pasa',
  deleteAllNotifications: 'pasa',
  getInviterAvatar: 'pasa',
  getInvitationInviterAvatar: 'pasa',
  getPendingInvitations: 'pasa',
  acceptInvitation: 'pasa',
  acceptInvitationLink: 'pasa',

  // Estadísticas.
  getStats: 'pasa',
  getStatsRestaurants: 'pasa',
  getStatsDishes: 'pasa',
  getStatsEvolution: 'pasa',
  getStatsDayparts: 'pasa',
  getStatsIngredients: 'pasa',

  // Amigos y grupos.
  getFriends: 'pasa',
  getFriendAvatarNotice: 'pasa',
  acknowledgeFriendAvatarNotice: 'pasa',
  getFriendAvatar: 'pasa',
  addFriend: 'pasa',
  getIncomingFriendRequests: 'pasa',
  getOutgoingFriendRequests: 'pasa',
  acceptFriendRequest: 'pasa',
  rejectFriendRequest: 'pasa',
  cancelFriendRequest: 'pasa',
  blockUser: 'pasa',
  unblockUser: 'pasa',
  removeFriend: 'pasa',
  getGroups: 'pasa',
  getGroup: 'pasa',
  createGroup: 'pasa',
  addGroupMember: 'pasa',
  removeGroupMember: 'pasa',
  deleteGroup: 'pasa',

  // Viajes: el ejemplo es sólo de restaurante (D365) y nunca los pide.
  getViajes: 'pasa',
  getInvitacionesAViajes: 'pasa',
  crearViaje: 'pasa',
  invitarAlViaje: 'pasa',
  editarViaje: 'pasa',
  eliminarTicketDeViaje: 'pasa',
  corregirTicketDeViaje: 'pasa',
  subirFotoDeViaje: 'pasa',
  quitarFotoDeViaje: 'pasa',
  getFotoDeViaje: 'pasa',
  getViaje: 'pasa',
  aceptarViaje: 'pasa',
  rechazarViaje: 'pasa',
  salirDeViaje: 'pasa',
  revisarTicketDeViaje: 'pasa',
  cargarTicketDeViaje: 'pasa',
  cargarGastoDeViaje: 'pasa',
  getAvatarDeMiembroDeViaje: 'pasa',
  getTicketDeViaje: 'pasa',
  elegirEnTicketDeViaje: 'pasa',
  marcarPresentesEnTicket: 'pasa',
  getCierreDeViaje: 'pasa',
  cerrarViaje: 'pasa',
  marcarTransferenciaDeViaje: 'pasa',
  getResumenDeViaje: 'pasa',
  getNotasDeViaje: 'pasa',
  crearNotaDeViaje: 'pasa',
  editarNotaDeViaje: 'pasa',
  borrarNotaDeViaje: 'pasa',
  tildarItemDeNota: 'pasa',
  ordenarNotasDeViaje: 'pasa',
  getVisitasDeViajes: 'pasa',

  // El link para invitar a PayMe (no a una mesa).
  getLinkDeInvitacion: 'pasa',
  cambiarLinkDeInvitacion: 'pasa',
} as const satisfies Record<keyof Api, ClaseDelMetodo>;

/**
 * Los métodos cuyo primer argumento es un código de mesa. El test los coteja con
 * la interfaz (`code: string` o `mesaCode: string` como primer parámetro) para
 * que uno nuevo no quede afuera de la regla de `PA-1224`.
 */
export const RECIBEN_CODIGO_DE_MESA: ReadonlySet<keyof Api> = new Set<keyof Api>([
  'getMesa', 'getInformativeSelection', 'replaceInformativeSelection', 'confirmGuarantee3ds',
  'lockItems', 'releaseItems', 'closeMesa', 'fijarPropinaDeLaMesa', 'ocultarMesa', 'mostrarMesa',
  'getMesaParticipants', 'getParticipantAvatar', 'requestJoin', 'getMesaJoinRequests',
  'acceptJoinRequest', 'rejectJoinRequest', 'payMesa', 'createInvitation', 'inviteFriend',
  'getShortfallDetail',
]);

type Clasificacion = typeof CLASIFICACION_DEL_EJEMPLO;
type MetodoLocal = { [K in keyof Api]: Clasificacion[K] extends 'local' ? K : never }[keyof Api];
type MetodoCortado = { [K in keyof Api]: Clasificacion[K] extends 'cortado' ? K : never }[keyof Api];

/**
 * Un cortado se rechaza con una promesa: el tipo exige que todos devuelvan una,
 * para que el rechazo llegue al `catch` de la pantalla y no como excepción
 * suelta. Si alguno no, `SinPromesa` lo nombra y esta línea no compila.
 */
type SinPromesa = { [K in MetodoCortado]: ReturnType<Api[K]> extends Promise<unknown> ? never : K }[MetodoCortado];
const todosLosCortadosDevuelvenPromesa: [SinPromesa] extends [never] ? true : SinPromesa = true;
void todosLosCortadosDevuelvenPromesa;

/** Lo que la fachada envuelta contesta en lugar de ir a la red. No imita ninguna respuesta del servidor. */
export class PedidoCortadoPorElEjemplo extends Error {
  constructor(readonly metodo: string) {
    super('ejemplo_sin_red');
    this.name = 'PedidoCortadoPorElEjemplo';
  }
}

function respuestasLocales(ejemplo: EjemploLocal): { readonly [K in MetodoLocal]: Api[K] } {
  return {
    getMesa: async () => detalleDeEjemplo(ejemplo.leer()),
    getMesaParticipants: async () => participantesDeEjemplo(ejemplo.leer()),
    getInformativeSelection: async () => seleccionInformativaDeEjemplo(ejemplo.leer()),
    replaceInformativeSelection: async (_code, pedido) => {
      const ahora = Date.now();
      const { seleccion, respuesta } = reemplazarInformativaEnEjemplo(ejemplo.leer(), pedido, ahora);
      ejemplo.elegir(seleccion, ahora);
      return respuesta;
    },
    lockItems: async (_code, pedidos) => {
      const { seleccion, respuesta } = bloquearEnEjemplo(ejemplo.leer(), pedidos);
      ejemplo.elegir(seleccion);
      return respuesta;
    },
    releaseItems: async (_code, itemIds) => {
      const { seleccion, soltados } = soltarEnEjemplo(ejemplo.leer(), itemIds);
      ejemplo.elegir(seleccion);
      return soltados;
    },
  };
}

type Metodo = (...args: unknown[]) => unknown;

/**
 * Envuelve la fachada. 🔴 **Lee el método de `base` en cada llamada**, y el
 * objeto que devuelve es uno común y asignable: los tests que reemplazan
 * `api.X` (o espían `base.X`) siguen funcionando como antes de la envoltura.
 */
export function envolverApi(base: Api, ejemplo: EjemploLocal = ejemploLocal): Api {
  const locales = respuestasLocales(ejemplo);
  const envuelta: Record<string, Metodo> = {};
  for (const metodo of Object.keys(CLASIFICACION_DEL_EJEMPLO) as Array<keyof Api>) {
    const clase: ClaseDelMetodo = CLASIFICACION_DEL_EJEMPLO[metodo];
    const recibeCodigo = RECIBEN_CODIGO_DE_MESA.has(metodo);
    envuelta[metodo] = (...args: unknown[]) => {
      const activo = ejemplo.leer().activo;
      const delEjemplo = recibeCodigo && esCodigoDeEjemplo(args[0]);
      if (activo && delEjemplo && clase === 'local') {
        return (locales[metodo as MetodoLocal] as Metodo)(...args);
      }
      if (delEjemplo || (activo && clase === 'cortado')) {
        return Promise.reject(new PedidoCortadoPorElEjemplo(metodo));
      }
      return (base[metodo] as Metodo).apply(base, args);
    };
  }
  return envuelta as unknown as Api;
}
