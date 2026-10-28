/**
 * D212 · la cámara nativa del teléfono.
 *
 * Es UNA entrada `<input type="file" accept="image/*" capture="environment">`
 * para toda la app. `capture` hace que el iPhone abra directo la Cámara (sin la
 * hoja de Fototeca/Archivos) y Android su app de cámara, con la foto a la
 * resolución completa del teléfono. En la computadora el navegador lo ignora y
 * abre el selector de archivos, que es el respaldo correcto.
 *
 * 🔴 **`abrir()` tiene que llamarse DENTRO del toque**, sincrónico en el
 * `onClick`: iOS abre la cámara sólo si el `click()` ocurre durante el gesto de
 * la persona. Por eso «Nueva» la abre en su propio toque y después navega:
 * hacerlo desde un efecto al montar «Escanea el ticket» dependería de cuándo
 * monta React.
 *
 * La entrada vive en el `body` y no en una pantalla: «Nueva» está en Inicio y
 * la foto llega cuando la app ya está en «Escanea el ticket», así que tiene que
 * sobrevivir a la navegación. La recibe quien esté escuchando
 * (`alRecibirFoto`); si no hay nadie, se descarta: una foto que llega tarde no
 * aparece después en otra mesa (la misma regla que D202).
 *
 * La misma entrada tiene dos formas de abrirse.
 * - `abrir()`: con `capture`, la cámara directo. D536 · también el «Escanear» de
 *   la barra (pantalla principal y fechas de viaje), como antes de D368. Mati,
 *   en D535: «no abre la camara de una, quiero que abra la camara».
 *   Además el botón redondo de «Escanea el ticket», «Sacar otra», «Reintentar» y
 *   «Escanear otro» del viaje. El carrete sigue en «Elegir de la galería» de la
 *   pantalla de abajo, con su propia entrada.
 * - `abrirMenu(accept)`: SIN `capture`, el menú del teléfono (D368). Desde D536
 *   ningún botón de la app la usa; queda en la fábrica, con sus pruebas.
 * La foto llega con la forma en que se abrió (`origen`): desde el menú puede ser
 * del carrete, así que la pantalla la trata como de la galería.
 *
 * La entrada lleva `data-camara` para que el registro de la suite e2e la
 * reconozca en las dos formas (sin `capture` ya no se distingue por eso).
 */

/** Cómo se abrió la entrada: la cámara directo o el menú del teléfono. */
export type OrigenDeLaFoto = 'camara' | 'menu';

/** Lo que la cámara directo acepta: cualquier foto, la cámara manda JPEG o HEIC. */
const ACCEPT_DE_LA_CAMARA = 'image/*';

export interface CamaraNativa {
  /** Abre la cámara directo. Sólo dentro de un toque. */
  abrir(): void;
  /** D368 · abre el menú del teléfono (sin `capture`), con ese `accept`. Sólo dentro de un toque. */
  abrirMenu(accept: string): void;
  /** Quién recibe la próxima foto. Devuelve cómo dejar de escuchar. */
  alRecibirFoto(receptor: (foto: File, origen: OrigenDeLaFoto) => void): () => void;
}

/** Lo mínimo del `document` que hace falta: los tests pasan uno falso. */
export type DocumentoParaCamara = Pick<Document, 'createElement' | 'body'>;

export function crearCamaraNativa(doc: DocumentoParaCamara): CamaraNativa {
  let entrada: HTMLInputElement | null = null;
  let receptor: ((foto: File, origen: OrigenDeLaFoto) => void) | null = null;
  /** Cómo se abrió la última vez: con eso llega la foto. */
  let origen: OrigenDeLaFoto = 'camara';

  const laEntrada = (): HTMLInputElement => {
    if (entrada?.isConnected) return entrada;
    const nueva = doc.createElement('input');
    nueva.type = 'file';
    nueva.accept = ACCEPT_DE_LA_CAMARA;
    nueva.setAttribute('capture', 'environment');
    nueva.setAttribute('data-camara', 'nativa');
    nueva.hidden = true;
    nueva.setAttribute('aria-hidden', 'true');
    nueva.tabIndex = -1;
    nueva.addEventListener('change', () => {
      const foto = nueva.files?.[0] ?? null;
      // Sin limpiar, la misma foto no dispararía `change` otra vez.
      nueva.value = '';
      if (foto && receptor) receptor(foto, origen);
    });
    doc.body.append(nueva);
    entrada = nueva;
    return nueva;
  };

  return {
    abrir() {
      const e = laEntrada();
      e.accept = ACCEPT_DE_LA_CAMARA;
      e.setAttribute('capture', 'environment');
      origen = 'camara';
      e.click();
    },
    abrirMenu(accept) {
      const e = laEntrada();
      e.accept = accept;
      e.removeAttribute('capture');
      origen = 'menu';
      e.click();
    },
    alRecibirFoto(nuevo) {
      receptor = nuevo;
      return () => {
        if (receptor === nuevo) receptor = null;
      };
    },
  };
}

let unica: CamaraNativa | null = null;

function laCamara(): CamaraNativa {
  unica ??= crearCamaraNativa(document);
  return unica;
}

/** Abre la cámara nativa directo. Sólo dentro de un toque (ver arriba). */
export function abrirCamaraNativa(): void {
  laCamara().abrir();
}

/** Recibe la foto de la cámara nativa mientras la pantalla escucha, con cómo se abrió. */
export function alRecibirFotoDeLaCamara(receptor: (foto: File, origen: OrigenDeLaFoto) => void): () => void {
  return laCamara().alRecibirFoto(receptor);
}
