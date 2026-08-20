import type { UnconfirmedAttempt } from '../api/idempotency';
import type { MesaDetail } from '../api/types';

/**
 * OLA 2-B · punto 6 · la máquina de congelar/descongelar un intento monetario.
 *
 * Vivía entera dentro de `MesaScreen.tsx` y `CreateMesaFlow.tsx`, mezclada con
 * JSX, así que no tenía —ni podía tener— una sola línea de cobertura: la suite
 * no incluye librería de render y agregar una sería una dependencia nueva.
 *
 * Extraerla acá es lo que la vuelve testeable. Son decisiones puras sobre
 * dinero: qué se puede reenviar, qué exige reconciliación y cuándo hay que
 * pedirle al comensal una confirmación explícita antes de emitir otra clave.
 */

export type FrozenView = 'none' | 'replayable' | 'needs_reconciliation';

/**
 * Qué se puede hacer con un intento congelado.
 *
 * - `replayable`: tenemos el cuerpo EXACTO que salió, así que el reintento cae
 *   en el replay del backend y no puede cobrar de nuevo.
 * - `needs_reconciliation`: no hay cuerpo (reload, back, remount) o es de otra
 *   familia. Reenviar sería reconstruir a ciegas: se bloquea hasta reconciliar.
 */
export function frozenView(frozen: UnconfirmedAttempt | null | undefined): FrozenView {
  if (!frozen) return 'none';
  if (frozen.reconciliationRequired === true) return 'needs_reconciliation';
  return frozen.payload !== undefined ? 'replayable' : 'needs_reconciliation';
}

export function canReplayFrozen(frozen: UnconfirmedAttempt | null | undefined): boolean {
  return frozenView(frozen) === 'replayable';
}

export function requiresReconciliation(frozen: UnconfirmedAttempt | null | undefined): boolean {
  return frozenView(frozen) === 'needs_reconciliation';
}

/**
 * N-07 · evidencia AUTORITATIVA de que mi pago llegó, leída del backend.
 *
 * En división igual, un casillero con `claimed_by_me`. En consumo, un ítem
 * propio ya pagado. Nunca se infiere de estado local: es lo único que permite
 * cerrar un intento sin arriesgar un segundo cobro.
 */
export function paymentLanded(mesa: Pick<MesaDetail, 'division_mode' | 'division_slots' | 'items'> | null | undefined): boolean {
  if (!mesa) return false;
  if (mesa.division_mode === 'igual') {
    return (mesa.division_slots ?? []).some((s) => s.claimed_by_me === true);
  }
  return (mesa.items ?? []).some((i) => (i.my_bps ?? 0) > 0 && i.status === 'paid');
}

/**
 * N-08 · ¿hay que pedir confirmación antes de emitir una clave nueva?
 *
 * Dos evidencias, cualquiera alcanza: el backend dice que esta identidad ya
 * tomó un casillero (`claimed_by_me`), o este dispositivo tiene un intento
 * sobre la misma mesa bajo el otro actor (invitado ↔ autenticado).
 *
 * NO es el guard un-usuario-un-casillero, que está vetado por acta: una vez
 * confirmado, se paga. Sólo evita que la parte adicional sea un accidente.
 */
export function needsExtraPartConfirmation(input: {
  acknowledged: boolean;
  crossActorIntent: boolean;
  mySlotsTaken: number;
}): boolean {
  if (input.acknowledged) return false;
  return input.crossActorIntent || input.mySlotsTaken > 0;
}

export type PayGate =
  | { allowed: true }
  | { allowed: false; reason: 'no_actor' | 'frozen_reconcile' | 'confirm_extra_part' };

/**
 * La puerta de un pago, en orden de prioridad. El orden importa: un intento que
 * exige reconciliación gana sobre la confirmación de parte adicional, porque
 * mientras haya algo sin resolver no se emite ninguna clave.
 */
export function payGate(input: {
  hasActor: boolean;
  frozen: UnconfirmedAttempt | null | undefined;
  acknowledged: boolean;
  crossActorIntent: boolean;
  mySlotsTaken: number;
}): PayGate {
  if (!input.hasActor) return { allowed: false, reason: 'no_actor' };
  if (requiresReconciliation(input.frozen)) return { allowed: false, reason: 'frozen_reconcile' };
  // Un intento replayable NO pide confirmación: reenvía el mismo cuerpo, no
  // abre una parte adicional.
  if (canReplayFrozen(input.frozen)) return { allowed: true };
  return needsExtraPartConfirmation(input)
    ? { allowed: false, reason: 'confirm_extra_part' }
    : { allowed: true };
}

/**
 * 🔴 LA REGLA VISUAL DE UN REPLAY CONGELADO (pregunta 10 del dictamen, y
 * AF-05): **¿la pantalla puede atribuir una tarjeta?**
 *
 * `false` cuando hay un intento replayable: el reenvío manda el cuerpo
 * ORIGINAL (`frozen.payload`), que puede traer una tarjeta distinta de la que
 * la UI preseleccionaría. El cobro estaba bien —de ahí que no haya doble
 * cobro— **pero la pantalla decía «vas a pagar con ésta» mientras el reenvío
 * usaba otra.**
 *
 * Es la misma familia que la ORDEN 1-B, con un matiz más fino: allá el defecto
 * era afirmar una tarjeta que **nadie** eligió; acá es afirmar una cuando
 * **se eligió otra vez, antes, y no sabemos cuál** — el backend guarda la
 * fuente original y no la publica (G-38).
 *
 * Tiene nombre propio en vez de resolverse con un `canReplayFrozen` suelto
 * porque **es una regla de producto y se decide una vez**: si mañana el
 * contrato publica la fuente, cambia acá y en ningún otro lado.
 */
export function puedeAtribuirTarjeta(frozen: UnconfirmedAttempt | null | undefined): boolean {
  return !canReplayFrozen(frozen);
}

/**
 * 🔴 LA COORDINACIÓN DE LA CARRERA (P2-①), como función pura.
 *
 * `getPaymentMethods()` y `readUnconfirmed()` resuelven en efectos distintos y
 * **sin orden garantizado**. La regla no es esperar a una: es que **el que
 * termina último aplique**, con los dos datos sobre la mesa. Así no importa
 * quién gane y el caso normal no paga latencia.
 *
 * `journalResuelto: false` incluye el journal **ilegible**: si no se pudo leer,
 * no se sabe si hay replay, y **en la duda no se afirma ninguna tarjeta**.
 *
 * Vive acá y no dentro del componente para que la prueben los tests **tal como
 * corre**. Tener la regla en el componente y una copia en el test es
 * exactamente el defecto que el dictamen señaló con `payGate`.
 */
export function atribucionInicial(input: {
  journalResuelto: boolean;
  defaultCandidato: string | null;
  frozen: UnconfirmedAttempt | null | undefined;
}): string | null {
  if (!input.journalResuelto || !input.defaultCandidato) return null;
  return puedeAtribuirTarjeta(input.frozen) ? input.defaultCandidato : null;
}
