import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useIdioma } from '../i18n/idioma';
import { api } from '../api';
import { extractApiError } from '../api/errors';
import { LEGAL_ACCEPTANCE_REQUIRED, USERNAME_REQUIRED } from '../api/http';
import {
  modoRecordadoParaMesa,
  recordarModoDeMesa,
  recordarRetornoAMesa,
  type ModoDeIngreso,
} from '../api/retornoTrasIngreso';
import { signupInvitationSnapshot, subscribeSignupInvitation } from '../api/signupInvitation';
import { ensureSocialAuthCapability, useSocialAuthCapability } from '../api/socialAuth';
import { autoridadDeAlta } from './LoginScreen';
import { useAuth } from '../auth/AuthContext';
import { AppHeader } from '../components/AppHeader';
import { BarraDeLink } from '../components/BarraDeLink';
import { TarjetaDeLink } from '../components/TarjetaDeLink';
import { EVENTO_RUTA, navigate, ubicacionActual } from '../router';
import {
  closeInvitationCustody,
  openInvitationCustody,
  settleInvitationFailure,
} from './invitationCustody';
import { LoginScreen } from './LoginScreen';
import {
  entrarEnNaranja,
  formularioDeB,
  iconoDelResultado,
  joinLinkMessage,
  joinLinkStage,
  type JoinLinkOutcome,
} from './joinLinkView';

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
  // n130 · se compara la URL entera (path, query y fragmento), no sólo el hash.
  const antes = ubicacionActual();
  navigate('mesa', mesaCode);
  if (ubicacionActual() === antes) {
    window.dispatchEvent(new Event(EVENTO_RUTA));
  }
}

/**
 * AF-PUERTA-JOIN · `puertaLista`: la consulta de la puerta legal de ESTA sesión
 * ya volvió abierta. Sin eso no se canjea: canjear antes une a la persona a la
 * mesa sin haber aceptado. Mientras tanto la pantalla sigue en «uniéndote», que
 * es lo que ya mostraba.
 *
 * `onRequiereAceptacion`: el dueño contestó 428 `legal_acceptance_required` al
 * canje (AB2). Se le pide a la puerta que vuelva a consultar, y la custodia del
 * token NO se liquida: la puerta reemplaza a esta pantalla y, al aceptar, ésta
 * se monta de nuevo y canjea con el mismo token.
 */
