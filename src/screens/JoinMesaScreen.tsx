import { useEffect, useState, useSyncExternalStore } from 'react';
import { useIdioma } from '../i18n/idioma';
import { api } from '../api';
import { extractApiError } from '../api/errors';
import { signupInvitationSnapshot, subscribeSignupInvitation } from '../api/signupInvitation';
import { useAuth } from '../auth/AuthContext';
import { AppHeader } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { navigate } from '../router';
import {
  closeInvitationCustody,
  openInvitationCustody,
  settleInvitationFailure,
} from './invitationCustody';
import { LoginScreen } from './LoginScreen';
import { joinLinkMessage, joinLinkStage, type JoinLinkOutcome } from './joinLinkView';

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
/**
 * ORDEN 5 · la salida de §1.2-C, que estaba MUERTA.
 *
 * ## El defecto, encontrado por el recorrido de pago en navegador
 *
 * Al cerrar el canje, la custodia retira el token del hash. La URL queda en
 * `#/mesa/PA-XXXX` — que es **exactamente el destino de este botón**, porque el
 * link de invitación ES la ruta de la mesa. `navigate` asigna ese mismo hash, y
 * **asignar el hash que ya está no dispara `hashchange`**: el router no se
 * entera, `Shell` no vuelve a renderizar, y esta pantalla se queda montada con
 * `stage === 'joined'`.
 *
 * No es un caso raro: es el camino normal de cualquiera que llega por WhatsApp.
 * Y §1.2-C no muestra la barra inferior, así que ese círculo es el ÚNICO control
 * de la pantalla. Con él muerto, la única salida era el botón Atrás del
 * navegador o recargar.
 *
 * ## Por qué el remedio es avisarle al router, y no tocar el router
 *
 * `navigate` se conserva porque el destino **no siempre** coincide con la URL
 * actual: `accept-link` devuelve `mesa_code` y el emisor es la autoridad sobre
 * a qué mesa entraste, no el `:code` del link. Si difieren, hay que navegar de
 * verdad.
 *
 * Cuando no difieren, hace falta decirle al router que relea la URL. Es el mismo
 * remedio que `replaceRoute` ya aplica en `router.ts` con el mismo comentario
 * —*"`replaceState` no dispara `hashchange`: hay que avisarle al router"*—, así
 * que no se inventa un mecanismo: se reusa el que la app ya usa.
 *
 * Se avisa **sólo si el hash no cambió**. Si cambió, el navegador dispara su
 * propio `hashchange` y avisar de nuevo sería un re-render de más.
 *
 * Deliberadamente NO se toca `navigate`: tiene esta misma limitación para
 * cualquier navegación a la ruta en la que ya estás, pero cambiarla afecta a
 * todas las pantallas de la app y eso es otra orden.
 */
