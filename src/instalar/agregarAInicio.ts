/**
 * D176 · decisión 176 de Mati · la guía «Agregar a inicio».
 *
 * Dónde se puede ofrecer y cómo:
 * - **iPhone/iPad en Safari** (`ios_safari`): Safari no tiene un botón de
 *   instalar que la web pueda tocar. Se muestra la guía: Compartir → «Agregar a
 *   inicio».
 * - **Android/Chrome** (`android_prompt`): Chrome avisa con `beforeinstallprompt`
 *   que se puede instalar; se guarda ese evento y la fila de Configuración llama
 *   `prompt()`.
 * - **Samsung Internet en Android sin el evento** (`samsung_guia`, D229): desde
 *   la versión 27 no dispara `beforeinstallprompt` e instala por su cuenta. Se
 *   muestra su guía: menú → «Agregar a» → «Pantalla de inicio». Si el evento
 *   llega (versiones viejas), gana la ventana nativa, como en Chrome.
 * - **Ya agregada** (`display-mode: standalone` o `navigator.standalone`):
 *   nada, ni aviso ni fila.
 * - Cualquier otro caso: nada.
 *
 * El aviso de primera vez se recuerda en `localStorage`. Si el almacenamiento
 * falla, se recuerda en memoria: como mucho una vez por sesión.
 */

/** Lo que hace falta saber del navegador; sale de `window` o de un test. */
export interface EntornoInstalacion {
  readonly userAgent: string;
  readonly platform: string;
  readonly maxTouchPoints: number;
  /** `navigator.standalone` tal cual: sólo `true` cuenta. */
  readonly standalone: unknown;
  /** `matchMedia('(display-mode: standalone)').matches`. */
  readonly displayStandalone: boolean;
  /** Hay un `beforeinstallprompt` guardado. */
  readonly hayPrompt: boolean;
}

export type Plataforma = 'ios_safari' | 'samsung_guia' | 'android_prompt' | null;

/** Las plataformas que se resuelven con una guía de pasos, no con la ventana nativa. */
export type PlataformaConGuia = 'ios_safari' | 'samsung_guia';

export function tieneGuia(p: Plataforma): p is PlataformaConGuia {
  return p === 'ios_safari' || p === 'samsung_guia';
}

export const CLAVE_VISTO = 'payme.app.agregar_a_inicio.v1';

/** iPhone, iPod o iPad, también el iPad que se presenta como Mac. */
export function esIOS(e: EntornoInstalacion): boolean {
  return /iPhone|iPad|iPod/.test(e.userAgent) || (e.platform === 'MacIntel' && e.maxTouchPoints > 1);
}

/** El iPad (Compartir va arriba a la derecha); el iPhone lo tiene abajo. */
export function esIPad(e: EntornoInstalacion): boolean {
  return /iPad/.test(e.userAgent) || (e.platform === 'MacIntel' && e.maxTouchPoints > 1);
}

/**
 * Safari de iOS, no otro navegador de iOS ni el navegador interno de una app
 * (Chrome, Firefox, Edge, Opera, Google, Facebook, Instagram, LINE…).
 */
export function esSafariIOS(e: EntornoInstalacion): boolean {
  return esIOS(e)
    && /Safari\//.test(e.userAgent)
    && !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|FBAN|FBAV|Instagram|Line\//.test(e.userAgent);
}

/**
 * D229 · Samsung Internet en un teléfono o tableta Android. No cuentan:
 * - el WebView (`; wv)`), que es el navegador interno de una app y no instala;
 * - los navegadores internos de Facebook, Instagram y LINE, aunque corran sobre
 *   Samsung;
 * - el modo escritorio de Samsung, que no dice `Android`.
 */
export function esSamsungInternet(e: EntornoInstalacion): boolean {
  return /SamsungBrowser\//.test(e.userAgent)
    && /Android/.test(e.userAgent)
    && !/; wv\)|FBAN|FBAV|Instagram|Line\//.test(e.userAgent);
}

