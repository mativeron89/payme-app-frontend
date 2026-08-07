import type { OpenMesa } from '../api/types';

/**
 * P0 · RECONCILIAR UNA APERTURA CONGELADA — CON PRUEBA EXACTA O NO SE RESUELVE.
 *
 * ## El defecto que contiene (ORDEN 1A.1, medido y confirmado por Codex)
 *
 * `checkMesaReconciliation` decidía si la mesa congelada YA se había creado
 * buscando en `GET /mesas/open` una mesa cuyo **nombre de restaurante**
 * coincidiera con el del estado local:
 *
 *     abiertas.mesas.find((m) => m.restaurant?.name === restaurant?.name)
 *
 * Tres formas de acreditar una creación que nunca ocurrió, ninguna hipotética:
 *
 * 1. **`undefined === undefined` → `true`.** Los dos lados llevaban `?.`: si
 *    el fetch del restaurante había fallado (`restaurant` en `null`) y alguna
 *    mesa venía sin ese objeto, la comparación daba verdadera y el intento se
 *    cerraba dando la mesa por creada.
 * 2. **La mesa de OTRO.** Desde G-28 `/mesas/open` trae también las mesas
 *    donde sos PARTICIPANTE — la mesa de un amigo en el mismo restaurante
 *    matchea. Es nuestra propia corrección volviendo a morder.
 * 3. **Restaurantes homónimos.** Dos sucursales, dos "La Parolaccia".
 *
 * **El nombre de un restaurante no identifica una mesa.** Y esto decide si se
 * libera el journal para reintentar una apertura CON GARANTÍA: acreditar de
 * más es una segunda retención por el total.
 *
 * ## Y el segundo defecto, que no estaba en el enunciado
 *
 * **La AUSENCIA en `/mesas/open` tampoco probaba nada.** Ese endpoint filtra
 * `status IN ('open','partially_paid')`: una mesa creada cuya garantía quedó
 * en `pending_auth` —justo el caso que se está reconciliando— **no aparece**.
 * El código viejo leía esa ausencia como "no llegó a crearse" y ofrecía
 * desbloquear. No inventar ausencia es la mitad simétrica de no inventar
 * éxito, y las dos terminan en la misma retención duplicada.
 *
 * ## La regla
 *
 * Sólo el CÓDIGO de la mesa, guardado como referencia del journal en el
 * momento en que la respuesta de creación llegó, acredita. Sin esa referencia
 * no hay prueba exacta posible desde este front hoy, y entonces **el journal
 * queda congelado**: no se libera, no se navega a una mesa inferida, no se
 * afirma ni éxito ni ausencia. La salida real la habilita el contrato que App
 * Backend está diseñando (consulta por clave de idempotencia); hasta que
 * exista, quedarse frenado es el único estado honesto.
 */

export type VeredictoReconciliacion =
  /** Hay referencia exacta y esa mesa está en el listado. Se puede cerrar. */
  | 'acreditada'
  /** No hay referencia: la respuesta nunca llegó. Nada que consultar. */
  | 'sin_evidencia'
  /** Hay referencia y no aparece — que NO prueba que no exista (pending_auth). */
  | 'no_concluyente';

export interface ResultadoReconciliacion {
  readonly veredicto: VeredictoReconciliacion;
  /** El código PROBADO, sólo cuando `acreditada`. Nunca uno inferido. */
  readonly code: string | null;
}

/**
 * `referencia` es el `mesa_code` que el journal guardó al recibir la respuesta
 * de `POST /mesas`. Es lo ÚNICO que identifica la mesa de este intento.
 */
export function veredictoReconciliacion(args: {
  readonly referencia: string | null | undefined;
  readonly mesas: readonly OpenMesa[] | null | undefined;
}): ResultadoReconciliacion {
  const referencia = typeof args.referencia === 'string' ? args.referencia.trim() : '';
  if (!referencia) return { veredicto: 'sin_evidencia', code: null };
  const mesas = Array.isArray(args.mesas) ? args.mesas : [];
  // Igualdad EXACTA de código. Ni nombre, ni prefijo, ni "la única del
  // restaurante": el código es el identificador y es el único que se compara.
  const encontrada = mesas.some((m) => typeof m?.code === 'string' && m.code === referencia);
  return encontrada
    ? { veredicto: 'acreditada', code: referencia }
    : { veredicto: 'no_concluyente', code: null };
}

/**
 * Qué se le dice a la persona. Ninguna de las dos ramas no-acreditadas afirma
 * un hecho: dicen lo que sabemos —nada— y que por eso no se toca la garantía.
 */
export function copyReconciliacion(veredicto: VeredictoReconciliacion): string | null {
  switch (veredicto) {
    case 'acreditada':
      return null;
    case 'sin_evidencia':
      return 'No podemos verificar si esa mesa llegó a crearse: la respuesta se perdió antes de que supiéramos su código. Por seguridad no reintentamos la garantía ni abrimos otra mesa. Si la mesa existe, la vas a ver en Inicio.';
    case 'no_concluyente':
      return 'No pudimos confirmar el estado de esa apertura. Que no aparezca entre tus mesas abiertas no prueba que no exista —una mesa cuya garantía quedó a medias no se lista—, así que no la damos por creada ni por ausente, y no reintentamos la garantía.';
  }
}
