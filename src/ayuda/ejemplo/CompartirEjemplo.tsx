import { Icon } from '../../components/Icon';
import { ejemploLocal } from './estadoEjemplo';
import { AMIGOS_DE_EJEMPLO } from './fixtureEjemplo';

type T = (s: string, ...args: unknown[]) => string;

/** D429 · mismo aspecto que las acciones reales, sólo callbacks del ejemplo, nunca links. */
export function AccionesDeCompartirEjemplo({ t }: { t: T }) {
  return (
    <div className="share-actions">
      <button type="button" className="btn btn-ghost share-copy" data-guia="ejemplo-copiar"
        onClick={() => ejemploLocal.explicarCompartir('copiar')}>
        <Icon name="copy" size={18} className="ico-inline" /> {t('Copiar link')}
      </button>
      <button type="button" className="btn share-wa" data-guia="ejemplo-whatsapp"
        onClick={() => ejemploLocal.explicarCompartir('whatsapp')}>
        <Icon name="message" size={18} className="ico-inline" /> {t('WhatsApp')}
      </button>
    </div>
  );
}

/** No monta InviteFriends ni FriendAvatar: ninguna lectura de contactos, grupos o fotos. */
export function AmigosDeEjemplo({ t }: { t: T }) {
  return (
    <section className="inv-panel" aria-label={t('Amigos de ejemplo')}>
      <div className="inv-list">
        <div className="inv-row"><Icon name="users" size={20} /><strong>{t('Amigos de ejemplo')}</strong></div>
        {AMIGOS_DE_EJEMPLO.map((amigo) => (
          <div key={amigo.id} className="inv-row">
            <span className="avatar avatar-marca" aria-hidden="true">{amigo.iniciales}</span>
            <div className="fr-name"><div className="n">{amigo.nombre}</div></div>
            <button type="button" className="btn btn-sm btn-fit btn-outline" data-guia={`ejemplo-${amigo.id}`}
              aria-label={t('Invitar a {0}', amigo.nombre)}
              onClick={() => ejemploLocal.explicarCompartir(amigo.id)}>
              {t('Invitar')}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
