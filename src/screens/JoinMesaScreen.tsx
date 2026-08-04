import { useEffect, useState } from 'react';
import { api } from '../api';
import { extractApiError } from '../api/errors';
import { clearPendingInvitationLink, rememberInvitationLink } from '../api/invitationLink';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icon';
import { navigate } from '../router';
import { LoginScreen } from './LoginScreen';
import { joinLinkMessage, type JoinLinkOutcome } from './joinLinkView';

/**
 * CIERRE DEL PAGO SIN CUENTA · la pantalla que reemplaza a "ver la mesa con el
 * token en la URL".
 *
 * ## El circuito ratificado
 *
 * 1. llega un link por WhatsApp;
 * 2. quien lo abre **no tiene cuenta → no ve la mesa** (antes la veía: ése era
 *    el defecto);
 * 3. se registra, **y el token sobrevive al alta**;
 * 4. con sesión, el front **canjea** el token contra `accept-link`;
 * 5. queda inscripto y ahí sí ve la mesa, toma ítems y paga.
 *
 * ## Lo que hace esta pantalla, y lo que deliberadamente NO hace
 *
 * No pinta **nada** de la mesa antes del canje: ni restaurante, ni total, ni
 * cuánta gente hay. No es prolijidad — `GET /mesas/:code` ahora exige sesión y
 * contesta 401, así que no hay de dónde sacarlo, y **está bien que no lo haya**:
 * mostrarle el nombre del restaurante a cualquiera que tenga un link es
 * justamente lo que el cierre saca de la mesa.
 *
 * Tampoco distingue por qué falló un link. El emisor contesta el MISMO 403 para
 * inválido, vencido, cancelado y supersedido, **a propósito**: separarlos le
 * diría a un desconocido si una mesa existe. Inventar copy que los separe acá
 * reabriría el oráculo del lado del consumidor, que es exactamente cómo la
 * pantalla "Enviadas" reabrió el que el 202 ciego había cerrado.
 */
export function JoinMesaScreen({ code, token }: { code: string; token: string }) {
  const { session } = useAuth();
  const [outcome, setOutcome] = useState<JoinLinkOutcome>('joining');
  /**
   * El reintento va en las DEPENDENCIAS del efecto, no en un `setOutcome`
   * suelto. Volver el estado a 'joining' sin cambiar una dep repinta el cartel
   * y **no vuelve a llamar a nadie** — el botón mentiría. Es el mismo defecto
   * que el barrido adversarial acaba de cazar en `HomeScreen`.
   */
  const [attempt, setAttempt] = useState(0);

  // El token se guarda ANTES de cualquier otra cosa y sin depender de que haya
  // sesión: éste es el tramo del alta, donde perderlo deja a la persona
  // registrada y afuera de la mesa a la que la invitaron.
  useEffect(() => {
    rememberInvitationLink(code, token);
  }, [code, token]);

  useEffect(() => {
    if (!session) return;
    let alive = true;
    setOutcome('joining');
    api
      .acceptInvitationLink(token)
      .then((r) => {
        if (!alive) return;
        // Recién acá se suelta la credencial: si el canje no cerró, el token
        // tiene que seguir disponible para el reintento.
        clearPendingInvitationLink();
        // Sin `?t=`: el token ya no es autorización y no tiene por qué quedar
        // en la URL, el historial del navegador ni un screenshot.
        navigate('mesa', r.mesa_code);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        const { status } = extractApiError(err);
        // Un 403 es definitivo: el token está muerto y hay que SOLTARLO. Si el
        // respaldo sobreviviera, `tokenForMesa` lo seguiría devolviendo y esta
        // mesa quedaría capturada por un link muerto en cada visita.
        // Un 503 o un fallo de red NO dicen eso, así que ahí se conserva.
        if (status === 403) clearPendingInvitationLink();
        // 503 NO es "tu link no sirve": es "no pudimos verificarlo ahora".
        // Tratarlo como 403 le diría a alguien que su invitación está muerta
        // cuando lo único que pasó es que al emisor le falta un secreto.
        setOutcome(status === 503 ? 'unavailable' : status === 403 ? 'rejected' : 'error');
      });
    return () => {
      alive = false;
    };
  }, [session, token, attempt]);

  // Sin sesión no se ve la mesa. Se ve el alta — con el token ya guardado.
  if (!session) {
    return (
      <div className="screen">
        <div className="join-banner">
          <Icon name="sushi" size={22} />
          <div>
            <div className="join-banner-title">Te invitaron a una mesa</div>
            <div className="caption">
              Creá tu cuenta o entrá para sumarte y pagar tu parte.
            </div>
          </div>
        </div>
        <LoginScreen />
      </div>
    );
  }

  const message = joinLinkMessage(outcome);
  return (
    <div className="screen">
      <div className="empty" style={{ padding: '48px 24px' }}>
        <div className="emoji">
          <Icon name={outcome === 'joining' ? 'sushi' : 'warning'} size={40} />
        </div>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{message.title}</div>
        <div className="caption">{message.body}</div>
        {message.retryable && (
          <button
            className="btn btn-primary"
            style={{ marginTop: 18 }}
            onClick={() => setAttempt((n) => n + 1)}
          >
            Reintentar
          </button>
        )}
        {!message.retryable && outcome !== 'joining' && (
          <button className="btn" style={{ marginTop: 18 }} onClick={() => navigate('home')}>
            Ir a inicio
          </button>
        )}
      </div>
    </div>
  );
}
