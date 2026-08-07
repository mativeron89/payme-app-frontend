/**
 * C-01 · ADMISIÓN DE UNA INVITACIÓN, DECODIFICADA SIN CONFIAR EN NADA.
 *
 * ## El defecto que cierra (residual encontrado en auditoría, 2026-08-07)
 *
 * `AvisosScreen` gateaba el botón "Sumarme" con `inv.mesa_joinable === false`.
 * Eso bloquea **sólo el caso en que el emisor dijo explícitamente que no**, y
 * deja pasar todos los demás: campo **ausente** (un backend anterior a
 * v2.45.0, que es el caso normal de un deploy desincronizado), `null`, un
 * string `"false"` —verdadero en JS—, o un objeto de otra forma. En todos
 * ésos la tarjeta ofrecía entrar a una mesa que podía estar muerta.
 *
 * **Un campo que falta no es un campo en `false`.** La regla es la del riel
 * saldo (`api/walletRail.ts`), aplicada acá al dato del contrato: **sólo
 * `=== true` habilita**; todo lo demás queda NO ACCIONABLE.
 *
 * ## Tres estados, y por qué "desconocida" no dice "ya cerró"
 *
 * Fallar cerrado significa **no ofrecer la acción**, no **afirmar el
 * rechazo**. Si el emisor dijo `false`, sabemos que la mesa cerró y lo
 * decimos. Si el campo no vino, **no sabemos nada**: decir "esta mesa ya
 * cerró" sería inventar un hecho del emisor, exactamente el error inverso.
 * Por eso `desconocida` usa el estado DESCONOCIDO del sistema de diseño
 * (§5) — el mismo criterio del acordeón de Historial con G-33 abierta.
 *
 * ## Por qué además normaliza la fila entera
 *
 * La lista venía de la red y se renderizaba cruda: un elemento `null` o sin
 * `id` reventaba el `.map` y dejaba **la pantalla entera en blanco** — la
 * peor forma de fallar abierto, porque tampoco muestra los avisos. Acá cada
 * fila se normaliza a campos opcionales y lo irrecuperable (sin `id`) se
 * descarta: una tarjeta menos es mejor que ninguna pantalla.
 */

export type AdmisionEstado =
  /** El emisor dijo `mesa_joinable: true`. Único caso accionable. */
  | 'admite'
  /** El emisor dijo `false`: la mesa murió. Lo sabemos y lo decimos. */
  | 'cerrada'
  /** Ausente, `null`, tipo equivocado o forma inesperada. No sabemos nada. */
  | 'desconocida';

export interface InvitacionMostrable {
  readonly id: string;
  /** `null` cuando no vino o no es string: la fila se muestra sin el dato. */
  readonly mesaCode: string | null;
  readonly restaurante: string | null;
  readonly invitador: string | null;
  readonly creada: string | null;
  readonly admision: AdmisionEstado;
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** String no vacío, o `null`. Un `123` o un `{}` no se pintan en pantalla. */
function textoODesconocido(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v : null;
}

/**
 * `mesa_joinable` es booleano en el contrato (v2.45.0, computado por el
 * emisor con el MISMO `mesaViva()` que gatea las dos puertas de entrar). Se
 * exige el tipo, no la verdad: `"false"` y `1` son `true` en JS y
 * reencenderían el botón por una coerción — la misma trampa que
 * `walletRail` bloquea exigiendo `typeof === 'boolean'`.
 */
export function admisionDeInvitacion(raw: unknown): AdmisionEstado {
  if (!esObjeto(raw)) return 'desconocida';
  const joinable = raw.mesa_joinable;
  if (typeof joinable !== 'boolean') return 'desconocida';
  return joinable ? 'admite' : 'cerrada';
}

/**
 * Normaliza la respuesta ENTERA de `GET /invitations`. Devuelve siempre un
 * array: una respuesta que no es lista es una lista vacía, no una excepción
 * en la pantalla de avisos.
 */
export function invitacionesMostrables(raw: unknown): InvitacionMostrable[] {
  if (!Array.isArray(raw)) return [];
  const salida: InvitacionMostrable[] = [];
  for (const fila of raw) {
    if (!esObjeto(fila)) continue;
    const id = textoODesconocido(fila.id);
    // Sin `id` no hay nada que aceptar ni key estable para React: se descarta.
    if (!id) continue;
    salida.push({
      id,
      mesaCode: textoODesconocido(fila.mesa_code),
      restaurante: textoODesconocido(fila.restaurant_name),
      invitador: textoODesconocido(fila.inviter_first_name),
      creada: textoODesconocido(fila.created_at),
      admision: admisionDeInvitacion(fila),
    });
  }
  return salida;
}

/**
 * La línea de metadatos ("Mesa PA-4520 · hace 8 min"), armada con lo que haya
 * y `null` si no hay nada. Vive acá y no en el JSX por dos razones: es una
 * decisión de copy (qué se muestra cuando falta un dato) y —concreto— porque
 * `AvisosScreen` no puede contener un `.filter(`: el guardarraíl de privacidad
 * de `walletRailNotifications.mirror.test.ts` marca como ofensor a cualquier
 * archivo que **nombre los tipos del riel saldo Y filtre**, para que nadie
 * esconda avisos de wallet en la pantalla en vez de en el emisor. La pantalla
 * nombra esos tipos en su mapa de íconos, así que un `.filter(Boolean)` mío
 * —inocente— la volvía sospechosa. La defensa se respeta, no se afloja.
 */
export function metaInvitacion(inv: {
  readonly mesaCode: string | null;
  readonly creada: string | null;
}, formatearFecha: (iso: string) => string): string | null {
  const partes: string[] = [];
  if (inv.mesaCode) partes.push(`Mesa ${inv.mesaCode}`);
  if (inv.creada) partes.push(formatearFecha(inv.creada));
  return partes.length > 0 ? partes.join(' · ') : null;
}

/**
 * Copy de la fila NO accionable. Separada del componente porque es la
 * decisión —qué se le dice a la persona en cada estado— y este repo no tiene
 * librería de render: lo que queda adentro del JSX no se puede fijar con
 * tests.
 *
 * `admite` no tiene copy: su superficie es el botón.
 */
export function copyAdmision(estado: AdmisionEstado): string | null {
  switch (estado) {
    case 'admite':
      return null;
    case 'cerrada':
      // Textual de Diseño (§1.2-D / puerta 1), sin el bloque de cuenta-lista:
      // quien mira Avisos ya tiene cuenta y mesas, no es su primer minuto.
      return 'Esta mesa ya cerró';
    case 'desconocida':
      // Estado DESCONOCIDO de SISTEMA_DISENO §5: no afirma que la mesa cerró
      // —no lo sabemos— ni ofrece entrar. Dice qué pasa y qué hacer.
      return 'No pudimos verificar esta invitación. Actualizá en un momento.';
  }
}
