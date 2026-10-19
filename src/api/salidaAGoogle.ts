/**
 * P02-b · D372 · «Parece que Google no terminó. Toca «Continuar con Google» de
 * nuevo.»
 *
 * Quien toca «Continuar con Google» en modo redirect SALE de la app a Google.
 * Si vuelve sin terminar (Atrás desde Google, o el navegador que descarta la
 * pestaña), la app no sabe por qué está otra vez en el ingreso. Esta marca dice
 * SÓLO que la persona tocó el botón que sale y cuándo: nunca la mesa, el token,
 * el `state` ni un dato personal.
 *
 * - La escribe el TOQUE: `click_listener` de GIS (`googleIdentity.ts`) y, en el
 *   mock, el clic. El `inicio` de `googleRedirectInicio.ts` no sirve como marca:
 *   se escribe al DIBUJAR el botón.
 * - La lee `LoginScreen` al montar (con el botón en pantalla) y en `pageshow`
 *   con `persisted` (la página que vuelve del bfcache sin remontar).
 * - Se borra: con una vuelta de Google (en curso, con error o del alta), al
 *   cerrar sesión (`olvidarRetornoAMesa`), al vencer (30 minutos), con forma
 *   inválida y al avisar (uso único). No se usa `pagehide`: un F5 en el ingreso
 *   también lo dispara y avisaría a quien no salió.
 *
 * No verificado: que GIS llame a `click_listener` en redirect antes de navegar
 * (lo prueba Mati en el iPhone, D63). Si no lo llama, el aviso no aparece y
 * P02-a sigue igual (respuestas de V al plan).
 */
export const CLAVE_SALIDA_GOOGLE = 'payme.app.google_salida.v1';

/** 30 minutos, como el retorno a la mesa. */
export const VIDA_SALIDA_MS = 30 * 60 * 1000;

type Almacen = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function sesion(): Almacen | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** La persona tocó el botón que sale a Google. Sin storage no se marca: la ida sigue igual. */
export function marcarSalidaAGoogle(ahora: number = Date.now(), almacen: Almacen | null = sesion()): void {
  if (!almacen) return;
  try {
    almacen.setItem(CLAVE_SALIDA_GOOGLE, JSON.stringify({ savedAt: ahora }));
  } catch {
    // Sin marca no hay aviso; la ida a Google no se frena por esto.
  }
}

export function olvidarSalidaAGoogle(almacen: Almacen | null = sesion()): void {
  try {
    almacen?.removeItem(CLAVE_SALIDA_GOOGLE);
  } catch {
    // El vencimiento la invalida.
  }
}

/** La marca, si vale: exactamente `{savedAt}`, de los últimos 30 minutos. Cualquier otra cosa se BORRA. */
export function leerSalidaAGoogle(ahora: number = Date.now(), almacen: Almacen | null = sesion()): { readonly savedAt: number } | null {
  let crudo: string | null = null;
  try {
    crudo = almacen?.getItem(CLAVE_SALIDA_GOOGLE) ?? null;
  } catch {
    return null;
  }
  if (crudo === null) return null;
  try {
    const valor: unknown = JSON.parse(crudo);
    if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) throw new Error('forma');
    if (Object.keys(valor).join(',') !== 'savedAt') throw new Error('forma');
    const { savedAt } = valor as Record<string, unknown>;
    if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) throw new Error('forma');
    const edad = ahora - savedAt;
    if (edad < 0 || edad > VIDA_SALIDA_MS) throw new Error('vencida');
    return { savedAt };
  } catch {
    olvidarSalidaAGoogle(almacen);
    return null;
  }
}

/** Lo que `LoginScreen` sabe de una vuelta de Google: la del ingreso (`vueltaGoogle.fase`) y la del alta. */
export interface VueltaDeGoogle {
  readonly fase: 'idle' | 'processing' | 'error';
  /** Hay un código de alta en memoria, o la página cargó con una vuelta del alta (válida o no). */
  readonly hayVueltaDeAlta: boolean;
}

export function hayVueltaDeGoogle(v: VueltaDeGoogle): boolean {
  return v.fase !== 'idle' || v.hayVueltaDeAlta;
}

/**
 * Uso único. Con una vuelta de Google (en curso, con error o del alta), borra la
 * marca y no avisa: Google terminó. Sin vuelta, la toma (la borra siempre) y
 * avisa si valía.
 */
export function revisarSalidaAGoogle(v: VueltaDeGoogle, ahora: number = Date.now(), almacen: Almacen | null = sesion()): boolean {
  if (hayVueltaDeGoogle(v)) {
    olvidarSalidaAGoogle(almacen);
    return false;
  }
  const marca = leerSalidaAGoogle(ahora, almacen);
  olvidarSalidaAGoogle(almacen);
  return marca !== null;
}
