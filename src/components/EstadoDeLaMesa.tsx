import { useIdioma } from '../i18n/idioma';
import type { EstadoDeLaMesa as Estado } from '../screens/estadoDeLaMesaView';
import { FichasDeIniciales } from './FichasDeIniciales';

/**
 * D622 · AF-2 · mejora 2 (§2 de la especificación): la tarjeta con el estado de
 * la mesa, no plegable, debajo del encabezado y antes de «Quiénes están en la
 * mesa». No cambia la barra de la cabecera (D77): es otra cosa, con palabras.
 *
 * Sólo el titular lleva `role="status"`: la mesa se relee cada 10 s (D79) y un
 * relectura sin cambios no toca el texto, así que se anuncia una vez por cambio
 * del titular; los platos y el consejo no se anuncian solos.
 *
 * AF-4 · D628 · la tercera línea, «Se sumaron N de M», con las fichas de los que
 * se sumaron y un «?» punteado por cada esperado que falta. Sólo con el dato del
 * dueño (`members_version=1`); sin él no existe. Las fichas son decorativas: el
 * conteo lo dice el texto, que tampoco se anuncia solo.
 */
export function EstadoDeLaMesa({ estado }: { estado: Estado }) {
  const { t } = useIdioma();
  return (
    <div className="card estado-mesa">
      <p className="estado-mesa-titular" role="status">{estado.titular}</p>
      {estado.platos && <p className="estado-mesa-platos">{estado.platos}</p>}
      {estado.personas && (
        <p className="estado-mesa-personas">
          <FichasDeIniciales visibles={estado.personas.fichas} faltan={estado.personas.faltan} resto={estado.personas.resto} t={t} />
          <span className="estado-mesa-personas-texto">{estado.personas.texto}</span>
        </p>
      )}
      <p className="estado-mesa-consejo">{estado.consejo}</p>
    </div>
  );
}