function salirAMisItems(mesaCode: string): void {
  const antes = window.location.hash;
  navigate('mesa', mesaCode);
  if (window.location.hash === antes) {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
}

export function JoinMesaScreen({ code, token }: { code: string; token: string }) {
  const { t } = useIdioma();
  const { session } = useAuth();
  const [outcome, setOutcome] = useState<JoinLinkOutcome>('joining');
  /**
   * El alta no se abre sola: §1.2-A es una pantalla propia con DOS acciones, y
   * recién al tocar una se muestra el formulario en el modo que corresponde.
   * `null` = todavía se está viendo el 401.
   */
  const [authMode, setAuthMode] = useState<'register' | 'login' | null>(null);
  /**
   * Canje cerrado. Es lo ÚNICO que habilita §1.2-C, y con él el permiso de
   * nombrar el restaurante: a esta altura ya hay sesión y quien mira es un
   * participante inscripto de la mesa.
   */
  const [joined, setJoined] = useState<string | null>(null);
  /** Nombre del restaurante, si el detalle llegó. Ver el efecto de abajo. */
  const [restaurant, setRestaurant] = useState<string | null>(null);
  /**
   * El reintento va en las DEPENDENCIAS del efecto, no en un `setOutcome`
   * suelto. Volver el estado a 'joining' sin cambiar una dep repinta el cartel
   * y **no vuelve a llamar a nadie** — el botón mentiría. Es el mismo defecto
   * que el barrido adversarial acaba de cazar en `HomeScreen`.
   */
  const [attempt, setAttempt] = useState(0);
  // La invitación de mesa no autoriza el alta. El botón de crear cuenta sólo
  // existe si esta misma navegación trae/custodia además una autoridad D-FF-1.
  const signup = useSyncExternalStore(
    subscribeSignupInvitation,
    signupInvitationSnapshot,
    signupInvitationSnapshot,
  );
  const signupAvailable = signup.status === 'available';

  /**
   * ⭐ LA SECUENCIA DE CUSTODIA, Y EL ORDEN NO ES NEGOCIABLE.
   *
   *   1. guardar;
   *   2. comprobar el ROUND-TRIP (leer de vuelta y comparar);
   *   3. **sólo entonces** retirar el token de la URL.
   *
   * Invertir 2 y 3 es pérdida silenciosa del token: `setItem` puede no tirar y
   * aun así no persistir —cuota, modo privado, un WebView con storage
   * particionado—, y si la URL ya se limpió no queda ninguna custodia. La
   * persona se registra y **queda afuera de la mesa a la que la invitaron**,
   * que es peor que el defecto que este cierre vino a corregir.
   *
   * **Si el round-trip falla, la URL NO se toca.** El token sigue expuesto en el
   * hash, que es exactamente donde estaba: no se empeora nada y el alta sigue
   * funcionando. Preferir un token visible a un token perdido es una decisión, y
   * queda escrita acá para que nadie la "corrija" limpiando siempre.
   *
   * Retirarlo usa `replaceState`, no `navigate`: asignar el hash CREA una
   * entrada de historial y deja viva la anterior con el `?t=`, así que el botón
   * Atrás la recupera y la app vuelve a custodiar un token ya soltado.
   * **Back no debe revivir el token.**
   *
   * ORDEN 4B · la secuencia vive en `invitationCustody.ts`. Un `useEffect` no
   * es ejercitable sin librería de render, y el defecto que 4B cierra no estaba
   * en los helpers sino en QUIÉN los llama y CUÁNDO. Movida allá, esa parte es
   * código con tests; acá quedan las tres llamadas, y que sigan siendo esas
   * tres lo fija un guardarraíl de fuente.
   */
  useEffect(() => {
    openInvitationCustody(code, token);
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
        // tiene que seguir disponible para el reintento. Suelta las DOS
        // custodias —storage y URL—: si el round-trip había fallado, el token
        // sigue en el hash y éste es el momento en que ya no hace falta.
        closeInvitationCustody();
        /**
         * Antes acá se navegaba derecho a la mesa. Ahora se muestra §1.2-C, y
         * el destino es el mismo —Mis ítems— a un toque del círculo naranja.
         *
         * El orden con la custodia NO cambió: la credencial se suelta acá,
         * apenas el canje cierra, exactamente como antes. Lo único que cambió
         * es que la navegación la dispara la persona.
         */
        setJoined(r.mesa_code);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        const { status } = extractApiError(err);
        /**
         * Custodia POR RESULTADO, en `invitationCustody.ts`. Los terminales
         * sueltan la credencial de las DOS custodias —storage **y URL**—; los
         * reintentables la conservan en ambas. Confundirlos rompe en las dos
         * direcciones: soltar un token vivo deja a la persona sin poder
         * reintentar, y conservar uno muerto deja esa mesa capturada por un
         * link inválido en cada visita.
         *
         * ORDEN 4B · acá estaba el defecto: soltar era **sólo** limpiar el
         * storage. Con el round-trip fallado el token nunca estuvo en storage y
         * seguía en el `?t=` del hash, así que un 403 dejaba viva en la barra de
         * direcciones y en el historial una credencial que el emisor ya había
         * declarado inservible. La decisión y su ejecución ahora son la misma
         * función y no pueden divergir.
         */
        setOutcome(settleInvitationFailure(status));
      });
    return () => {
      alive = false;
    };
  }, [session, token, attempt]);

  /**
   * El nombre del restaurante para §1.2-C, y **sólo** después del canje.
   *
   * `accept-link` devuelve `{ joined, mesa_code }` y nada más, así que el
   * nombre sale de `GET /mesas/:code` — que ahora exige sesión y que a esta
   * altura contesta porque la persona quedó inscripta. No es un "preview
   * público" por la puerta de atrás: sin canje este efecto no corre.
   *
   * Si falla, la pantalla se muestra **sin** el nombre. No se inventa un
   * placeholder ni se bloquea el paso: el canje ya cerró y la salida a Mis
   * ítems tiene que existir igual.
   */
  useEffect(() => {
    if (!joined) return;
    let alive = true;
    api
      .getMesa(joined)
      .then((r) => {
        if (alive) setRestaurant(r.mesa.restaurant.name);
      })
      .catch(() => {
        /* Sin nombre se muestra igual. Ver el comentario de arriba. */
      });
    return () => {
      alive = false;
    };
  }, [joined]);

  const stage = joinLinkStage({
    hasSession: Boolean(session),
    hasJoined: joined !== null,
    outcome,
  });

  /** §1.2-C · canje exitoso. Un solo destino: Mis ítems. */
  if (stage === 'joined' && joined) {
    return (
      <div className="link-screen">
        <AppHeader compact />
        <div className="link-mid">
          <div className="link-check" aria-hidden="true">
            <Icon name="check" size={38} />
          </div>
          <div>
            <div className="link-ok-title">{t('¡Te sumaste a la mesa!')}</div>
            {/* Sin el código de mesa: no aporta nada en el momento de celebrar. */}
            {restaurant && <div className="link-ok-sub">{restaurant}</div>}
          </div>
        </div>
        <div className="link-foot">
          <button
            type="button"
            className="link-round"
            onClick={() => salirAMisItems(joined)}
            aria-label={t('Ver mis ítems')}
          >
            <Icon name="arrow-right" size={24} />
          </button>
        </div>
      </div>
    );
  }

  /**
   * §1.2-A · 401. Sin sesión no se ve la mesa: se ve esto, con el token ya
   * guardado. La burbuja es GENÉRICA a propósito —"Te invitaron a una mesa"—
   * y no nombra el restaurante: para saber que el token es válido habría que
   * preguntarle al backend, y el endpoint que lo diría sin sesión es el
   * preview público que el cierre del pago sin cuenta prohíbe. Además, un link
   * reenviado le confirmaría a cualquiera dónde está comiendo otra persona.
   */
  if (stage === 'signup') {
    if (authMode) {
      return (
        <div className="screen">
          <div className="join-banner">
            <Icon name="sushi" size={22} />
            <div>
              <div className="join-banner-title">{t('Te invitaron a una mesa')}</div>
              <div className="caption">
                {authMode === 'register'
                  ? t('Crea tu cuenta o entra para sumarte y pagar tu parte.')
                  : t('Para ver la mesa y pagar tu parte, necesitas una cuenta de PayMe')}
              </div>
            </div>
          </div>
          <LoginScreen initialMode={authMode} />
        </div>
      );
    }
    return (
      <div className="link-screen">
        <AppHeader compact />
        <div className="link-mid">
          <div className="link-bubble">
            <div className="link-bubble-title">{t('Te invitaron a una mesa')}</div>
          </div>
        </div>
        <div className="link-foot">
          <p className="link-foot-copy">
            {t('Para ver la mesa y pagar tu parte, necesitas una cuenta de PayMe')}
          </p>
          {/* Único elemento naranja de la pantalla, con el texto en navy. */}
          {signupAvailable && (
            <button
              type="button"
              className="link-btn link-btn-brand"
              onClick={() => setAuthMode('register')}
            >
              {t('Crear cuenta gratis')}
            </button>
          )}
          <button
            type="button"
            className="link-btn link-btn-outline"
            onClick={() => setAuthMode('login')}
          >
            {t('Ya tengo cuenta · Entrar')}
          </button>
        </div>
      </div>
    );
  }

  const message = joinLinkMessage(outcome);
  return (
    <div className="link-screen">
      <AppHeader compact />
      <div className="link-mid">
        <div className="link-bubble">
          <div className="link-bubble-title">{message.title}</div>
          <div className="link-bubble-body">{message.body}</div>
        </div>
        {/* Pantalla D · la línea que cierra el círculo ANTES de soltar al
            recién registrado a un Inicio vacío: la explicación vive acá, que
            es la pantalla que sabe qué pasó — Inicio no adivina. */}
        {message.nota && <p className="link-nota">{message.nota}</p>}
      </div>
      <div className="link-foot">
        {stage === 'retry' && (
          <button
            type="button"
            className="link-btn link-btn-outline"
            onClick={() => setAttempt((n) => n + 1)}
          >
            {t('Reintentar')}
          </button>
        )}
        {/**
         * §1.2-B · la salida del terminal es el círculo, no un botón de texto.
         * El spec la manda a login si no hay sesión y a Inicio si la hay; acá
         * sólo se llega con sesión —sin ella la rama de arriba muestra el 401—,
         * así que el destino es Inicio.
         */}
        {stage === 'blocked' && (
          <button
            type="button"
            className="link-round"
            onClick={() => navigate('home')}
            aria-label={t('Ir a PayMe')}
          >
            <Icon name="arrow-right" size={24} />
          </button>
        )}
      </div>
    </div>
  );
}
