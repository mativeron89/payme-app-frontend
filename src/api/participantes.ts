/**
 * AF-25 · n72 · «quiénes se sumaron», sólo para el organizador.
 * `GET /api/mesas/:code/participants` (dueño v2.101.0 ·
 * `contract-mirror/routes/mesas.js:1394-1431`); decisión de Mati «Publicar ya
 * sin foto; la foto después» (`06ba3f3a…`).
 *
 * El dueño responde SÓLO al organizador (403 `not_mesa_organizer` al resto) y
 * sólo publica nombre, apellido e identificador. Por eso el decodificador exige
 * **claves exactas**: un campo de más —una foto, un monto, quién eligió qué— no
 * se muestra por accidente, se rechaza. Cuando llegue la foto, este archivo se
 * actualiza con su propia orden; hasta entonces, un sobre con foto es un error
 * visible, nunca una foto mostrada sin decidir.
 */

export interface Participante {
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly paymeId: string | null;
}

function objetoPlano(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function clavesExactas(v: Record<string, unknown>, esperadas: readonly string[]): boolean {
  const reales = Object.keys(v).sort();
  const quiero = [...esperadas].sort();
  return reales.length === quiero.length && reales.every((k, i) => k === quiero[i]);
}

function textoONulo(v: unknown): v is string | null {
  return v === null || typeof v === 'string';
}

export function decodeParticipantes(raw: unknown): readonly Participante[] {
  if (!objetoPlano(raw) || !clavesExactas(raw, ['participants']) || !Array.isArray(raw.participants)) {
    throw new Error('participants_response_malformed');
  }
  return raw.participants.map((p) => {
    if (!objetoPlano(p)
        || !clavesExactas(p, ['first_name', 'last_name', 'payme_id'])
        || !textoONulo(p.first_name) || !textoONulo(p.last_name) || !textoONulo(p.payme_id)) {
      throw new Error('participants_response_malformed');
    }
    return { firstName: p.first_name, lastName: p.last_name, paymeId: p.payme_id };
  });
}

/**
 * Qué se muestra de cada persona. Tres casos del dueño:
 *
 * - **Sin cuenta** (legacy por token): las tres claves en `null` → «Invitado».
 * - **Cuenta eliminada**: la anonimización la deja «Cuenta» «eliminada» y sin
 *   identificador. Se reconoce por esa forma EXACTA, no sólo por el `null` del
 *   identificador: una cuenta viva sin identificador mostraría su nombre, no
 *   «Cuenta eliminada».
 * - Cualquier otro: nombre y apellido, y el identificador si lo hay.
 */
export type FilaParticipante =
  | { readonly tipo: 'invitado' }
  | { readonly tipo: 'eliminada' }
  | { readonly tipo: 'persona'; readonly nombre: string | null; readonly paymeId: string | null };

export function filaDeParticipante(p: Participante): FilaParticipante {
  if (p.firstName === null && p.lastName === null && p.paymeId === null) return { tipo: 'invitado' };
  if (p.paymeId === null && p.firstName === 'Cuenta' && p.lastName === 'eliminada') return { tipo: 'eliminada' };
  const nombre = [p.firstName, p.lastName].filter((x): x is string => !!x && x.trim().length > 0).join(' ');
  return { tipo: 'persona', nombre: nombre.length > 0 ? nombre : null, paymeId: p.paymeId };
}
