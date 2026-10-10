import { useEffect, useRef, type RefObject } from 'react';

/**
 * D202 · H-04 (auditoría Codex): las hojas modales hechas a mano declaraban
 * `aria-modal`, enfocaban un botón y cerraban con Escape, pero Tab salía de la
 * hoja y llegaba al fondo («Borrar todas»: el tercer Tab enfocaba Volver de la
 * pantalla de atrás con la hoja abierta).
 *
 * Mientras la hoja está montada:
 * - el foco entra en `inicial`;
 * - Tab y Shift+Tab ciclan dentro de la hoja;
 * - el armazón de la app (`.app`) queda `inert`: ni foco ni toques. La hoja va
 *   por portal a `body`, afuera; el toast es hermano de `.app` y sigue
 *   anunciándose;
 * - Escape cierra.
 * Al desmontarse, `.app` deja de ser inerte si ya no queda ninguna hoja abierta.
 * D256 · antes cada hoja guardaba el `inert` que veía al abrir y lo restauraba al
 * cerrarse: con dos hojas cerradas fuera de orden, la última devolvía el `true`
 * que había visto y `.app` quedaba inerte para siempre, sin toques ni scroll.
 * Ahora manda el registro de hojas abiertas (`hojasAbiertas`), y `.app` se busca
 * de nuevo en cada cambio (si la app se volvió a montar, se libera la de ahora).
 * El foco al disparador lo devuelve
 * quien abre la hoja, en el cuadro siguiente: «Borrar todas» (AvisosScreen) y la
 * fila «Agregar a inicio» (MasScreen); un clic en Safari no enfoca el botón, así
 * que «lo que tenía el foco al abrir» no alcanza. El panel de diagnóstico se
 * abre con 5 toques en el logo, que no recibe foco.
 */

/** D256 · las hojas abiertas ahora: `.app` es inerte mientras haya alguna. */
const abiertas = new Set<symbol>();

/** Cuántas hojas hay abiertas (lo muestra el panel de diagnóstico). */
export function hojasAbiertas(): number {
  return abiertas.size;
}

function aplicarInerte(): void {
  const app = document.querySelector<HTMLElement>('.app');
  if (app) app.inert = abiertas.size > 0;
}

/** Lo que el teclado recorre dentro de la hoja. */
const ENFOCABLES = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useHojaModal(
  hoja: RefObject<HTMLElement | null>,
  inicial: RefObject<HTMLElement | null>,
  alCerrar: () => void,
): void {
  const cerrar = useRef(alCerrar);
  cerrar.current = alCerrar;

  useEffect(() => {
    const esta = Symbol('hoja');
    abiertas.add(esta);
    aplicarInerte();
    inicial.current?.focus();

    const alTeclado = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        cerrar.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const el = hoja.current;
      if (!el) return;
      const enfocables = [...el.querySelectorAll<HTMLElement>(ENFOCABLES)];
      const primero = enfocables[0];
      const ultimo = enfocables[enfocables.length - 1];
      if (!primero || !ultimo) return;
      // Desde afuera de la hoja (un toque en el velo deja el foco en `body`) no
      // hace falta nada: con `.app` inerte, lo único enfocable es la hoja.
      const activo = document.activeElement;
      if (event.shiftKey && activo === primero) {
        event.preventDefault();
        ultimo.focus();
      } else if (!event.shiftKey && activo === ultimo) {
        event.preventDefault();
        primero.focus();
      }
    };
    document.addEventListener('keydown', alTeclado);
    return () => {
      document.removeEventListener('keydown', alTeclado);
      abiertas.delete(esta);
      aplicarInerte();
    };
  }, [hoja, inicial]);
}
