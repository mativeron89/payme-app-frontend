import type { OpenMesa } from '../api/types';

/**
 * Vista pura de la burbuja de mesas de Inicio — §1.1, corrección del
 * 2026-08-05 (variante B). Vive fuera de la pantalla por lo mismo que
 * `pagosView` e `historialView`: sin librería de render, lo que queda adentro
 * de un componente no se puede matar en la suite.
 *
 * ## Por qué existe: la premisa que caducó
 *
 * "Nunca hay más de UNA mesa abierta por usuario" (Mati, 2026-08-03) era
 * cierta cuando `GET /mesas/open` devolvía sólo las mesas que abriste. G-28
 * (cerrado 2026-08-04/05) sumó las mesas donde sos PARTICIPANTE
 * (`contract-mirror/routes/mesas.js:651`, opener OR participante activo, SIN
 * LIMIT): ser invitado mientras tenés la tuya pasó de excepción a caso
 * normal. Y §1.10 dejó a "Mesas" como historial de CERRADAS, así que una
 * abierta que no entra en la tarjeta no existe en NINGUNA superficie.
 * El spec conserva la premisa vieja tachada y fechada, no borrada.
 */

/**
 * La protagonista es la de `expires_at` MÁS PRÓXIMO — la única señal de
 * urgencia real que el payload trae (garantía con reloj corriendo), no la más
 * nueva. Empate → el orden del payload, que ya es el del contrato
 * (`created_at DESC`): el sort es estable y no lo toca. El mismo criterio
 * ordena la hoja de "las demás".
 *
 * Una fecha ilegible va al final: una mesa sin reloj que se pueda leer no
 * puede reclamar urgencia — pero no se descarta, sigue siendo una mesa
 * abierta con plata de por medio.
 */
export function ordenarPorUrgencia(mesas: readonly OpenMesa[]): OpenMesa[] {
  const urgencia = (m: OpenMesa): number => {
    const t = Date.parse(m.expires_at);
    return Number.isNaN(t) ? Infinity : t;
  };
  return [...mesas].sort((a, b) => urgencia(a) - urgencia(b));
}

/**
 * "+1 mesa abierta más" / "+3 mesas abiertas más". El singular importa: la
 * fila aparece por primera vez exactamente cuando hay UNA sola más.
 */
export function etiquetaMasMesas(
  n: number,
  /**
   * 🔴 El `t` entra por parámetro con IDENTIDAD INTERPOLADA por defecto, y no
   * es un capricho: sin él, esta función devolvía la frase **ya interpolada**
   * —«+3 mesas abiertas más»— que no matchea ninguna clave. Las claves son las
   * PLANTILLAS. El default reproduce el comportamiento viejo exacto, así que
   * los tests de esta función pura no cambian.
   *
   * El singular importa y por eso son DOS claves, no una con plural inventado:
   * la fila aparece por primera vez justo cuando hay UNA sola más.
   */
  t: (s: string, ...a: unknown[]) => string =
    (s, ...a) => s.replace(/\{0\}/g, String(a[0])),
): string {
  return n === 1 ? t('+1 mesa abierta más') : t('+{0} mesas abiertas más', n);
}
