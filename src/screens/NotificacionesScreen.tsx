import { useCallback, useEffect, useState } from 'react';
import { useIdioma } from '../i18n/idioma';
import { api } from '../api';
import type {
  NotificationPreferenceGroup,
  NotificationPreferenceItem,
  NotificationPreferenceType,
  NotificationPreferencesResponse,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { fullName } from '../utils/identity';
import { AppBottomBar } from '../components/AppBottomBar';
import { AppHeaderBack } from '../components/AppHeader';
import { Icon, type IconName } from '../components/Icon';
import { useToast } from '../components/ui';
import { goBack } from '../router';

/**
 * AF2 · Configuración › Notificaciones (decisiones 33-37 de Mati; E1 del dueño,
 * `payme.app.notification-preferences/v1`). Sólo correo: sin WhatsApp ni SMS,
 * ni siquiera como «próximamente» (decisión 33).
 *
 * Guardado por fila e inmediato: un `PUT` con un ítem, estado optimista y vuelta
 * atrás si falla. Los títulos NO viajan en el contrato: se traducen acá por
 * `type`. Un tipo que el decodificador no conoce ya no llega hasta acá.
 */
const GRUPOS: readonly NotificationPreferenceGroup[] = ['seguridad', 'mesas', 'amigos', 'pagos'];

const ICONO: Readonly<Record<NotificationPreferenceType, IconName>> = {
  account_recovery: 'lock',
  account_deleted: 'trash',
  invitation_received: 'dining',
  mesa_expired: 'clock',
  friend_request_received: 'users',
  friend_added: 'users',
  mesa_paid_by_friend: 'check-circle',
  mesa_fully_paid: 'check-circle',
  payment_failed: 'x-circle',
  mesa_shortfall_charged: 'lock',
  mesa_garantia_impagos: 'warning',
  tip_received: 'store',
};

export function NotificacionesView({
  userName,
  email,
  estado,
  prefs,
  busyType,
  onToggle,
  onExplicarFijo,
  onReintentar,
}: {
  readonly userName: string | undefined;
  readonly email: string | null;
  readonly estado: 'cargando' | 'ok' | 'error';
  readonly prefs: NotificationPreferencesResponse | null;
  readonly busyType: NotificationPreferenceType | null;
  readonly onToggle: (item: NotificationPreferenceItem, email: boolean) => void;
  readonly onExplicarFijo: () => void;
  readonly onReintentar: () => void;
}) {
  const { t } = useIdioma();
  const tituloGrupo: Readonly<Record<NotificationPreferenceGroup, string>> = {
    seguridad: t('Seguridad'),
    mesas: t('Mesas'),
    amigos: t('Amigos'),
    pagos: t('Pagos'),
  };
  const titulo: Readonly<Record<NotificationPreferenceType, string>> = {
    account_recovery: t('Recuperación de cuenta'),
    account_deleted: t('Cuenta eliminada'),
    invitation_received: t('Te invitan a una mesa'),
    mesa_expired: t('Una mesa tuya se cierra'),
    friend_request_received: t('Solicitud de amistad'),
    friend_added: t('Amigo agregado'),
    mesa_paid_by_friend: t('Un amigo pagó en tu mesa'),
    mesa_fully_paid: t('Tu mesa quedó pagada'),
    payment_failed: t('Un pago falló'),
    mesa_shortfall_charged: t('Se cobró tu garantía'),
    mesa_garantia_impagos: t('Garantía por impagos'),
    tip_received: t('Recibiste una propina'),
  };
  const detalle: Readonly<Record<NotificationPreferenceType, string>> = {
    account_recovery: t('Cuando pides recuperar el acceso a tu cuenta.'),
    account_deleted: t('Cuando se completa la eliminación de tu cuenta.'),
    invitation_received: t('Cuando alguien te invita a una mesa.'),
    mesa_expired: t('Cuando una mesa que abriste se cierra.'),
    friend_request_received: t('Cuando alguien te manda una solicitud de amistad.'),
    friend_added: t('Cuando aceptan tu solicitud de amistad.'),
    mesa_paid_by_friend: t('Cuando un amigo paga su parte en tu mesa.'),
    mesa_fully_paid: t('Cuando tu mesa termina de pagarse.'),
    payment_failed: t('Cuando un pago tuyo no se pudo completar.'),
    mesa_shortfall_charged: t('Cuando tu garantía cubre lo que faltó.'),
    mesa_garantia_impagos: t('Cuando hay impagos cubiertos por la garantía.'),
    tip_received: t('Cuando recibes una propina.'),
  };
  return (
    <div className="screen has-appbar">
      <AppHeaderBack userName={userName} onBack={() => goBack('mas')} />
      <div className="title-card">
        <h1 className="title-card-title">{t('Notificaciones')}</h1>
      </div>
      <div className="scroll" style={{ paddingTop: 16, paddingLeft: 16, paddingRight: 16 }}>
        <p className="body-text" style={{ marginBottom: 12 }}>
          {email
            ? t('Elige qué avisos quieres recibir también por correo a {0}. Los avisos siempre aparecen en la campana de la app.', email)
            : t('Elige qué avisos quieres recibir también por correo. Los avisos siempre aparecen en la campana de la app.')}
        </p>
        {estado === 'cargando' && (
          <div className="loading" role="status">{t('Cargando…')}</div>
        )}
        {estado === 'error' && (
          <div className="note note-amber" role="alert">
            <div>{t('No pudimos leer tus preferencias de avisos.')}</div>
            <button type="button" className="btn btn-ghost btn-sm btn-fit" onClick={onReintentar}>
              {t('Reintentar')}
            </button>
          </div>
        )}
        {estado === 'ok' && prefs && GRUPOS.map((grupo) => {
          const filas = prefs.items.filter((item) => item.group === grupo);
          if (filas.length === 0) return null;
          return (
            <section key={grupo} className="card config-card" style={{ marginBottom: 12 }} aria-label={tituloGrupo[grupo]}>
              <div className="h2" style={{ padding: '12px 12px 4px' }}>{tituloGrupo[grupo]}</div>
              {filas.map((item) => {
                const apagada = item.email.mode === 'unavailable';
                return (
                  <div
                    key={item.type}
                    className={`list-row notif-row${apagada ? ' notif-row--apagada' : ''}`}
                    style={{ cursor: 'default' }}
                  >
                    <span><Icon name={ICONO[item.type]} size={16} /></span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 'var(--fs-legacy-sm)', fontWeight: 600 }}>{titulo[item.type]}</div>
                      <div className="caption">{detalle[item.type]}</div>
                    </div>
                    {item.email.mode === 'editable' && (
                      <label className="notif-switch-label">
                        <span className="caption">{t('Correo')}</span>
                        <input
                          type="checkbox"
                          role="switch"
                          className="notif-switch"
                          aria-label={t('Correo: {0}', titulo[item.type])}
                          checked={item.email.value}
                          disabled={busyType !== null}
                          onChange={(event) => onToggle(item, event.target.checked)}
                        />
                      </label>
                    )}
                    {item.email.mode === 'fixed_on' && (
                      <button type="button" className="notif-fijo" onClick={onExplicarFijo}>
                        {t('Siempre por correo')}
                      </button>
                    )}
                    {item.email.mode === 'unavailable' && (
                      <span className="caption">
                        {item.email.reason === 'payments_disabled'
                          ? t('Disponible cuando haya pagos')
                          : t('Disponible con el próximo Aviso')}
                      </span>
                    )}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
      <AppBottomBar active={null} />
    </div>
  );
}

export function NotificacionesScreen() {
  const { t } = useIdioma();
  const toast = useToast();
  const { session } = useAuth();
  const [estado, setEstado] = useState<'cargando' | 'ok' | 'error'>('cargando');
  const [prefs, setPrefs] = useState<NotificationPreferencesResponse | null>(null);
  const [busyType, setBusyType] = useState<NotificationPreferenceType | null>(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    if (!session) return;
    let alive = true;
    setEstado('cargando');
    api.getNotificationPreferences(session)
      .then((response) => { if (alive) { setPrefs(response); setEstado('ok'); } })
      .catch(() => { if (alive) setEstado('error'); });
    return () => { alive = false; };
  }, [session, intento]);

  const onToggle = useCallback(async (item: NotificationPreferenceItem, email: boolean) => {
    if (!session || !prefs || busyType !== null || item.email.mode !== 'editable') return;
    const anterior = prefs;
    // Optimista: la fila cambia ya; si el dueño no lo acepta, vuelve atrás.
    setPrefs({
      ...prefs,
      items: prefs.items.map((fila) => (
        fila.type === item.type && fila.email.mode === 'editable'
          ? { ...fila, email: { ...fila.email, value: email } }
          : fila
      )),
    });
    setBusyType(item.type);
    try {
      const saved = await api.putNotificationPreferences({ items: [{ type: item.type, email }] }, session);
      setPrefs(saved);
    } catch {
      setPrefs(anterior);
      toast(t('No se pudo guardar'));
    } finally {
      setBusyType(null);
    }
  }, [busyType, prefs, session, t, toast]);

  return (
    <NotificacionesView
      userName={fullName(session) ?? undefined}
      email={session?.user?.email ?? null}
      estado={estado}
      prefs={prefs}
      busyType={busyType}
      onToggle={(item, email) => { void onToggle(item, email); }}
      onExplicarFijo={() => toast(t('Es un aviso de seguridad o de dinero: no se puede apagar.'))}
      onReintentar={() => setIntento((n) => n + 1)}
    />
  );
}