/** Ya está agregada a inicio: la app corre en su ventana propia. */
export function instalada(e: EntornoInstalacion): boolean {
  return e.standalone === true || e.displayStandalone;
}

export function plataformaDeInstalacion(e: EntornoInstalacion): Plataforma {
  if (instalada(e)) return null;
  if (esSafariIOS(e)) return 'ios_safari';
  // El evento gana: si Samsung lo dispara, va la ventana nativa (D229).
  if (e.hayPrompt) return 'android_prompt';
  if (esSamsungInternet(e)) return 'samsung_guia';
  return null;
}

// ─── El `beforeinstallprompt` de Chrome ───────────────────────────────────

interface EventoDeInstalacion extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let promptGuardado: EventoDeInstalacion | null = null;
const oyentes = new Set<() => void>();

function avisar(): void {
  for (const oyente of [...oyentes]) oyente();
}

export function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => { oyentes.delete(oyente); };
}

/**
 * Engancha la captura. Va en el arranque, antes del primer render: Chrome
 * dispara `beforeinstallprompt` una vez por carga, y si nadie lo escucha se
 * pierde. `preventDefault` evita la barra propia de Chrome; la fila de
 * Configuración decide cuándo ofrecerlo.
 */
export function capturarInstalacion(win: Window = window): () => void {
  const alOfrecer = (evento: Event) => {
    evento.preventDefault();
    promptGuardado = evento as EventoDeInstalacion;
    avisar();
  };
  const alInstalar = () => {
    promptGuardado = null;
    avisar();
  };
  win.addEventListener('beforeinstallprompt', alOfrecer);
  win.addEventListener('appinstalled', alInstalar);
  return () => {
    win.removeEventListener('beforeinstallprompt', alOfrecer);
    win.removeEventListener('appinstalled', alInstalar);
  };
}

/**
 * Muestra el diálogo de Chrome. El evento sirve una sola vez: después de usarlo
 * se descarta, se haya aceptado o no.
 */
export async function pedirInstalacion(): Promise<'aceptada' | 'rechazada' | 'no_disponible'> {
  const evento = promptGuardado;
  if (!evento) return 'no_disponible';
  promptGuardado = null;
  avisar();
  await evento.prompt();
  const { outcome } = await evento.userChoice;
  return outcome === 'accepted' ? 'aceptada' : 'rechazada';
}

export function entornoActual(win: Window = window): EntornoInstalacion {
  const nav = win.navigator as Navigator & { standalone?: unknown };
  return {
    userAgent: nav.userAgent,
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    standalone: nav.standalone,
    displayStandalone: win.matchMedia?.('(display-mode: standalone)').matches ?? false,
    hayPrompt: promptGuardado !== null,
  };
}

// ─── El aviso de primera vez ──────────────────────────────────────────────

let vistoEnLaSesion = false;

/** ¿Ya se mostró y se cerró? Con el almacenamiento roto, lo que diga la sesión. */
export function avisoYaVisto(almacen: Pick<Storage, 'getItem'> | null): boolean {
  if (vistoEnLaSesion) return true;
  try {
    return almacen?.getItem(CLAVE_VISTO) === '1';
  } catch {
    return false;
  }
}

export function marcarAvisoVisto(almacen: Pick<Storage, 'setItem'> | null): void {
  vistoEnLaSesion = true;
  try {
    almacen?.setItem(CLAVE_VISTO, '1');
  } catch {
    // Sin almacenamiento: queda la marca en memoria, una vez por sesión.
  }
}

/** El `localStorage` del navegador, o `null` si ni siquiera se puede leer la propiedad. */
export function almacenLocal(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Sólo para tests: vuelve al estado inicial. */
export function reiniciarParaTests(): void {
  promptGuardado = null;
  vistoEnLaSesion = false;
  oyentes.clear();
}
