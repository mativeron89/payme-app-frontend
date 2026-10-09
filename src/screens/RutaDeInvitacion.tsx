import { useEffect } from 'react';
import { guardarCodigoDeInvitacion } from '../api/linkDeInvitacion';
import { useSocialAuthCapability } from '../api/socialAuth';
import { useIdioma } from '../i18n/idioma';
import { replaceRoute } from '../router';
import { LoginScreen } from './LoginScreen';

/**
 * AF-LINK-DE-INVITACION · D252 · `/invitacion/<código>`.
 *
 * - **Sin sesión:** el código queda guardado en la pestaña
 *   (`guardarCodigoDeInvitacion`, sessionStorage: sobrevive a la ida y vuelta
 *   a Google) y se abre el alta, para mandarlo al crear la cuenta. Sin la
 *   capacidad es el alta de siempre: el código no se manda.
 * - **Con sesión:** no cambia nada; lleva a Amigos. Una cuenta existente nunca
 *   usa un link de invitación (D252).
 */
export function InvitacionSinSesion({ codigo }: { codigo: string | null }) {
  const { t } = useIdioma();
  const social = useSocialAuthCapability();
  useEffect(() => {
    if (codigo) guardarCodigoDeInvitacion(codigo);
  }, [codigo]);
  // El ingreso calcula su modo una sola vez: se espera a saber si el alta está
  // abierta, así quien llega por el link ve «Crear cuenta» y no el login. Con el
  // alta cerrada, el ingreso de siempre.
  if (social.status === 'pending') return <div className="screen"><div className="loading">{t('Cargando…')}</div></div>;
  return <LoginScreen initialMode="register" recargaPorVersion />;
}

export function InvitacionConSesion() {
  useEffect(() => {
    replaceRoute('amigos');
  }, []);
  return null;
}
