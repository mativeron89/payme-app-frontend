import type { EstadoDeLaMesa as Estado } from '../screens/estadoDeLaMesaView';

/**
 * D622 · AF-2 · mejora 2 (§2 de la especificación): la tarjeta con el estado de
 * la mesa, no plegable, debajo del encabezado y antes de «Quiénes están en la
 * mesa». No cambia la barra de la cabecera (D77): es otra cosa, con palabras.
 *
 * Sólo el titular lleva `role="status"`: la mesa se relee cada 10 s (D79) y un
 * relectura sin cambios no toca el texto, así que se anuncia una vez por cambio
 * del titular; los platos y el consejo no se anuncian solos.
 */
export function EstadoDeLaMesa({ estado }: { estado: Estado }) {
  return (
    <div className="card estado-mesa">
      <p className="estado-mesa-titular" role="status">{estado.titular}</p>
      {estado.platos && <p className="estado-mesa-platos">{estado.platos}</p>}
      <p className="estado-mesa-consejo">{estado.consejo}</p>
    </div>
  );
}
