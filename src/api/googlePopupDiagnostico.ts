/**
 * RM-182 · 5a · diagnóstico del popup de Google que «no vuelve».
 *
 * Mati lo vio en Safari/iPhone: con «Usar otra cuenta» dentro del popup de
 * Google, la app no avanza y a veces queda una pestaña de Google con error. El
 * diagnóstico de sólo lectura (App Frontend - Sonnet) apunta a que Safari/ITP
 * pierde la vuelta del popup (`postMessage`/`window.opener`) sin error visible.
 * Esto sirve para CONFIRMARLO en un Safari real, no para arreglarlo.
 *
 * **Qué mide.** El botón de GIS es un `<iframe>` de Google: la app no ve el
 * toque, pero sí que la ventana pierde el foco hacia ESE iframe cuando se abre
 * el popup. Si la ventana recupera el foco y, pasado un margen, no llegó ninguna
 * credencial, se escribe UN evento `google_popup_stuck` en la consola.
 *
 * **Qué NO manda.** Nada por la red y nada personal: sin correo, sin nombre,
 * sin `user agent` completo, sin credencial. Sólo el motor y la plataforma en
 * trazo grueso, y cuánto estuvo abierto. Se lee con el inspector web de Safari.
 *
 * ⚠️ **Falso positivo declarado:** si la persona cierra el popup a propósito,
 * también se registra. Por eso va la duración: un cierre al segundo y un popup
 * que quedó un minuto no se leen igual.
 */

export type Motor = 'webkit' | 'blink' | 'gecko' | 'otro';
export type Plataforma = 'ios' | 'macos' | 'android' | 'otra';

export interface EventoPopupTrabado {
  readonly event: 'google_popup_stuck';
  readonly engine: Motor;
  readonly platform: Plataforma;
  /** Milisegundos entre que se abrió el popup y que la ventana volvió. */
  readonly open_ms: number;
}

/** Margen para que llegue la credencial después de que la ventana vuelve. */
export const MARGEN_CREDENCIAL_MS = 2000;

/**
 * El motor, en trazo grueso. En iOS todos los navegadores son WebKit, así que
 * «CriOS» o «FxiOS» también cuentan como WebKit: es el motor el que importa acá.
 */
export function motorDe(ua: string): Motor {
  if (/iPhone|iPad|iPod/.test(ua)) return 'webkit';
  if (/Firefox\//.test(ua)) return 'gecko';
  if (/Chrome\/|Chromium\/|Edg\//.test(ua)) return 'blink';
  if (/AppleWebKit\//.test(ua) && /Safari\//.test(ua)) return 'webkit';
  return 'otro';
}

export function plataformaDe(ua: string, maxTouchPoints: number): Plataforma {
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  // iPadOS se presenta como Mac: la pantalla táctil lo delata.
  if (/Macintosh/.test(ua)) return maxTouchPoints > 1 ? 'ios' : 'macos';
  if (/Android/.test(ua)) return 'android';
  return 'otra';
}

export interface VigiaPopupGoogle {
  /** La credencial llegó: el popup volvió bien y no hay nada que registrar. */
  credencialRecibida(): void;
  dispose(): void;
}

export interface OpcionesVigia {
  readonly registrar?: (evento: EventoPopupTrabado) => void;
  readonly ahora?: () => number;
}

function registrarEnConsola(evento: EventoPopupTrabado): void {
  // Diagnóstico deliberado, sin PII: ver el encabezado.
  console.info('[payme] google_popup_stuck', evento);
}

/**
 * Vigila el contenedor del botón de Google. Un evento por apertura, como mucho.
 */
export function vigilarPopupGoogle(container: HTMLElement, opciones: OpcionesVigia = {}): VigiaPopupGoogle {
  const registrar = opciones.registrar ?? registrarEnConsola;
  const ahora = opciones.ahora ?? (() => Date.now());
  let abiertoDesde: number | null = null;
  let espera: ReturnType<typeof setTimeout> | null = null;

  const cancelarEspera = () => {
    if (espera !== null) clearTimeout(espera);
    espera = null;
  };

  const alPerderFoco = () => {
    // El foco se va DESPUÉS del blur: se mira en la próxima vuelta.
    setTimeout(() => {
      const activo = document.activeElement;
      if (activo !== null && activo.tagName === 'IFRAME' && container.contains(activo)) {
        cancelarEspera();
        abiertoDesde = ahora();
      }
    }, 0);
  };

  const alVolver = () => {
    if (abiertoDesde === null || espera !== null) return;
    const desde = abiertoDesde;
    const volvio = ahora();
    espera = setTimeout(() => {
      espera = null;
      if (abiertoDesde !== desde) return;
      abiertoDesde = null;
      const ua = navigator.userAgent;
      registrar({
        event: 'google_popup_stuck',
        engine: motorDe(ua),
        platform: plataformaDe(ua, navigator.maxTouchPoints ?? 0),
        open_ms: Math.max(0, volvio - desde),
      });
    }, MARGEN_CREDENCIAL_MS);
  };

  const alCambiarVisibilidad = () => {
    if (document.visibilityState === 'visible') alVolver();
  };

  window.addEventListener('blur', alPerderFoco);
  window.addEventListener('focus', alVolver);
  document.addEventListener('visibilitychange', alCambiarVisibilidad);

  return {
    credencialRecibida() {
      abiertoDesde = null;
      cancelarEspera();
    },
    dispose() {
      abiertoDesde = null;
      cancelarEspera();
      window.removeEventListener('blur', alPerderFoco);
      window.removeEventListener('focus', alVolver);
      document.removeEventListener('visibilitychange', alCambiarVisibilidad);
    },
  };
}
