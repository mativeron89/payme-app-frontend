import { Icon } from '../components/Icon';
import { useIdioma } from '../i18n/idioma';

/**
 * D275 · «No tienes mesas abiertas», con el diseño de Claude Design (`PANTALLA-burbuja-del-viaje.md` §3) y el «+» de
 * antes cambiado por el ícono de la cámara de Nueva, que es lo que hay que tocar (D249). Sólo se muestra sin mesas
 * abiertas: Inicio decide cuándo.
 *
 * D277 · Mati: «No esta centrado el mensaje de “no tienes mesas..”», y eligió «En el medio del espacio vacío». Va al
 * final del contenido de Inicio, en el flujo, y toma el resto del alto: el texto queda centrado entre lo último de
 * arriba y el círculo de Nueva. Con mucho contenido, va debajo, con el aire mínimo (`.aviso-sin-mesas`).
 */
export function AvisoSinMesas() {
  const { t } = useIdioma();
  return (
    <div className="aviso-sin-mesas">
      <div className="aviso-sin-mesas-titulo">{t('No tienes mesas abiertas')}</div>
      <div className="aviso-sin-mesas-cuerpo">
        <span>{t('Toca el')}</span>
        <span className="aviso-sin-mesas-camara" role="img" aria-label={t('ícono de cámara')}>
          <Icon name="camera" size={20} />
        </span>
        <span>{t('para abrir una')}</span>
      </div>
    </div>
  );
}