export function JoinMesaScreen({
  code,
  token,
  puertaLista = true,
  onRequiereAceptacion,
  onRequiereArroba,
  onIngreso,
}: {
  code: string;
  token: string;
  puertaLista?: boolean;
  onRequiereAceptacion?: () => void;
  /**
   * AF-USUARIO-ARROBA · el dueño contestó 428 `username_required` al canje:
   * mismo trato que el legal. Se conserva el token y la pantalla del @
   * reemplaza a ésta; al elegirlo, se canjea con el mismo token. Apagado, el
   * dueño no lo emite.
   */
  onRequiereArroba?: () => void;
  /** P-3 · señal de presentación, después de cerrar la custodia y antes de salir. */
  onIngreso?: (mesaCode: string) => void;
}) {
  const { t } = useIdioma();
  const { session } = useAuth();
  const [outcome, setOutcome] = useState<JoinLinkOutcome>('joining');
  /**
   * Hubo un 428 y la puerta todavía no se cerró. Si la reconsulta vuelve
   * ABIERTA (el dueño se contradice), no se canjea solo de nuevo: eso sería un
   * 428 → reconsulta → canje en bucle. Se muestra el error con «Reintentar» y
   * reintentar queda en manos de la persona. Es un `ref` y no estado: se marca
   * aunque el efecto que lo originó ya se haya desmontado.
   */
  const esperandoPuerta = useRef(false);
  /**
   * El alta no se abre sola: §1.2-A es una pantalla propia con DOS acciones, y
   * recién al tocar una se muestra el formulario en el modo que corresponde.
   * `null` = todavía se está viendo el 401.
   *
   * P02-a · sin sesión, arranca en el modo que se eligió para ESTA mesa, si se
   * recuerda: una recarga (o la pestaña que el navegador descarta al volver de
   * Google) ya no devuelve a A ni obliga a repetir el toque.
   */
  const [authMode, setAuthMode] = useState<ModoDeIngreso | null>(() => (session ? null : modoRecordadoParaMesa(code)));
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
  const social = useSocialAuthCapability();
  /**
   * 🔴 C2b · esta pantalla gateaba «Crear cuenta gratis» con la invitación de
   * ALTA, y ése es un objeto distinto del `?t=` que trajo a la persona hasta
   * acá: el token de la mesa no crea autoridad de alta. Con el alta pública
   * abierta y sin invitación, el botón desaparecía y quien llegó por WhatsApp
   * quedaba sin forma de registrarse **aunque el dueño hubiera abierto la
   * puerta** — el 401 le dice «necesitás cuenta» y la pantalla no le ofrecía
   * crearla. Ahora lee la misma autoridad que el formulario.
   */
  const signupAvailable = autoridadDeAlta(signup, social.publicRegistration) !== null;
  /**
   * D373 · P02-a · si ya se intentó leer la capability del alta. `ensure`
   * resuelve con éxito o con falla (nunca deja nada esperando): con la lectura
   * pendiente «Entrar» va con borde, para no mostrar dos naranjas seguidos.
   */
  const [capacidadIntentada, setCapacidadIntentada] = useState(false);
  useEffect(() => {
    let vivo = true;
    void ensureSocialAuthCapability().then(() => {
      if (vivo) setCapacidadIntentada(true);
    });
    return () => {
      vivo = false;
    };
  }, []);
  const capacidadPendiente = social.status === 'pending';

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
    if (!session || !puertaLista) return;
    if (esperandoPuerta.current) {
      esperandoPuerta.current = false;
      setOutcome('error');
      return;
    }
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
        // P-3 · el código devuelto manda. El detalle existente del destino
        // resolverá el nombre; navegar no espera ni agrega un GET desde Join.
        onIngreso?.(r.mesa_code);
        salirAMisItems(r.mesa_code);
      })
      .catch((err: unknown) => {
        const { status, code: motivo } = extractApiError(err);
        // AF-PUERTA-JOIN · el 428 legal no es un fallo del canje: es la puerta.
        // Va ANTES del `alive` a propósito: la marca tiene que quedar aunque la
        // reconsulta ya haya desmontado este efecto. Sin `settle`: el token se
        // conserva entero para canjear después de aceptar.
        if (status === 428 && motivo === LEGAL_ACCEPTANCE_REQUIRED) {
          esperandoPuerta.current = true;
          onRequiereAceptacion?.();
          return;
        }
        if (status === 428 && motivo === USERNAME_REQUIRED) {
          esperandoPuerta.current = true;
          onRequiereArroba?.();
          return;
        }
        if (!alive) return;
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
  }, [session, token, attempt, puertaLista, onRequiereAceptacion, onRequiereArroba, onIngreso]);

  const stage = joinLinkStage({
    hasSession: Boolean(session),
    outcome,
  });

  /**
   * §1.2-A · 401. Sin sesión no se ve la mesa: se ve esto, con el token ya
   * guardado. La tarjeta es GENÉRICA a propósito —"Te invitaron a una mesa"—
   * y no nombra el restaurante: para saber que el token es válido habría que
   * preguntarle al backend, y el endpoint que lo diría sin sesión es el
   * preview público que el cierre del pago sin cuenta prohíbe. Además, un link
   * reenviado le confirmaría a cualquiera dónde está comiendo otra persona.
   */
  if (stage === 'signup') {
    if (authMode) {
      // D374 · B: la tarjeta suelta arriba del formulario, que no cambia. Su texto
      // sigue al modo que de verdad abre el formulario (P02-a: sin alta, «register»
      // baja a «login»).
      const formulario = formularioDeB({
        elegido: authMode,
        altaDisponible: signupAvailable,
        capacidadPendiente,
        capacidadIntentada,
      });
      return (
        <div className="screen link-alta">
          <TarjetaDeLink
            key="alta"
            suelta
            cuadro={{ icono: 'persona-mas' }}
            titulo={t('Te invitaron a una mesa')}
            cuerpo={formulario.modo === 'register'
              ? t('Crea tu cuenta o entra para sumarte y pagar tu parte.')
              : t('Para ver la mesa y pagar tu parte, necesitas una cuenta de PayMe')}
          />
          {formulario.montar && <LoginScreen initialMode={formulario.modo} />}
        </div>
      );
    }
    return (
      <>
        <div className="link-screen">
          <AppHeader compact />
          <TarjetaDeLink
            key="signup"
            cuadro={{ icono: 'persona-mas' }}
            titulo={t('Te invitaron a una mesa')}
            cuerpo={t('Para ver la mesa y pagar tu parte, necesitas una cuenta de PayMe')}
          >
            {/* D373 · un solo naranja: «Crear cuenta gratis» si hay alta; si no,
                «Entrar» (blanco sobre naranja, 2,96:1, riesgo aceptado y declarado),
                con borde mientras no se sabe si hay alta. */}
            {signupAvailable && (
              <button
                type="button"
                className="link-btn link-btn-brand"
                onClick={() => {
                  // AF-INVITACION-TRAS-GOOGLE · si el alta sale a Google y vuelve
                  // a la raíz, esta marca devuelve a la persona a ESTA mesa.
                  recordarRetornoAMesa(code);
                  recordarModoDeMesa(code, 'register');
                  setAuthMode('register');
                }}
              >
                {t('Crear cuenta gratis')}
              </button>
            )}
            <button
              type="button"
              className={entrarEnNaranja({ altaDisponible: signupAvailable, capacidadPendiente, capacidadIntentada })
                ? 'link-btn link-btn-brand'
                : 'link-btn link-btn-outline'}
              onClick={() => {
                recordarRetornoAMesa(code);
                recordarModoDeMesa(code, 'login');
                setAuthMode('login');
              }}
            >
              {t('Ya tengo cuenta · Entrar')}
            </button>
          </TarjetaDeLink>
        </div>
      </>
    );
  }

  /**
   * C, E y F · la misma tarjeta: el aro en C; el link cortado en los rechazos
   * (uno solo, sin pistas del motivo), la tienda en la mesa cerrada y
   * «reintentar» en lo reintentable. `key={outcome}` la vuelve a montar al
   * cambiar de estado, así la entrada se repite.
   */
  const message = joinLinkMessage(outcome, t);
  return (
    <>
      <div className={stage === 'blocked' ? 'link-screen link-screen--con-barra' : 'link-screen'}>
        <AppHeader compact />
        <TarjetaDeLink
          key={outcome}
          cuadro={outcome === 'joining' ? { aro: message.title } : { icono: iconoDelResultado(outcome) }}
          titulo={message.title}
          cuerpo={message.body}
          nota={message.nota}
        >
          {stage === 'retry' && (
            <button
              type="button"
              className="link-btn link-btn-outline"
              onClick={() => setAttempt((n) => n + 1)}
            >
              {t('Reintentar')}
            </button>
          )}
        </TarjetaDeLink>
      </div>
      {/**
       * §1.2-B · la salida del terminal es el círculo, no un botón de texto.
       * El spec la manda a login si no hay sesión y a Inicio si la hay; acá
       * sólo se llega con sesión —sin ella la rama de arriba muestra el 401—,
       * así que el destino es Inicio.
       */}
      {stage === 'blocked' && <BarraDeLink etiqueta={t('Ir a PayMe')} alTocar={() => navigate('home')} />}
    </>
  );
}
