import type { ViajeEnLista } from '../../api/viajes';
import { Icon } from '../../components/Icon';
import { useIdioma } from '../../i18n/idioma';
import { navigate } from '../../router';
import { formatMXN } from '../../utils/format';
import { InsigniaDelViaje, useFotosDeViajes } from './InsigniaDelViaje';
import { textoDeMiBalance, type T } from './viajesView';
import './viajes.css';
import './inicio.css';

/**
 * D265 · D267 · cada viaje abierto, en Inicio, como una burbuja grande «como si fuera una mesa abierta». Mati: «que
 * aparezca en la pantalla principal como una burbuja grande que tenga la foto y el nombre del viaje» y «tiene que tener
 * tres cosas, la foto, el nombre y la posición de saldo (con el color dependiendo cuál sea la posición)».
 *
 * - La foto o la inicial, sobre el color del viaje: el color del viaje queda en el círculo y nada más.
 * - El balance propio, con el texto de la app («Te deben $X», «Debes $X», «Estás a mano») y los colores del balance
 *   del viaje (D245). Nunca «saldo».
 * - Esperando pagos: «Esperando pagos · faltan N», sin monto. En ese estado `mi_balance_cents` es el balance congelado
 *   al cerrar y no baja con las transferencias: «Debes $X» podría ser falso si ya pagaste.
 */
export type BalanceDeLaBurbuja =
  | { readonly tono: 'a-favor' | 'deuda' | 'cero'; readonly texto: string }
  | { readonly tono: 'esperando'; readonly texto: string };

export function balanceDeLaBurbuja(
  v: Pick<ViajeEnLista, 'estado' | 'mi_balance_cents' | 'transferencias_pendientes'>,
  t: T,
): BalanceDeLaBurbuja {
  if (v.estado === 'esperando_pagos') {
    return { tono: 'esperando', texto: t('Esperando pagos · faltan {0}', v.transferencias_pendientes ?? 0) };
  }
  const cents = v.mi_balance_cents ?? 0;
  return { tono: cents > 0 ? 'a-favor' : cents < 0 ? 'deuda' : 'cero', texto: textoDeMiBalance(cents, t, formatMXN) };
}

/** Las burbujas, con las fotos de los viajes que tienen. */
export function ViajesAbiertosEnInicio({ viajes, fallo, onReintentar }: {
  viajes: readonly ViajeEnLista[] | null;
  fallo: boolean;
  onReintentar: () => void;
}) {
  const { fotoDe } = useFotosDeViajes(viajes);
  return <ViajesAbiertosVista viajes={viajes} fallo={fallo} onReintentar={onReintentar} fotoDe={fotoDe} />;
}

/** La vista pura. Cargando o sin viajes abiertos: nada. Sin poder preguntar: el error con «Reintentar». */
export function ViajesAbiertosVista({ viajes, fallo, onReintentar, fotoDe = () => null }: {
  viajes: readonly ViajeEnLista[] | null;
  fallo: boolean;
  onReintentar: () => void;
  fotoDe?: (viajeId: string) => string | null;
}) {
  const { t } = useIdioma();
  if (fallo) {
    return (
      <section className="home-viajes" aria-label={t('Tus viajes abiertos')}>
        <div className="state-error">
          <div className="state-error-row">
            <Icon name="x-circle" size={22} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="state-error-title">{t('No pudimos cargar tus viajes')}</div>
              <p className="state-error-body">{t('Revisa la conexión y prueba de nuevo.')}</p>
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onReintentar}>
            {t('Reintentar')}
          </button>
        </div>
      </section>
    );
  }
  if (!viajes || viajes.length === 0) return null;
  return (
    <section className="home-viajes" aria-label={t('Tus viajes abiertos')}>
      <div className="home-mesas">
        {viajes.map((v) => {
          const balance = balanceDeLaBurbuja(v, t);
          return (
            <button key={v.id} type="button" className="mesa-card viaje-card" onClick={() => navigate('viaje', v.id)}>
              <div className="mesa-top">
                <span className="mesa-kicker">{t('Tu viaje abierto')}</span>
              </div>
              <div className="viaje-card-cabeza">
                <InsigniaDelViaje nombre={v.nombre} color={v.color} foto={v.has_photo ? fotoDe(v.id) : null} grande />
                <span className="mesa-name viaje-card-nombre">{v.nombre}</span>
              </div>
              <div className={`viaje-card-balance viaje-card-balance--${balance.tono}`}>{balance.texto}</div>
              <div className="mesa-foot">
                <span className="mesa-go viaje-card-ir">{t('Ver viaje →')}</span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
