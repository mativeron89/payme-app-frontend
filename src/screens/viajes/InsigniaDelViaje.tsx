import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { FotosDeViajes } from '../../api/fotosDeViajes';
import { COLORES_VIAJE, type ColorViaje } from '../../api/viajes';
import { useAuth } from '../../auth/AuthContext';
import './viajes.css';

/**
 * D255-6 · la inicial del viaje, en su círculo. D255 tramo 2 · sobre el color
 * del viaje (la paleta del dueño, texto blanco ≥ 4.5:1) y, si tiene, su foto.
 * Sin color, el teal de la app.
 */
export function inicialDelViaje(nombre: string): string {
  const primera = Array.from(nombre.trim())[0];
  return primera ? primera.toLocaleUpperCase('es-MX') : '·';
}

export function InsigniaDelViaje({ nombre, color = null, foto = null, grande = false }: {
  nombre: string;
  color?: ColorViaje | null;
  foto?: string | null;
  grande?: boolean;
}) {
  const clase = `vj-insignia${grande ? ' vj-insignia--grande' : ''}${color ? ' vj-insignia--color' : ''}`;
  return (
    <span className={clase} style={color ? { background: COLORES_VIAJE[color] } : undefined} aria-hidden="true">
      {foto ? <img className="vj-insignia-foto" src={foto} alt="" /> : inicialDelViaje(nombre)}
    </span>
  );
}

/**
 * D255 · las fotos de los viajes que se muestran (la lista de Inicio, la
 * pantalla del viaje, Configuración), con `FotosDeViajes`. Devuelve la URL de la
 * foto de cada viaje (o `null`) y cómo pedir de nuevo la de uno.
 */
export function useFotosDeViajes(
  viajes: ReadonlyArray<{ readonly id: string; readonly has_photo: boolean }> | null,
): { fotoDe: (viajeId: string) => string | null; recargar: (viajeId: string) => void } {
  const { session } = useAuth();
  const sesionRef = useRef(session);
  sesionRef.current = session;
  const fotosRef = useRef<FotosDeViajes | null>(null);
  const [, setVersion] = useState(0);
  // Se crea en el efecto (como `useFotosDeMiembros`): StrictMode monta, desmonta y
  // vuelve a montar, y una instancia ya `dispose` no volvería a avisar.
  useEffect(() => {
    const fotos = new FotosDeViajes(
      () => sesionRef.current,
      async (viajeId, s) => (await api.getFotoDeViaje(viajeId, s)).blob,
      () => setVersion((n) => n + 1),
    );
    fotosRef.current = fotos;
    return () => {
      fotos.dispose();
      if (fotosRef.current === fotos) fotosRef.current = null;
    };
  }, []);
  useEffect(() => {
    if (viajes) fotosRef.current?.cargar(viajes);
  }, [viajes]);
  return {
    fotoDe: (viajeId) => fotosRef.current?.url(viajeId) ?? null,
    recargar: (viajeId) => fotosRef.current?.recargar(viajeId),
  };
}
