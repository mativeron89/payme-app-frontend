import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { apagar, camaraDisponible, capturarFoto, clasificarErrorDeCamara, RESTRICCIONES, type Captura, type EstadoCamara } from './camaraTrasera';

/**
 * D177 · el ciclo de vida de la cámara en vivo.
 *
 * - Se abre cuando `activa` es `true` y la pestaña está visible; se apaga al
 *   dejar de estarlo (capturar, salir del paso, desmontar, ir a segundo plano).
 *   Al volver al frente se vuelve a abrir: en la app de inicio de iOS el stream
 *   suele morir en segundo plano, y uno colgado deja la vista negra.
 * - Apagar es parar TODAS las pistas: si no, queda encendida la luz de la cámara.
 * - Una respuesta de `getUserMedia` que llega cuando ya no hace falta se apaga
 *   en el acto, sin tocar la pantalla.
 * - `playsinline` y `muted`: sin ellos iOS abre el video a pantalla completa o
 *   no lo reproduce solo.
 */
export function useCamaraTrasera(
  video: RefObject<HTMLVideoElement | null>,
  activa: boolean,
): { estado: EstadoCamara; capturar: (maxBytes: number) => Promise<Captura> } {
  const [estado, setEstado] = useState<EstadoCamara>('apagada');
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  const stream = useRef<MediaStream | null>(null);
  const intento = useRef(0);

  useEffect(() => {
    const alCambiar = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', alCambiar);
    window.addEventListener('pagehide', alCambiar);
    return () => {
      document.removeEventListener('visibilitychange', alCambiar);
      window.removeEventListener('pagehide', alCambiar);
    };
  }, []);

  const encendida = activa && visible;

  useEffect(() => {
    const miIntento = ++intento.current;
    const el = video.current;
    const soltar = () => {
      apagar(stream.current);
      stream.current = null;
      if (el) el.srcObject = null;
    };
    if (!encendida) {
      // Lo apagó la limpieza del efecto anterior (abajo): ésa es la que cuenta.
      setEstado('apagada');
      return undefined;
    }
    if (!camaraDisponible(window)) {
      setEstado('sin_soporte');
      return undefined;
    }
    setEstado('abriendo');
    let alListo: (() => void) | null = null;
    navigator.mediaDevices.getUserMedia(RESTRICCIONES).then(
      (nuevo) => {
        if (miIntento !== intento.current || !el) {
          apagar(nuevo);
          return;
        }
        stream.current = nuevo;
        el.muted = true;
        el.playsInline = true;
        el.setAttribute('playsinline', '');
        el.srcObject = nuevo;
        const listo = () => {
          if (miIntento === intento.current && el.videoWidth > 0) setEstado('lista');
        };
        alListo = listo;
        el.addEventListener('loadeddata', listo);
        el.addEventListener('resize', listo);
        void el.play().catch(() => undefined);
        listo();
      },
      (error: unknown) => {
        if (miIntento === intento.current) setEstado(clasificarErrorDeCamara(error));
      },
    );
    return () => {
      intento.current += 1;
      if (el && alListo) {
        el.removeEventListener('loadeddata', alListo);
        el.removeEventListener('resize', alListo);
      }
      soltar();
    };
  }, [encendida, video]);

  const capturar = useCallback(async (maxBytes: number) => {
    const el = video.current;
    if (!el || !stream.current) return 'sin_cuadro' as const;
    return capturarFoto(el, maxBytes);
  }, [video]);

  return { estado, capturar };
}
