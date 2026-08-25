import { useCallback, useEffect, useState } from 'react';
import { useIdioma } from '../i18n/idioma';
import { api } from '../api';
import type { HistoryEntry } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { goBack, navigate } from '../router';
import { formatMXN } from '../utils/format';
import { fullName } from '../utils/identity';
import { AppBottomBar } from '../components/AppBottomBar';
import { AppHeaderBack } from '../components/AppHeader';
import { Icon, type IconName } from '../components/Icon';
import {
  agruparPorMes,
  FRANJA_LABEL,
  franjaDe,
  mesasCerradas,
  traerHistorialCompleto,
  type Franja,
} from './historialView';

const CATEGORY_EMOJI: Record<string, IconName> = {
  italian: 'pasta',
  japanese: 'sushi',
  mexican: 'taco',
  cafe: 'coffee',
  other: 'dining',
};

/** El ícono ACOMPAÑA a la palabra, nunca la reemplaza (§1.10). */
const FRANJA_ICON: Record<Franja, IconName> = {
  manana: 'sun-rise',
  mediodia: 'sun-high',
  tarde: 'sun-low',
  noche: 'moon',
};

function fechaDeFila(iso: string, locale: string, t: (s: string, ...a: unknown[]) => string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffDays = Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60_000));
  if (diffDays === 0) return t('Hoy');
  if (diffDays === 1) return t('Ayer');
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

/**
 * **Mesas ES el historial** — `SPEC_APP.md` §1.10, definido por Mati: *"una
 * forma más rápida de ir al histórico de mesas"*. Como nunca hay más de una
 * mesa abierta y ya se ve en Inicio, esta entrada de la barra lista las
 * CERRADAS; el título de la pantalla dice **Historial** aunque la etiqueta de
 * la barra diga "Mesas" por espacio.
 *
 * La mesa abierta NO se repite acá. Antes de `mesa_status` (v2.42.0) esta
 * pantalla no podía cumplirlo: el organizador que pagaba su parte veía su mesa
 * viva bajo un encabezado de mes, como si hubiera terminado. Y la sección
 * "Abiertas ahora" que vivía arriba se retiró con G-28 cerrado: el invitado ya
 * ve su mesa en Inicio, donde corresponde, no acá.
 *
 * El acordeón de detalle NO muestra ítems: G-33 sigue abierta —el contrato no
 * tiene un detalle de mesa cerrada, y el que hoy funciona lo hace por
 * coincidencia—, así que despliega el estado DESCONOCIDO de
 * `SISTEMA_DISENO.md` §5. Nunca un mock que aparente funcionar.
 */
export function MesasScreen() {
  const { t, locale } = useIdioma();
  const { session } = useAuth();
  const [pagos, setPagos] = useState<HistoryEntry[] | null>(null);
  const [fallo, setFallo] = useState(false);
  const [unread, setUnread] = useState(0);
  const [abierta, setAbierta] = useState<string | null>(null);

  /**
   * TODO el historial antes de agrupar, sin "Cargar más": una página parcial
   * dejaría a una mesa partida en el borde con su total SUBCONTADO en
   * pantalla. O está todo, o es el estado de error — la falla a mitad de
   * carga propaga a propósito (ver `traerHistorialCompleto`).
   */
  const cargarHistorial = useCallback(() => {
    setFallo(false);
    setPagos(null);
    traerHistorialCompleto((limit, offset) =>
      api.getHistory({ limit, offset }).then((r) => r.history),
    )
      .then(setPagos)
      .catch(() => setFallo(true));
  }, []);

  useEffect(() => {
    cargarHistorial();
  }, [cargarHistorial]);

  useEffect(() => {
    let alive = true;
    api.getUnreadCount().then((r) => alive && setUnread(r.unread_count)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const cerradas = pagos ? mesasCerradas(pagos) : null;
  const grupos = cerradas ? agruparPorMes(cerradas, locale) : [];

  return (
    <div className="screen has-appbar">
      <AppHeaderBack
        userName={fullName(session) ?? undefined}
        onBack={() => goBack('home')}
        unread={unread}
        onBell={() => navigate('avisos')}
      />
      <div className="title-card">
        <h1 className="title-card-title">{t('Historial')}</h1>
      </div>

      <div className="scroll" style={{ paddingLeft: 16, paddingRight: 16 }}>

        {fallo && !pagos ? (
          <div className="state-error">
            <div className="state-error-row">
              <Icon name="x-circle" size={22} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="state-error-title">{t('No pudimos cargar tu historial')}</div>
                <p className="state-error-body">{t('Revisa la conexión y prueba de nuevo.')}</p>
              </div>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={cargarHistorial}>
              {t('Reintentar')}
            </button>
          </div>
        ) : cerradas === null ? (
          <div aria-busy="true" aria-label={t('Cargando tu historial')}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="pago-row sk">
                <span className="sk-line w55" />
                <span className="sk-line w40" />
              </div>
            ))}
          </div>
        ) : cerradas.length === 0 ? (
          /* Vacío REAL: sin borde, único estado del sistema que no lo lleva. */
          <div className="mesa-empty">
            <div className="mesa-empty-title">{t('Todavía no cerraste ninguna mesa.')}</div>
          </div>
        ) : (
          <>
            {grupos.map((g) => (
              <section key={g.key} aria-label={g.label}>
                <h2 className="mes-sticky">{g.label}</h2>
                {g.mesas.map((m) => {
                  const franja = franjaDe(m.date);
                  const on = abierta === m.mesa_code;
                  return (
                    <div key={m.mesa_code} className={`hist-item ${on ? 'on' : ''}`}>
                      <button
                        type="button"
                        className="hist-row"
                        aria-expanded={on}
                        onClick={() => setAbierta(on ? null : m.mesa_code)}
                      >
                        <span aria-hidden="true">
                          <Icon name={CATEGORY_EMOJI[m.category] ?? 'dining'} size={22} />
                        </span>
                        <div className="hist-main">
                          <div className="hist-rest">{m.restaurant}</div>
                          <div className="hist-meta">
                            {fechaDeFila(m.date, locale, t)}
                            {franja && (
                              <>
                                {' · '}
                                {t(FRANJA_LABEL[franja])}{' '}
                                <Icon
                                  name={FRANJA_ICON[franja]}
                                  size={14}
                                  className="ico-inline"
                                />
                              </>
                            )}
                          </div>
                        </div>
                        <div className="hist-amt">{formatMXN(m.amount_cents)}</div>
                        <span className={`hist-chevron ${on ? 'on' : ''}`} aria-hidden="true">
                          <Icon name="chevron-down" size={20} />
                        </span>
                      </button>
                      {on && (
                        /* G-33: el detalle de consumo no tiene contrato
                           confirmado. Estado desconocido, con borde punteado —
                           si hay borde, hay algo que no estás viendo. */
                        <div className="state-unknown hist-unknown">
                          <Icon name="help" size={20} />
                          <div>
                            <div className="state-unknown-title">
                              {t('El detalle de esta mesa todavía no está disponible')}
                            </div>
                            <p className="state-unknown-body">
                              {t('No podemos confirmar que sea seguro de mostrar. Lo que pagaste tú es el monto de esta fila.')}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>
            ))}

          </>
        )}

      </div>

      <AppBottomBar active="mesas" />
    </div>
  );
}
