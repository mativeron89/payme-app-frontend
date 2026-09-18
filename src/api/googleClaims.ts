/**
 * AF-16 · sugerencia de datos para «Crea tu cuenta con Google».
 *
 * Cuando el ingreso con Google no resuelve una cuenta y el alta está abierta, la
 * pantalla ofrece crear la cuenta. Para no hacerle tipear a la persona lo que
 * Google ya le mostró, el nombre, el apellido y el correo se PRECARGAN desde el
 * `id_token` que acaba de llegar.
 *
 * 🔴 **Esto es una sugerencia, nunca autoridad.**
 * - Se decodifica el payload localmente, SIN verificar la firma: por eso lo que
 *   sale de acá sólo puede terminar en un campo editable. Quien valida es el
 *   dueño, sobre el `id_token` que se le manda en el alta.
 * - Nada de esto se guarda: ni el token ni los claims tocan `localStorage` ni
 *   `sessionStorage`. El token vive en la memoria del callback y se descarta.
 * - Ante cualquier cosa rara (no es un JWT, base64 inválido, JSON inválido,
 *   claims con otro tipo o demasiado largos) la sugerencia es vacía: la persona
 *   completa a mano, que es lo que pasaba sin esta ayuda.
 */

export interface SugerenciaDeGoogle {
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
}

const VACIA: SugerenciaDeGoogle = { firstName: '', lastName: '', email: '' };

/** El dueño acepta nombres de hasta 100 caracteres (`profileName`). */
const MAX_NOMBRE = 100;
/** Largo máximo de una dirección de correo (RFC 5321). */
const MAX_EMAIL = 254;

function decodificarPayload(idToken: string): unknown {
  const partes = idToken.split('.');
  if (partes.length !== 3) return null;
  const segmento = partes[1]!;
  if (!/^[A-Za-z0-9_-]+$/.test(segmento)) return null;
  const base64 = segmento.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(Math.ceil(segmento.length / 4) * 4, '=');
  const binario = atob(base64);
  const bytes = Uint8Array.from(binario, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

function texto(valor: unknown, max: number): string {
  if (typeof valor !== 'string') return '';
  const limpio = valor.trim();
  return limpio.length > 0 && limpio.length <= max ? limpio : '';
}

export function sugerenciaDesdeIdToken(idToken: string): SugerenciaDeGoogle {
  try {
    const claims = decodificarPayload(idToken);
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return VACIA;
    const c = claims as Record<string, unknown>;
    const email = texto(c.email, MAX_EMAIL);
    return {
      firstName: texto(c.given_name, MAX_NOMBRE),
      lastName: texto(c.family_name, MAX_NOMBRE),
      email: email.includes('@') ? email : '',
    };
  } catch {
    return VACIA;
  }
}
