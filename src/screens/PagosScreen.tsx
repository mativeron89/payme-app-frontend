import { useCallback, useEffect, useState } from 'react';
import { useIdioma } from '../i18n/idioma';
import { api } from '../api';
import type { HistoryEntry } from '../api/types';
import { useWalletRail } from '../api/walletRail';
import { accountRailView } from '../api/releaseGates';
import { useAuth } from '../auth/AuthContext';
import { AppBottomBar } from '../components/AppBottomBar';
import { AppHeaderBack } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { goBack } from '../router';
import { formatMXN } from '../utils/format';
import { agruparPorMes } from './pagosView';
import { fullName } from '../utils/identity';

/**
 * **Pagos** — la pantalla real que lanza el acceso "Ver pagos" de la pestaña
 * Cuenta (`SPEC_APP.md` §1.11). La pestaña lanza, no muestra: el listado
 * completo vive acá y no adentro de la burbuja de Inicio.
 *
 * Es historial de pagos PROPIO, `GET /account/history`, y es **card-only
 * ratificado que se conserva**: cuelga de `showAccountActivity`, no del gate
 * del riel saldo. Ése fue exactamente el defecto de `07f0ba2` —un solo flag
 * apagando las dos cosas— y por eso son dos campos separados que el backend
 * publica por separado. Ante capability ausente o rota, `walletRail.ts`
 * entrega `accountActivity: true`: esta superficie **no se esconde por un
 * fallo de red**.
 */

/** Tope del emisor: `historyQuery` valida `limit` entre 1 y 100. */
const PAGINA = 20;

export function PagosScreen() {
  const { t } = useIdioma();
  const { session } = useAuth();
  const { walletRailEnabled, accountActivity } = useWalletRail();
  const vista = accountRailView(walletRailEnabled, accountActivity);

  const [pagos, setPagos] = useState<HistoryEntry[] | null>(null);
  const [hayMas, setHayMas] = useState(false);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [fallo, setFallo] = useState(false);

  const traer = useCallback(async (offset: number) => {
    const r = await api.getHistory({ limit: PAGINA, offset });
    /**
     * El contrato no publica un total ni un `has_more`. La única señal honesta
     * de que quedan más es que la página vino LLENA — y por eso "Cargar más"
     * puede aparecer una vez de más y traer cero. Es preferible a inventar un
     * conteo: con una página corta sabemos que se terminó, con una llena no
     * sabemos nada, y el botón dice justamente eso.
     */
    setHayMas(r.history.length === PAGINA);
    return r.history;
  }, []);

  const primeraPagina = useCallback(() => {
    setFallo(false);
    setPagos(null);
    traer(0)
      .then(setPagos)
      .catch(() => setFallo(true));
  }, [traer]);

  useEffect(() => {
    if (!vista.showAccountActivity) return;
    primeraPagina();
  }, [vista.showAccountActivity, primeraPagina]);

  async function cargarMas() {
    if (cargandoMas || !pagos) return;
    setCargandoMas(true);
    try {
      const mas = await traer(pagos.length);
      setPagos((prev) => [...(prev ?? []), ...mas]);
    } catch {
      // Falla al paginar: NO se borra lo que ya se mostró. Que desaparezcan
      // pagos ya vistos porque la página siguiente no llegó es peor que el
      // error mismo.
      setFallo(true);
    } finally {
      setCargandoMas(false);
    }
  }

  const grupos = pagos ? agruparPorMes(pagos) : [];

  return (
    <div className="screen has-appbar">
      <AppHeaderBack userName={fullName(session) ?? undefined} onBack={() => goBack('home')} />
      <div className="title-card">
        <h1 className="title-card-title">{t('Mis pagos')}</h1>
      </div>

      <div className="scroll" style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 16 }}>
        {!vista.showAccountActivity ? (
          /* El backend declaró que esta superficie no está disponible. No es
             vacío: hay algo que no estás viendo, y por eso lleva borde. */
          <div className="state-unknown">
            <Icon name="info" size={20} />
            <div>
              <div className="state-unknown-title">{t('No podemos mostrar tus pagos ahora')}</div>
              <p className="state-unknown-body">{t('Prueba de nuevo más tarde.')}</p>
            </div>
          </div>
        ) : fallo && !pagos ? (
          <div className="state-error">
            <div className="state-error-row">
              <Icon name="x-circle" size={22} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="state-error-title">{t('No pudimos cargar tus pagos')}</div>
                <p className="state-error-body">{t('Revisa la conexión y prueba de nuevo.')}</p>
              </div>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={primeraPagina}>
              {t('Reintentar')}
            </button>
          </div>
        ) : pagos === null ? (
          <div aria-busy="true" aria-label={t('Cargando tus pagos')}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="pago-row sk">
                <span className="sk-line w55" />
                <span className="sk-line w40" />
              </div>
            ))}
          </div>
        ) : pagos.length === 0 ? (
          /* Vacío REAL: sin borde. Es el único estado del sistema que no lo
             lleva — si hay borde, hay algo que no estás viendo. */
          <div className="mesa-empty">
            <div className="mesa-empty-title">{t('Todavía no pagaste ninguna mesa.')}</div>
          </div>
        ) : (
          <>
            {grupos.map((g) => (
              <section key={g.key} aria-label={g.label}>
                {/* Pegajoso: con varios meses cargados, saber en cuál estás no
                    puede depender de acordarte de lo que scrolleaste. */}
                <h2 className="mes-sticky">{g.label}</h2>
                {g.entries.map((h) => (
                  <div key={h.id} className="pago-row">
                    <div className="pago-main">
                      <div className="pago-rest">{h.restaurant}</div>
                      <div className="pago-meta">
                        {t('Mesa')} {h.mesa_code} · {new Date(h.date).toLocaleDateString('es-MX', {
                          day: 'numeric',
                          month: 'short',
                        })}
                      </div>
                    </div>
                    <div className="pago-amt">{formatMXN(h.amount_cents)}</div>
                  </div>
                ))}
              </section>
            ))}

            {fallo && (
              <p className="pago-fallo" role="status">
                {t('No pudimos traer más pagos. Lo que ves sigue siendo correcto.')}
              </p>
            )}

            {hayMas && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ marginTop: 12 }}
                onClick={() => void cargarMas()}
                disabled={cargandoMas}
              >
                {cargandoMas ? t('Cargando…') : t('Cargar más')}
              </button>
            )}
          </>
        )}
      </div>

      {/* Ninguna de las cinco posiciones es "Pagos": marcar una sería mentir
          sobre dónde está la persona. */}
      <AppBottomBar active={null} />
    </div>
  );
}
