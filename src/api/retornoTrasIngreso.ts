/**
 * AF-INVITACION-TRAS-GOOGLE · volver a la mesa después de entrar con Google en
 * la misma pestaña.
 *
 * Mati, 29/09: «Invité a una mesa a alguien que NO tenía cuenta. Hizo el
 * proceso de alta de cuenta con GMAIL y cuando ingresó a su usuario, no estaba
 * la cuenta a la cuál lo había invitado.»
 *
 * El token de la invitación queda custodiado (`invitationLink.ts`), pero su
 * lector lo busca sólo con la ruta `/mesa/CODE` (`tokenForMesa`). La vuelta de
 * Google es un documento nuevo en la raíz (`/#google_signup=` o
 * `/#google_redirect=`) y el front la limpia a `/`: JoinMesaScreen no se monta
 * y nadie canjea. El alta y el ingreso por correo no recargan, así que no se
 * ven afectados.
 *
 * Esta marca guarda ADÓNDE volver: el código de la mesa, que ya está en la URL,
 * y la hora. Nunca el token ni un dato personal.
 * - La escribe JoinMesaScreen al elegir «Crear cuenta gratis» o «Ya tengo cuenta».
 * - La usa `useInicioTrasIngreso` una sola vez, al entrar, y sólo si la
 *   invitación custodiada es de la MISMA mesa (`destinoTrasIngreso.mesaDeRetorno`).
 * - Vence a los 30 minutos. Una forma inválida se borra.
 * - Se borra al cerrar la custodia, en un rechazo terminal y al cerrar sesión.
 *
 * Fuera de alcance, declarado: si el link se abrió en el navegador interno de
 * una app (WhatsApp) y Google vuelve en otro contexto, el `sessionStorage` no
 * viaja y esto no lo cubre.
 */

export const CLAVE_RETORNO_MESA = 'payme.app.retorno_mesa.v1';

/** 30 minutos: lo que razonablemente dura un alta con Google. */
export const VIDA_RETORNO_MS = 30 * 60 * 1000;

const FORMA_CODIGO = /^[A-Za-z0-9-]{1,64}$/;

export interface RetornoAMesa {
  readonly code: string;
  readonly savedAt: number;
}

type Almacen = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function sesion(): Almacen | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Anota la mesa a la que volver. Sin storage, o con un código raro, no anota nada. */
export function recordarRetornoAMesa(code: string, ahora: number = Date.now(), almacen: Almacen | null = sesion()): void {
  if (!almacen || !FORMA_CODIGO.test(code)) return;
  try {
    almacen.setItem(CLAVE_RETORNO_MESA, JSON.stringify({ code, savedAt: ahora }));
  } catch {
    // Sin storage no hay retorno: la persona termina en Inicio, como antes.
  }
}

export function olvidarRetornoAMesa(almacen: Almacen | null = sesion()): void {
  try {
    almacen?.removeItem(CLAVE_RETORNO_MESA);
  } catch {
    // Nada que hacer; el vencimiento la termina de invalidar.
  }
}

/**
 * La marca, si vale. Exactamente `{code, savedAt}`, con un código con forma de
 * código y una hora de los últimos 30 minutos. Cualquier otra cosa se BORRA:
 * devolver `null` sin borrar dejaría basura en el storage.
 */
export function leerRetornoAMesa(ahora: number = Date.now(), almacen: Almacen | null = sesion()): RetornoAMesa | null {
  let crudo: string | null = null;
  try {
    crudo = almacen?.getItem(CLAVE_RETORNO_MESA) ?? null;
  } catch {
    return null;
  }
  if (crudo === null) return null;
  try {
    const valor: unknown = JSON.parse(crudo);
    if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) throw new Error('forma');
    const claves = Object.keys(valor).sort().join(',');
    const { code, savedAt } = valor as Record<string, unknown>;
    if (claves !== 'code,savedAt') throw new Error('forma');
    if (typeof code !== 'string' || !FORMA_CODIGO.test(code)) throw new Error('forma');
    if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) throw new Error('forma');
    const edad = ahora - savedAt;
    if (edad < 0 || edad > VIDA_RETORNO_MS) throw new Error('vencida');
    return { code, savedAt };
  } catch {
    olvidarRetornoAMesa(almacen);
    return null;
  }
}

/** Uso único: devuelve la marca si vale y la borra SIEMPRE. */
export function tomarRetornoAMesa(ahora: number = Date.now(), almacen: Almacen | null = sesion()): RetornoAMesa | null {
  const marca = leerRetornoAMesa(ahora, almacen);
  olvidarRetornoAMesa(almacen);
  return marca;
}
