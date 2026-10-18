import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { api } from '../api';
import type { ShareTotals, TipSetting } from '../api/miParte';
import {
  estadoDePropina,
  suscribirPropina,
  type ClaveDePropina,
  type DependenciasDePropina,
  type EstadoDePropina,
} from '../api/propinaDeLaMesa';
import { useIdioma } from '../i18n/idioma';
import { formatMXN } from '../utils/format';
import { centsToString } from '../utils/money';
import {
  PRESETS_DE_LA_MESA,
  mensajeDeRechazo,
  pideConfirmarOtro,
  presetDe,
  sanearOtro,
  servicioImpreso,
  settingDeOtro,
  settingDePreset,
} from '../screens/propinaDeLaMesaView';

/**
 * D344 · el estado del `PUT /tip` de una mesa, desde `propinaDeLaMesa.ts`. La
 * misma clave en «Compartir la mesa» y en «Tu mesa»: el pedido sobrevive a la
 * navegación entre las dos.
 */
export function useEstadoDePropina(clave: ClaveDePropina | null): EstadoDePropina {
  return useSyncExternalStore(suscribirPropina, () => estadoDePropina(clave), () => estadoDePropina(null));
}

/** El transporte de la fachada (real o mock) y la cuenta con sesión, para el reintento. */
export function dependenciasDePropina(cuentaActual: () => string | null): DependenciasDePropina {
  return {
    enviar: (code, setting, timeoutMs) => api.fijarPropinaDeLaMesa(code, setting, timeoutMs),
    cuentaActual,
  };
}

/**
 * D344 · el selector del organizador: 0/5/10/15/20 % y «Otro», sin nada
 * preseleccionado (P1, §1.5 bis). No obliga ni bloquea: sin elegir, la propina
 * queda «sin fijar» y se eligen platos igual. D360-3: al elegir un % ya no se
 * muestra cuánto da para toda la mesa («Son $X…» salió); quedan el aviso del
 * cargo por servicio y la confirmación de «Otro».
 *
 * Lo que muestra marcado es lo que se está guardando, o si no, lo que guardó
 * el dueño. Nunca un % que nadie eligió.
 */
