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
 */

export interface CamaraNativa {
  /** Abre la cámara. Sólo dentro de un toque. */
  abrir(): void;
  /** Quién recibe la próxima foto. Devuelve cómo dejar de escuchar. */
  alRecibirFoto(receptor: (foto: File) => void): () => void;
}

/** Lo mínimo del `document` que hace falta: los tests pasan uno falso. */
export type DocumentoParaCamara = Pick<Document, 'createElement' | 'body'>;

export function crearCamaraNativa(doc: DocumentoParaCamara): CamaraNativa {
  let entrada: HTMLInputElement | null = null;
  let receptor: ((foto: File) => void) | null = null;

  const laEntrada = (): HTMLInputElement => {
    if (entrada?.isConnected) return entrada;
    const nueva = doc.createElement('input');
    nueva.type = 'file';
    nueva.accept = 'image/*';
    nueva.setAttribute('capture', 'environment');
    nueva.hidden = true;
    nueva.setAttribute('aria-hidden', 'true');
    nueva.tabIndex = -1;
    nueva.addEventListener('change', () => {
      const foto = nueva.files?.[0] ?? null;
      // Sin limpiar, la misma foto no dispararía `change` otra vez.
      nueva.value = '';
      if (foto && receptor) receptor(foto);
    });
    doc.body.append(nueva);
    entrada = nueva;
    return nueva;
  };

  return {
    abrir() {
      laEntrada().click();
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

/** Abre la cámara nativa. Sólo dentro de un toque (ver arriba). */
export function abrirCamaraNativa(): void {
  laCamara().abrir();
}

/** Recibe la foto de la cámara nativa mientras la pantalla escucha. */
export function alRecibirFotoDeLaCamara(receptor: (foto: File) => void): () => void {
  return laCamara().alRecibirFoto(receptor);
}
