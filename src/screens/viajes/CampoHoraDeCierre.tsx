import { useIdioma } from '../../i18n/idioma';
import { horaDeCierreValida } from './crearViajeView';

/**
 * D279 · «Hora de cierre», junto a las fechas, en Crear viaje y en Configuración. Va en la celda de «Al»: a esa hora
 * del último día el viaje se cierra solo. La pantalla lo muestra sólo con fecha hasta; en Configuración, sólo a quien
 * creó el viaje. El campo nativo de hora del teléfono, 23:59 por defecto.
 */
export function CampoHoraDeCierre({ id, hora, onHora }: { id: string; hora: string; onHora: (v: string) => void }) {
  const { t } = useIdioma();
  const valida = horaDeCierreValida(hora);
  return (
    <div className="vjc-fecha vjc-hora">
      <label className="vjc-sub" htmlFor={id}>{t('Hora de cierre')}</label>
      <input
        id={id}
        className="input vjc-input"
        type="time"
        value={hora}
        required
        aria-invalid={!valida || undefined}
        onChange={(e) => onHora(e.target.value)}
      />
    </div>
  );
}
