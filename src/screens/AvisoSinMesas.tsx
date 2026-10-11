import { Icon } from '../components/Icon';
import { useIdioma } from '../i18n/idioma';

/**
 * D275 · «No tienes mesas abiertas», con el diseño de Claude Design (`PANTALLA-burbuja-del-viaje.md` §3): al pie de
 * Inicio, 40 px sobre la barra (lo cuelga `AppBottomBar`), y el «+» de antes cambiado por el ícono de la cámara de
 * Nueva, que es lo que hay que tocar (D249). Sólo se muestra sin mesas abiertas: Inicio decide cuándo.
 */
export function AvisoSinMesas() {
  const { t } = useIdioma();
  return (
    <>
      <div className="aviso-sin-mesas-titulo">{t('No tienes mesas abiertas')}</div>
      <div className="aviso-sin-mesas-cuerpo">
        <span>{t('Toca el')}</span>
        <span className="aviso-sin-mesas-camara" role="img" aria-label={t('ícono de cámara')}>
          <Icon name="camera" size={20} />
        </span>
        <span>{t('para abrir una')}</span>
      </div>
    </>
  );
}
