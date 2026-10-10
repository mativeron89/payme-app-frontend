import { extractApiError } from './errors';

/**
 * D268 · S-05 · App Backend 2.178.0 responde `403 {"error":"invitation_not_accepted"}`
 * cuando alguien con la invitación pendiente toma o suelta platos, guarda su
 * selección o paga (`contract-mirror/contract/mesa-acceso-v1.json`). El flujo de
 * la app acepta antes de entrar (Inicio, Avisos y el link); esto cubre a quien
 * abre la mesa directo por la URL. Sólo ese 403: otro 403 dice otra cosa.
 */
export function esInvitacionNoAceptada(err: unknown): boolean {
  const { status, code } = extractApiError(err);
  return status === 403 && code === 'invitation_not_accepted';
}