export function PropinaDeLaMesa({
  guardada,
  totales,
  estado,
  onElegir,
  onReintentar,
}: {
  /** Lo que publica el dueño en el detalle (`tip_setting`). */
  readonly guardada: TipSetting | null;
  readonly totales: ShareTotals | null | undefined;
  readonly estado: EstadoDePropina;
  readonly onElegir: (setting: TipSetting | null) => void;
  readonly onReintentar: () => void;
}) {
  const { t } = useIdioma();
  const tituloId = useId();
  const confirmTituloId = useId();
  const guardando = estado.fase === 'guardando';
  const mostrada = guardando ? estado.deseado : guardada;
  const preset = presetDe(mostrada);
  const esOtro = mostrada !== null && 'tip_cents' in mostrada;
  const [otroAbierto, setOtroAbierto] = useState(esOtro);
  const [otroTexto, setOtroTexto] = useState(esOtro && 'tip_cents' in mostrada ? centsToString(mostrada.tip_cents) : '');
  const [otroInvalido, setOtroInvalido] = useState(false);
  const [porConfirmar, setPorConfirmar] = useState<TipSetting | null>(null);
  const confirmarRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (porConfirmar) confirmarRef.current?.focus();
  }, [porConfirmar]);

  const montoPorConfirmar = porConfirmar && 'tip_cents' in porConfirmar ? porConfirmar.tip_cents : null;
  const servicio = servicioImpreso(totales);

  const fijarOtro = (): void => {
    const setting = settingDeOtro(otroTexto);
    if (!setting || !('tip_cents' in setting)) { setOtroInvalido(true); return; }
    setOtroInvalido(false);
    if (pideConfirmarOtro(setting.tip_cents, totales)) { setPorConfirmar(setting); return; }
    onElegir(setting);
  };

  return (
    <section className="card propina-mesa" aria-labelledby={tituloId}>
      <div className="propina-mesa-titulo" id={tituloId}>{t('Propina de la mesa')}</div>
      {servicio !== null && (
        <p className="propina-mesa-servicio" role="note">
          {t('El ticket ya trae un cargo por servicio de {0}.', formatMXN(servicio))}
        </p>
      )}
      <div className="propina-mesa-opciones" role="radiogroup" aria-labelledby={tituloId}>
        {PRESETS_DE_LA_MESA.map((pct) => {
          const elegida = preset === pct;
          return (
            <button
              key={pct}
              type="button"
              className={`propina-mesa-pill${elegida ? ' sel' : ''}`}
              role="radio"
              aria-checked={elegida}
              disabled={guardando}
              onClick={() => { setOtroAbierto(false); setPorConfirmar(null); onElegir(settingDePreset(pct)); }}
            >
              {pct}%
            </button>
          );
        })}
        <button
          type="button"
          className={`propina-mesa-pill propina-mesa-pill--otro${esOtro || otroAbierto ? ' sel' : ''}`}
          role="radio"
          aria-checked={esOtro || otroAbierto}
          disabled={guardando}
          onClick={() => setOtroAbierto(true)}
        >
          {t('Otro')}
        </button>
      </div>
      {otroAbierto && (
        <div className="propina-mesa-otro">
          <span aria-hidden="true">$</span>
          <input
            className="input"
            inputMode="decimal"
            placeholder="0.00"
            value={otroTexto}
            disabled={guardando}
            aria-label={t('Monto de la propina de la mesa')}
            aria-invalid={otroInvalido || undefined}
            onChange={(e) => { setOtroTexto(sanearOtro(e.target.value)); setOtroInvalido(false); }}
            onKeyDown={(e) => { if (e.key === 'Enter') fijarOtro(); }}
          />
          <button type="button" className="btn btn-turquesa btn-sm btn-fit" disabled={guardando} onClick={fijarOtro}>
            {t('Fijar')}
          </button>
        </div>
      )}
      {otroInvalido && (
        <p className="propina-mesa-error" role="alert">{t('Escribe un monto, por ejemplo 150 o 150.50.')}</p>
      )}
      {porConfirmar && montoPorConfirmar !== null && totales && (
        <div className="propina-mesa-confirmar" role="alertdialog" aria-labelledby={confirmTituloId}>
          <p id={confirmTituloId}>
            {t('La propina ({0}) es más de 3 veces los platos de la mesa ({1}). ¿La dejas así?',
              formatMXN(montoPorConfirmar), formatMXN(totales.items_cents))}
          </p>
          <div className="propina-mesa-confirmar-acciones">
            <button
              ref={confirmarRef}
              type="button"
              className="btn btn-turquesa btn-sm"
              onClick={() => { const s = porConfirmar; setPorConfirmar(null); onElegir(s); }}
            >
              {t('Sí, dejarla')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPorConfirmar(null)}>
              {t('Cambiarla')}
            </button>
          </div>
        </div>
      )}
      {mostrada !== null && !guardando && (
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-fit propina-mesa-quitar"
          onClick={() => { setOtroAbierto(false); setOtroTexto(''); setPorConfirmar(null); onElegir(null); }}
        >
          {t('Quitar la propina')}
        </button>
      )}
      {guardando && (
        <p className="propina-mesa-estado" role="status">{t('Guardando la propina…')}</p>
      )}
      {estado.fase === 'agotada' && (
        <div className="propina-mesa-estado propina-mesa-estado--error" role="alert">
          <p>{t('No pudimos guardar la propina. Puedes elegir tus platos y volver a intentarlo desde la propina de la mesa.')}</p>
          <button type="button" className="btn btn-ghost btn-sm btn-fit" onClick={onReintentar}>
            {t('Reintentar')}
          </button>
        </div>
      )}
      {estado.fase === 'rechazada' && (
        <p className="propina-mesa-estado propina-mesa-estado--error" role="alert">{mensajeDeRechazo(estado, t)}</p>
      )}
    </section>
  );
}
