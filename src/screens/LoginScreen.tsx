import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from 'react';
import { useIdioma } from '../i18n/idioma';
import { IS_MOCK } from '../api';
import { api } from '../api';
import { extractApiError } from '../api/errors';
import {
  prepareFacebookRedirect,
  simulateFacebookCallbackForMock,
} from '../api/facebookAuthFlow';
import {
  renderGoogleIdentityButton,
  type GoogleButtonHandle,
} from '../api/googleIdentity';
import { sugerenciaDesdeIdToken } from '../api/googleClaims';
import { vigilarPopupGoogle, type VigiaPopupGoogle } from '../api/googlePopupDiagnostico';
import { AvisoGoogleOtraCuenta } from './AvisoGoogleOtraCuenta';
import {
  linkIntentValido,
  socialAuthSnapshot,
  useSocialAuthCapability,
} from '../api/socialAuth';
import { captureSessionStateWitness } from '../api/storage';
import {
  clearSignupInvitation,
  signupInvitationSnapshot,
  subscribeSignupInvitation,
  type SignupInvitationCapture,
} from '../api/signupInvitation';
import { PATH_PRIVACIDAD, PATH_TERMINOS } from '../public/publicRoute';
import type { LegalAcceptanceRequest, LegalTextResponse } from '../api/types';
import { useAuth } from '../auth/AuthContext';

/**
 * Login / registro según el contrato (routes/auth.js):
 * login {email, password} · register {email, password, first_name, last_name,
 * invitation_token} con password 8–128 chars. El mock conserva la misma
 * compuerta de superficie, aunque sólo PostgreSQL acredita one-use/email/TTL.
 */

/**
 * 🔴 **D-R15 · el copy del alta no puede afirmar que un email exista.**
 *
 * Con el alta abierta, un email ya registrado devuelve el MISMO
 * `registration_not_available` opaco que una invitación inválida —el dueño lo
 * declara en `signup_gate.anti_enumeration`—, así que el consumidor no tiene con
 * qué distinguirlos **y no debe intentarlo**.
 *
 * Dos cambios, los dos por ese motivo:
 * - `registration_not_available` deja de nombrar «esta invitación»: con alta
 *   pública la persona no usó ninguna, y el texto viejo describía un objeto
 *   inexistente.
 * - **`email_already_registered` se retira de este mapa.** El dueño no lo emite
 *   en el alta; mantenerlo era una entrada dormida que, el día que llegara,
 *   convertiría la pantalla en un oráculo de existencia de cuentas. Si algún
 *   backend lo mandara, cae en el genérico y no afirma nada.
 */
const ERROR_TEXT: Record<string, string> = {
  invalid_credentials: 'Email o contraseña incorrectos.',
  user_suspended: 'Tu cuenta está suspendida. Escríbenos.',
  too_many_auth_attempts: 'Demasiados intentos. Espera un minuto.',
  validation_error: 'Revisa los datos: email válido y contraseña de al menos 8 caracteres.',
  registration_not_available: 'No pudimos crear la cuenta. Si ya tienes una, inicia sesión o recupera tu contraseña.',
  registration_unavailable: 'Prueba de nuevo más tarde.',
  too_many_signup_attempts: 'Prueba de nuevo más tarde.',
  rate_limit_unavailable: 'Prueba de nuevo más tarde.',
};

/**
 * C2b · **hay dos autoridades para crear una cuenta, y son excluyentes.**
 *
 * - `invitacion`: el token one-use de D-FF-1, ligado por el dueño a un email.
 * - `publica`: el dueño abrió el alta (`features.signup.public_registration`).
 *
 * `null` = no se puede crear cuenta, que es el estado por defecto y el de
 * siempre hasta C2b.
 */
export type AutoridadDeAlta =
  | { readonly tipo: 'invitacion'; readonly token: string }
  | { readonly tipo: 'publica' }
  | null;

/**
 * 🔴 **La invitación GANA, y no por preferencia estética.** Si alguien llega con
 * un token, el dueño lo **valida y consume** —`signup_gate` del contrato: *«si
 * llega se valida y consume; inválido = registration_not_available»*—. Preferir
 * el alta pública desperdiciaría una autoridad de un solo uso y, peor, cambiaría
 * a qué email queda ligada la cuenta: con invitación el email lo pone la
 * invitación, sin ella lo escribe la persona.
 *
 * Una invitación `invalid` o `absent` no bloquea: cae al alta pública si está
 * abierta. Un token roto no puede dejar a alguien sin poder registrarse cuando
 * el dueño abrió la puerta.
 */
export function autoridadDeAlta(
  invitacion: SignupInvitationCapture,
  publicRegistration: boolean,
): AutoridadDeAlta {
  if (invitacion.status === 'available') return { tipo: 'invitacion', token: invitacion.token };
  return publicRegistration ? { tipo: 'publica' } : null;
}

/**
 * 🔴 **AF-16 · tocar «Google» en el ingreso sirve también para registrarse.**
 * Decisión de Mati, 2026-09-18: *«Yo quiero que se pueden registrar usando
 * Google, es FUNDAMENTAL que se registren usando Google»*.
 *
 * Cuando `google/login` falla, el dueño devuelve un `401 social_auth_failed`
 * **opaco**: es la misma respuesta si la persona no tiene cuenta, si su
 * vínculo está dado de baja o si el token no sirvió. El consumidor no puede
 * distinguirlos **y no debe intentarlo** (anti-enumeración). Por eso el alta se
 * ofrece ante TODO 401 opaco, nunca como «no tienes cuenta», y sólo si hay con
 * qué crearla: una autoridad de alta (invitación o alta pública) y la
 * capability `google_sign_in.registration` del dueño.
 *
 * Fuera de ese caso no se ofrece nada:
 * - un `503` es «no pudimos verificar ahora» y se reintenta, no se registra;
 * - cualquier otro error no es la respuesta opaca del ingreso;
 * - con el alta cerrada, ofrecerla sería prometer algo que el dueño rechaza.
 */
export function ofrecerAltaConGoogle(input: {
  readonly status: number | null;
  readonly code: string;
  readonly autoridad: AutoridadDeAlta;
  readonly googleRegistration: boolean;
}): boolean {
  return input.status === 401
    && input.code === 'social_auth_failed'
    && input.autoridad !== null
    && input.googleRegistration;
}

/**
 * AF-17 · la forma de versión que el dueño acepta en `accepted_notice_version`
 * (`schemas.socialContinue`). El decodificador del aviso admite además un
 * sufijo de prerelease; esa versión NO sirve para «Continuar con Google», y
 * con ella el botón vuelve al camino 0.167.0 (fail-closed).
 */
export const VERSION_AVISO_CONTINUE = /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$/;

/**
 * La versión que puede viajar como `accepted_notice_version`, o `null`: sin
 * aviso cargado, o con una versión que el dueño no acepta, NO hay un-toque.
 */
export function versionAvisoParaContinue(version: string | null): string | null {
  return version !== null && VERSION_AVISO_CONTINUE.test(version) ? version : null;
}

/** Los carteles posibles de un fallo de `continue`. Conjunto CERRADO. */
export type ClaveMensajeContinue =
  | 'neutro'
  | 'registration_not_available'
  | 'too_many_auth_attempts'
  | 'too_many_signup_attempts';

export type DesenlaceContinue =
  | { readonly tipo: 'vincular'; readonly linkIntent: string }
  | { readonly tipo: 'perfil' }
  | { readonly tipo: 'alta_formulario' }
  | { readonly tipo: 'mensaje'; readonly clave: ClaveMensajeContinue };

/**
 * El texto de cada cartel, con un `t('…')` LITERAL por caso: así el extractor
 * de traducciones los ve y no se suma un `t(variable)`. Ninguno afirma ni niega
 * que exista una cuenta; `registration_not_available` es el texto D-R15 vigente.
 */
export function mensajeContinue(
  clave: ClaveMensajeContinue,
  t: (s: string, ...a: unknown[]) => string,
): string {
  switch (clave) {
    case 'registration_not_available':
      return t('No pudimos crear la cuenta. Si ya tienes una, inicia sesión o recupera tu contraseña.');
    case 'too_many_auth_attempts':
      return t('Demasiados intentos. Espera un minuto.');
    case 'too_many_signup_attempts':
      return t('Prueba de nuevo más tarde.');
    case 'neutro':
      return t('No pudimos entrar con Google. Prueba de nuevo o entra con tu correo y contraseña.');
  }
}

/**
 * 🔴 AF-17 · qué hace la pantalla con un fallo de `google/continue`.
 *
 * Sólo DOS respuestas del dueño llevan a otra cosa que un cartel, y las dos
 * existen porque el dueño ya verificó a la persona con Google:
 * - `409 link_required` con un `link_intent` bien formado ⇒ paso de contraseña.
 * - `422 profile_required` ⇒ el paso «Crea tu cuenta con Google», sólo nombre.
 *
 * Todo lo demás es opaco y se queda opaco: ningún texto afirma ni niega que
 * exista una cuenta. `401 social_auth_failed` sólo abre el alta con formulario
 * (conducta 0.167.0) cuando el dueño NO ofrece alta en un toque —si la
 * ofreciera, `continue` ya la habría creado— y hay con qué crear la cuenta.
 */
export function desenlaceContinue(input: {
  readonly status: number | null;
  readonly code: string;
  readonly extra: Record<string, unknown>;
  readonly oneTapSignup: boolean;
  readonly autoridad: AutoridadDeAlta;
  readonly googleRegistration: boolean;
}): DesenlaceContinue {
  if (input.status === 409 && input.code === 'link_required'
      && linkIntentValido(input.extra.link_intent)) {
    return { tipo: 'vincular', linkIntent: input.extra.link_intent };
  }
  if (input.status === 422 && input.code === 'profile_required') return { tipo: 'perfil' };
  if (!input.oneTapSignup && ofrecerAltaConGoogle(input)) return { tipo: 'alta_formulario' };
  if (input.code === 'registration_not_available'
      || input.code === 'too_many_auth_attempts'
      || input.code === 'too_many_signup_attempts') {
    return { tipo: 'mensaje', clave: input.code };
  }
  return { tipo: 'mensaje', clave: 'neutro' };
}

export interface SocialActionEligibility {
  readonly mode: 'login' | 'register';
  readonly providerActionEnabled: boolean;
  readonly autoridad: AutoridadDeAlta;
  readonly legalReady: boolean;
  readonly firstName: string;
  readonly lastName: string;
  /** D-R16 · sin invitación es la única fuente del email de la cuenta. */
  readonly email: string;
  /**
   * 🔴 El proveedor exige invitación por CONTRATO, no por configuración.
   * Facebook es el caso: su `register/start` conserva `invitation_token`
   * obligatorio (`endpoints.facebook_register_start.request` y
   * `signup_gate.facebook` del contrato espejado). Sin esto, abrir el alta
   * pública habilitaría un botón cuyo body el dueño rechaza.
   */
  readonly requiereInvitacion: boolean;
}

/** La alta social hereda autoridad, legal y nombres; nunca password. */
export function socialActionEligible(input: SocialActionEligibility): boolean {
  if (!input.providerActionEnabled) return false;
  if (input.mode === 'login') return true;
  if (!input.autoridad) return false;
  if (input.requiereInvitacion && input.autoridad.tipo !== 'invitacion') return false;
  if (!input.legalReady) return false;
  if (input.firstName.trim().length === 0 || input.lastName.trim().length === 0) return false;
  // Con alta pública el email lo escribe la persona y es la única fuente
  // (D-R16); con invitación lo aporta la autoridad y no se pide acá.
  if (input.autoridad.tipo === 'publica' && input.email.trim().length === 0) return false;
  return true;
}

function errorMessage(err: unknown, t: (s: string, ...a: unknown[]) => string): string {
  const { code } = extractApiError(err);
  // 🔴 `ERROR_TEXT` es constante de MÓDULO: sus valores están en español y
  // se traducen ACÁ, que es donde `t` existe. Envolverlos arriba no compila.
  const crudo = ERROR_TEXT[code];
  return crudo ? t(crudo) : t('No pudimos conectar. Prueba de nuevo.');
}

type LegalState =
  | { status: 'idle' | 'loading' | 'error' }
  | { status: 'ready'; value: LegalTextResponse['legal_text'] };

/**
 * AF2 · LEGAL-3.0.0 · el paquete que acompaña al aviso en el alta: Términos de
 * uso y aviso simplificado. `unavailable` = el dueño todavía no lo sirve (404,
 * paquete apagado): el alta sigue como hasta hoy, sin casillas. `ready` =
 * casillas obligatorias y `legal_acceptance` viaja en las tres altas.
 */
type PaqueteState =
  | { status: 'idle' | 'loading' | 'error' | 'unavailable' }
  | {
    status: 'ready';
    terminos: LegalTextResponse['legal_text'];
    simplificado: LegalTextResponse['legal_text'];
  };

type GoogleActionAuthority =
  | {
      readonly purpose: 'login';
      readonly clientId: string;
      readonly locale: 'es' | 'en';
    }
  /**
   * AF-16 · addendum 1 · Google PRIMERO en «Crea tu cuenta». Este botón no
   * llama al dueño: sólo recibe el `id_token`, precarga los datos y lleva al
   * paso «Crea tu cuenta con Google». El alta sale recién con «Crear mi
   * cuenta», con los datos que la persona confirmó. Como el dueño todavía no
   * vio ese token, no está consumido y sirve para el alta sin un segundo toque.
   */
  | {
      readonly purpose: 'captura';
      readonly clientId: string;
      readonly locale: 'es' | 'en';
    }
  /**
   * AF-17 · «Continuar con Google» (dueño v2.92.0): entra o crea en un toque.
   * Todo lo que viaja se CAPTURA acá, en el render que montó el botón: la
   * versión del aviso que la pantalla enlaza, la invitación y —sólo en el
   * reintento de `422 profile_required`— el nombre declarado.
   */
  | {
      readonly purpose: 'continue';
      readonly clientId: string;
      readonly locale: 'es' | 'en';
      readonly noticeVersion: string;
      readonly invitationToken: string | null;
      readonly nombre: { readonly firstName: string; readonly lastName: string } | null;
    }
  | {
      readonly purpose: 'register';
      readonly clientId: string;
      readonly locale: 'es' | 'en';
      /**
       * Exactamente UNA de las dos, nunca las dos ni ninguna: es el tipo el que
       * hace imposible mandar `email` junto a una invitación —que el dueño
       * resolvería como `registration_not_available`— y mandar un alta pública
       * sin email, que es su única fuente.
       */
      readonly alta:
        | { readonly tipo: 'invitacion'; readonly invitationToken: string }
        | { readonly tipo: 'publica'; readonly email: string };
      readonly firstName: string;
      readonly lastName: string;
    };

export function modeAfterSignupSnapshot(
  current: 'login' | 'register',
  changed: boolean,
  signupAvailable: boolean,
): 'login' | 'register' {
  if (!changed) return current;
  return signupAvailable ? 'register' : 'login';
}

/**
 * `initialMode` existe para la entrada por link (SPEC_APP.md §1.2-A): esa
 * pantalla ofrece **dos** acciones —"Crear cuenta gratis" y "Ya tengo cuenta ·
 * Entrar"— y cada una tiene que abrir el formulario ya en su modo. Sin esto,
 * quien viene a registrarse aterriza en el login y tiene que buscar el toggle.
 * El alta en sí NO se rediseña acá: sigue siendo este formulario tal cual.
 */
export function LoginScreen({ initialMode }: { initialMode?: 'login' | 'register' } = {}) {
  const { t, idioma } = useIdioma();
  const {
    login,
    register,
    googleLogin,
    googleRegister,
    googleContinue,
    googleContinueLink,
    facebookCallbackPhase,
    completeFacebookCallback,
    clearFacebookCallbackError,
    anunciar,
  } = useAuth();
  const social = useSocialAuthCapability();
  const signup = useSyncExternalStore(
    subscribeSignupInvitation,
    signupInvitationSnapshot,
    signupInvitationSnapshot,
  );
  /**
   * 🔴 **El modo inicial distingue AUTORIDAD de INTENCIÓN, y no son lo mismo.**
   *
   * - Una **invitación** en la URL es intención explícita: esa persona vino a
   *   registrarse, y la pantalla abre en registro como hasta hoy.
   * - El **alta pública** es sólo una puerta abierta. Quien entra a la app
   *   puede tener cuenta desde hace meses; abrirle el formulario de registro
   *   sería adivinarle la intención y empeorar el caso más común. Arranca en
   *   `login`, con el toggle a la vista —que sí se habilita con la autoridad
   *   pública— y a un toque del registro.
   * - `initialMode` (la entrada por link, §1.2-A) sí es intención explícita, y
   *   por eso se respeta con CUALQUIERA de las dos autoridades: ahí alguien tocó
   *   «Crear cuenta gratis».
   *
   * ⚠️ El estado inicial se calcula una sola vez y `social` puede estar todavía
   * `pending`; por eso el default no puede depender de la capability, que llega
   * después. Ésa es la otra razón por la que la puerta abierta no mueve el modo.
   */
  const [mode, setMode] = useState<'login' | 'register'>(() =>
    initialMode === 'register' && !autoridadDeAlta(signup, social.publicRegistration)
      ? 'login'
      : initialMode ?? (signup.status === 'available' ? 'register' : 'login'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [busy, setBusy] = useState(false);
  const [socialBusy, setSocialBusy] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryAccepted, setRecoveryAccepted] = useState(false);
  const [googleGeneration, setGoogleGeneration] = useState(0);
  const [googleLoadFailed, setGoogleLoadFailed] = useState(false);
  /**
   * AF-16 · la persona tocó Google en el ingreso, no se resolvió una cuenta y
   * la app continuó hacia «Crea tu cuenta con Google». Sólo tiene sentido en
   * modo registro: al volver a `login` se apaga (efecto de abajo).
   */
  const [altaConGoogle, setAltaConGoogle] = useState(false);
  /**
   * AF-16 · addendum 1 · el `id_token` que Google entregó al botón de ARRIBA de
   * «Crea tu cuenta». 🔴 Vive SÓLO en este ref: nunca en estado serializable
   * ni en un almacenamiento. Se usa una vez («Crear mi cuenta») y se descarta
   * en cuanto se usa, falla o la persona sale del paso. `tieneCredencial` es
   * su sombra booleana, para que el render sepa qué botón mostrar sin tocar
   * el token.
   */
  const credencialAlta = useRef<string | null>(null);
  const [tieneCredencial, setTieneCredencial] = useState(false);
  /**
   * AF-17 · `422 profile_required`: Google no trajo un nombre utilizable. El
   * paso «Crea tu cuenta con Google» pide SÓLO nombre y apellido y reintenta
   * `continue` con una credencial nueva (la anterior quedó consumida).
   */
  const [perfilGoogle, setPerfilGoogle] = useState(false);
  /**
   * AF-17 · `409 link_required`: el correo verificado de Google ya es de una
   * cuenta PayMe con contraseña. 🔴 El `link_intent` vive SÓLO en este ref —un
   * uso, 10 minutos, nunca en un almacenamiento— y `pasoVincular` es su sombra
   * para el render.
   */
  const linkIntent = useRef<string | null>(null);
  const [pasoVincular, setPasoVincular] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legal, setLegal] = useState<LegalState>({ status: 'idle' });
  const [legalAttempt, setLegalAttempt] = useState(0);
  const [paquete, setPaquete] = useState<PaqueteState>({ status: 'idle' });
  const [aceptaMayor, setAceptaMayor] = useState(false);
  const [aceptaTerminos, setAceptaTerminos] = useState(false);
  const aceptacionRef = useRef<LegalAcceptanceRequest | null>(null);
  const previousSignup = useRef(signup);
  /**
   * AF-19 · el contenedor de GIS vive en ESTADO (callback ref), no en un ref:
   * en el ingreso está abajo y en «Crea tu cuenta» arriba, y son dos elementos
   * DISTINTOS. El efecto que dibuja el botón tiene que volver a correr cuando
   * cambia el elemento, no sólo cuando cambia la autoridad. Antes esto andaba
   * de casualidad: la autoridad cambiaba entre modos. Estabilizada su
   * identidad, un contenedor nuevo quedaba vacío.
   */
  const [googleContainer, setGoogleContainer] = useState<HTMLDivElement | null>(null);
  const googleHandle = useRef<GoogleButtonHandle | null>(null);
  const googleAuthorityRef = useRef<GoogleActionAuthority | null>(null);
  // React state no arbitra dos eventos en el mismo tick. Este lease sincrónico
  // cubre contraseña, Google y Facebook antes del primer await.
  const authActionActive = useRef(false);

  const autoridad = autoridadDeAlta(signup, social.publicRegistration);
  const signupAvailable = autoridad !== null;
  const altaPublica = autoridad?.tipo === 'publica';
  /**
   * El paso «Crea tu cuenta con Google» pide SÓLO lo que el dueño exige para
   * `google_register`: sin contraseña ni «Registrarme». Se deriva —no se
   * guarda— de la capability actual: si el dueño apaga el alta con Google
   * mientras la persona está acá, vuelve el formulario de alta completo en vez
   * de quedar una pantalla sin ningún botón.
   */
  const pasoGoogle = mode === 'register'
    && altaConGoogle
    && signupAvailable
    && social.google.enabled
    && social.google.registration
    && social.google.webClientId !== null;
  const legalReady = legal.status === 'ready';
  /**
   * 🔴 AF-17 · «Continuar con Google» se ofrece sólo si el dueño lo publica
   * (`features.google_continue.supported`) Y la pantalla tiene cargado un aviso
   * con una versión que el dueño acepta: esa versión es la que viaja como
   * `accepted_notice_version` y la que enlaza la frase bajo el botón. Sin ella,
   * fail-closed al camino 0.167.0 (`/google/login` y `/google/register`).
   */
  const versionAvisoContinue = versionAvisoParaContinue(
    legal.status === 'ready' ? legal.value.version : null,
  );
  const continueOn = social.googleContinue.supported
    && versionAvisoContinue !== null
    && social.google.webClientId !== null;
  const perfilActivo = pasoGoogle && perfilGoogle && continueOn;
  /**
   * 🔴 AF-16 · addendum 1 · en «Crea tu cuenta» Google va PRIMERO y no depende
   * de nada escrito: sólo de que el dueño publique el alta con Google y de que
   * haya con qué crear la cuenta. Antes el botón aparecía recién con nombre,
   * apellido, aviso y correo, debajo del formulario: para la persona, Google no
   * existía en esa pantalla (Mati, 2026-09-18: «no me permite crear la cuenta
   * con GMAIL»).
   */
  const capturaGoogle = mode === 'register'
    && !pasoGoogle
    && signupAvailable
    && social.google.enabled
    && social.google.registration
    && social.google.webClientId !== null;
  /** AF-17 · el botón de arriba de «Crea tu cuenta» crea en un toque. */
  const unToqueEnAlta = capturaGoogle && continueOn && social.googleContinue.oneTapSignup;
  // Con el token retenido el paso no muestra Google: el alta sale con «Crear mi
  // cuenta». Sin él (vino de un ingreso fallido, o el alta falló), el botón
  // registra con los datos del formulario, como siempre. En el reintento de
  // `profile_required` alcanza con nombre y apellido: el correo lo pone Google.
  const googleEligible = !pasoVincular && (capturaGoogle
    || (perfilActivo && legalReady && firstName.trim().length > 0 && lastName.trim().length > 0)
    || (!(pasoGoogle && tieneCredencial) && !perfilActivo
    && (mode === 'login' || pasoGoogle)
    && socialActionEligible({
      mode,
      providerActionEnabled: social.google.enabled
        && (mode === 'login' ? social.google.login : social.google.registration),
      autoridad,
      legalReady,
      firstName,
      lastName,
      email,
      requiereInvitacion: false,
    }) && social.google.webClientId !== null));
  const facebookEligible = !pasoGoogle && socialActionEligible({
    mode,
    providerActionEnabled: social.facebook.enabled
      && (mode === 'login' ? social.facebook.login : social.facebook.registration),
    autoridad,
    legalReady,
    firstName,
    lastName,
    email,
    // Facebook conserva `invitation_token` OBLIGATORIO en su register/start:
    // no entra al alta pública aunque el dueño la abra.
    requiereInvitacion: true,
  });

  /**
   * 🔴 D-R16 · el botón de Google vive ARRIBA del campo de correo, y con el alta
   * pública ese correo es requisito. Sin este aviso la persona ve desaparecer el
   * botón y no tiene forma de saber por qué: es el callejón sin salida clásico
   * —un requisito que no se explica donde se necesita—.
   *
   * Se calcula preguntando por lo mismo que gatea el botón, con el email como
   * única diferencia: si con un correo cualquiera sería elegible, entonces lo
   * único que falta es el correo y eso es exactamente lo que se dice.
   */
  const faltaCorreoParaAltaSocial = pasoGoogle
    && !tieneCredencial
    && !perfilActivo
    && altaPublica
    && email.trim().length === 0
    && social.google.webClientId !== null
    && socialActionEligible({
      mode,
      providerActionEnabled: social.google.enabled && social.google.registration,
      autoridad,
      legalReady,
      firstName,
      lastName,
      email: 'x@x.x',
      requiereInvitacion: false,
    });

  const autoridadCandidata = useMemo<GoogleActionAuthority | null>(() => {
    const clientId = social.google.webClientId;
    if (!googleEligible || clientId === null) return null;
    const locale = idioma === 'en' ? 'en' : 'es';
    const continuar = (
      nombre: { firstName: string; lastName: string } | null,
    ): GoogleActionAuthority | null => (
      versionAvisoContinue === null ? null : {
        purpose: 'continue',
        clientId,
        locale,
        noticeVersion: versionAvisoContinue,
        invitationToken: autoridad?.tipo === 'invitacion' ? autoridad.token : null,
        nombre,
      });
    // AF-LOGIN-D73 · decisión 73 de Mati: en «Entrar», Google SÓLO hace entrar a
    // quien ya tiene cuenta (`/google/login`, que el dueño nunca usa para crear
    // una). Sin cuenta, el 401 opaco lleva a «Crea tu cuenta con Google», donde
    // están las casillas. El alta en un toque (`continue`) queda sólo en «Crea tu
    // cuenta»: enmienda parcial de la decisión del 18/09.
    if (mode === 'login') {
      return { purpose: 'login', clientId, locale };
    }
    if (capturaGoogle) {
      return unToqueEnAlta ? continuar(null) : { purpose: 'captura', clientId, locale };
    }
    if (perfilActivo) {
      return continuar({ firstName: firstName.trim(), lastName: lastName.trim() });
    }
    if (!autoridad || legal.status !== 'ready') return null;
    const alta = autoridad.tipo === 'invitacion'
      ? { tipo: 'invitacion' as const, invitationToken: autoridad.token }
      : { tipo: 'publica' as const, email: email.trim() };
    if (alta.tipo === 'publica' && alta.email.length === 0) return null;
    return {
      purpose: 'register',
      clientId,
      locale,
      alta,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
    };
  }, [
    autoridad,
    capturaGoogle,
    continueOn,
    email,
    firstName,
    googleEligible,
    idioma,
    lastName,
    legal.status,
    mode,
    perfilActivo,
    social.google.webClientId,
    unToqueEnAlta,
    versionAvisoContinue,
  ]);
  /**
   * 🔴 AF-19 · la autoridad cambia de IDENTIDAD sólo cuando cambia su CONTENIDO.
   *
   * El memo de arriba devolvía un objeto nuevo en renders que no cambiaban nada:
   * `autoridadDeAlta` crea un objeto por render, y además depende de nombre y
   * correo, que `login`, `captura` y `continue` no llevan. Cada identidad nueva
   * remontaba el botón de Google, y un re-render entre `mousedown` y `mouseup`
   * mandaba el `click` al contenedor: el toque se perdía sin error. Era la causa
   * del intermitente de `google-continuar` «Crea tu cuenta»
   * (`e2e/google-boton-estable.spec.ts` lo reproduce). Con GIS real, además,
   * cada remonte recarga su iframe.
   *
   * La autoridad es un objeto chico y serializable, así que su contenido es su
   * JSON. Un `useMemo` por esa clave devuelve el MISMO objeto mientras el
   * contenido no cambie, y es seguro con render concurrente (no escribe refs
   * durante el render).
   */
  const claveAutoridad = JSON.stringify(autoridadCandidata);
  const googleAuthority = useMemo(() => autoridadCandidata, [claveAutoridad]);
  // Sólo un render COMMITTEADO puede mover autoridad. `useLayoutEffect` corre
  // antes de que el navegador entregue otro evento; un render concurrente
  // abortado no envenena el ref ni mata el botón que sigue visible.
  useLayoutEffect(() => {
    googleAuthorityRef.current = googleAuthority;
    return () => {
      if (googleAuthorityRef.current === googleAuthority) googleAuthorityRef.current = null;
    };
  }, [googleAuthority]);

  const tryAcquireAuthAction = () => {
    if (authActionActive.current) return false;
    authActionActive.current = true;
    return true;
  };
  const releaseAuthAction = () => { authActionActive.current = false; };

  useEffect(() => {
    googleHandle.current?.dispose();
    googleHandle.current = null;
    const container = googleContainer;
    const authority = googleAuthority;
    if (!authority || !container || googleLoadFailed) return;
    let active = true;
    let handle: GoogleButtonHandle;
    // RM-182 · 5a · diagnóstico sin PII del popup que no vuelve (Safari).
    let vigia: VigiaPopupGoogle | null = null;
    try {
      handle = renderGoogleIdentityButton({
        container,
        clientId: authority.clientId,
        locale: authority.locale,
        mockLabel: t('Continuar con Google'),
        onCredential: (credential) => {
          vigia?.credencialRecibida();
          if (googleAuthorityRef.current !== authority) return;
          if (authority.purpose === 'captura') {
            // No viaja nada: el token queda retenido en memoria hasta «Crear mi
            // cuenta». Igual se exige que la autoridad siga viva AHORA —el alta
            // pudo cerrarse o la invitación retirarse entre el render y el
            // toque—: sin ella, no se retiene nada.
            const actual = socialAuthSnapshot();
            if (!autoridadDeAlta(signupInvitationSnapshot(), actual.publicRegistration)
                || !actual.google.enabled || !actual.google.registration) {
              setGoogleGeneration((value) => value + 1);
              return;
            }
            const sugerencia = sugerenciaDesdeIdToken(credential);
            setFirstName((value) => (value.trim() ? value : sugerencia.firstName));
            setLastName((value) => (value.trim() ? value : sugerencia.lastName));
            setEmail((value) => (value.trim() ? value : sugerencia.email));
            setPassword('');
            setError(null);
            credencialAlta.current = credential;
            setTieneCredencial(true);
            setAltaConGoogle(true);
            return;
          }
          if (authority.purpose === 'continue') {
            // Lo mismo que el alta: la capability y la invitación capturadas
            // tienen que seguir vivas AHORA. Si cambiaron, no viaja nada.
            if (!socialAuthSnapshot().googleContinue.supported) {
              setGoogleGeneration((value) => value + 1);
              return;
            }
            if (authority.invitationToken !== null) {
              const currentInvitation = signupInvitationSnapshot();
              if (currentInvitation.status !== 'available'
                  || currentInvitation.token !== authority.invitationToken) return;
            }
          }
          if (authority.purpose === 'register') {
            // La autoridad que se usa tiene que seguir siendo la del render que
            // montó este botón. Con invitación eso es el mismo token; con alta
            // pública, que el dueño la siga declarando abierta —su bandera se
            // lee por request, así que puede haberse cerrado entre el render y
            // el click—. Si cambió, no se manda nada.
            if (authority.alta.tipo === 'invitacion') {
              const currentInvitation = signupInvitationSnapshot();
              if (currentInvitation.status !== 'available'
                  || currentInvitation.token !== authority.alta.invitationToken) return;
            } else if (!socialAuthSnapshot().publicRegistration) {
              return;
            }
          }
          if (!tryAcquireAuthAction()) {
            // El router global ya consumió el state antes del callback. Montar
            // una generación nueva evita dejar un iframe visible pero muerto.
            setGoogleGeneration((value) => value + 1);
            return;
          }
          setSocialBusy(true);
          setError(null);
          void (async () => {
            if (authority.purpose === 'continue') {
              try {
                await continuarConGoogle(authority, credential);
              } finally {
                setSocialBusy(false);
                releaseAuthAction();
              }
              return;
            }
            try {
              if (authority.purpose === 'login') {
                await googleLogin(credential);
              } else {
                // 🔴 El body es condicional a la autoridad, y es el ÚNICO de
                // todo el alta que lo es: el DTO social del dueño acepta `email`
                // SÓLO con el alta abierta y es `strict` con el alta cerrada.
                await googleRegister({
                  id_token: credential,
                  first_name: authority.firstName,
                  last_name: authority.lastName,
                  ...(authority.alta.tipo === 'invitacion'
                    ? { invitation_token: authority.alta.invitationToken }
                    : { email: authority.alta.email }),
                  ...conAceptacion(),
                });
                // Sólo hay algo que soltar si se usó una invitación.
                if (authority.alta.tipo === 'invitacion') clearSignupInvitation();
              }
            } catch (err) {
              const { status, code } = extractApiError(err);
              if (authority.purpose === 'login') {
                // AF-16 · la autoridad se lee AHORA, no la del render que montó
                // el botón: el alta pudo cerrarse o la invitación retirarse.
                const actual = socialAuthSnapshot();
                if (ofrecerAltaConGoogle({
                  status,
                  code,
                  autoridad: autoridadDeAlta(signupInvitationSnapshot(), actual.publicRegistration),
                  googleRegistration: actual.google.enabled
                    && actual.google.registration
                    && actual.google.webClientId !== null,
                })) {
                  // 🔴 El `id_token` NO se reutiliza: el dueño lo consume también
                  // en un ingreso fallido (`consumeCredential` escribe el digest
                  // anti-replay aunque no haya vínculo, con `UNIQUE (provider,
                  // credential_hash)` para cualquier propósito). Mandarlo al alta
                  // sería un `registration_not_available` seguro. Por eso el
                  // paso pide un toque más, y del token sólo quedan sugerencias
                  // editables, en memoria: nunca se persiste.
                  const sugerencia = sugerenciaDesdeIdToken(credential);
                  setFirstName((value) => (value.trim() ? value : sugerencia.firstName));
                  setLastName((value) => (value.trim() ? value : sugerencia.lastName));
                  setEmail((value) => (value.trim() ? value : sugerencia.email));
                  setPassword('');
                  setRecoveryAccepted(false);
                  setAltaConGoogle(true);
                  setMode('register');
                  setGoogleGeneration((value) => value + 1);
                  return;
                }
                // Alta cerrada o fallo que no es el 401 opaco: un texto neutro
                // que no promete un alta que no está disponible ni afirma nada
                // sobre si la cuenta existe.
                setError(t('No pudimos entrar con Google. Prueba de nuevo o entra con tu correo y contraseña.'));
              } else {
                // D-R15 · el texto vigente de `registration_not_available` ya
                // orienta a iniciar sesión o recuperar sin afirmar que exista.
                setError(code === 'registration_not_available'
                  ? errorMessage(err, t)
                  : t('No pudimos completar el ingreso. Prueba de nuevo.'));
              }
              // El handle es one-use: un fallo requiere una generación nueva.
              setGoogleGeneration((value) => value + 1);
            } finally {
              setSocialBusy(false);
              releaseAuthAction();
            }
          })();
        },
      });
    } catch {
      setError(t('No pudimos completar el ingreso. Prueba de nuevo.'));
      setGoogleLoadFailed(true);
      return;
    }
    googleHandle.current = handle;
    vigia = vigilarPopupGoogle(container);
    void handle.ready.catch(() => {
      if (!active) return;
      setError(t('No pudimos completar el ingreso. Prueba de nuevo.'));
      setGoogleLoadFailed(true);
    });
    return () => {
      active = false;
      vigia?.dispose();
      handle.dispose();
      if (googleHandle.current === handle) googleHandle.current = null;
    };
  }, [googleAuthority, googleContainer, googleGeneration, googleLoadFailed, googleLogin, googleRegister, t]);

  /**
   * 🔴 AF-17 · un toque en «Continuar con Google». El dueño decide si entra o
   * crea; la pantalla sólo resuelve qué sigue según `desenlaceContinue`.
   */
  async function continuarConGoogle(
    authority: Extract<GoogleActionAuthority, { purpose: 'continue' }>,
    credential: string,
  ) {
    try {
      const { created } = await googleContinue({
        id_token: credential,
        accepted_notice_version: authority.noticeVersion,
        ...conAceptacion(),
        ...(authority.invitationToken !== null ? { invitation_token: authority.invitationToken } : {}),
        ...(authority.nombre !== null
          ? { first_name: authority.nombre.firstName, last_name: authority.nombre.lastName }
          : {}),
      });
      // La invitación se consume sólo si la cuenta NACIÓ con ella, y recién
      // con la sesión persistida.
      if (created && authority.invitationToken !== null) clearSignupInvitation();
      if (created) anunciar(t('¡Listo! Creamos tu cuenta de PayMe.'));
    } catch (err) {
      const { status, code, extra } = extractApiError(err);
      const actual = socialAuthSnapshot();
      const desenlace = desenlaceContinue({
        status,
        code,
        extra,
        oneTapSignup: actual.googleContinue.oneTapSignup,
        autoridad: autoridadDeAlta(signupInvitationSnapshot(), actual.publicRegistration),
        googleRegistration: actual.google.enabled
          && actual.google.registration
          && actual.google.webClientId !== null,
      });
      const sugerencia = () => {
        const s = sugerenciaDesdeIdToken(credential);
        setFirstName((value) => (value.trim() ? value : s.firstName));
        setLastName((value) => (value.trim() ? value : s.lastName));
        return s;
      };
      if (desenlace.tipo === 'vincular') {
        linkIntent.current = desenlace.linkIntent;
        setPassword('');
        setPasoVincular(true);
      } else if (desenlace.tipo === 'perfil') {
        sugerencia();
        credencialAlta.current = null;
        setTieneCredencial(false);
        setPerfilGoogle(true);
        setAltaConGoogle(true);
        setMode('register');
      } else if (desenlace.tipo === 'alta_formulario') {
        // Conducta 0.167.0: el token ya se consumió, así que el paso pide un
        // toque más con los datos del formulario.
        const s = sugerencia();
        setEmail((value) => (value.trim() ? value : s.email));
        setPassword('');
        setAltaConGoogle(true);
        setMode('register');
      } else {
        setError(mensajeContinue(desenlace.clave, t));
      }
      // El handle es one-use: cualquier fallo requiere una generación nueva.
      setGoogleGeneration((value) => value + 1);
    }
  }

  /** AF-17 · volver del paso de contraseña: el intento se descarta. */
  function salirDeVincular() {
    linkIntent.current = null;
    setPasoVincular(false);
    setPassword('');
    setError(null);
    setGoogleGeneration((value) => value + 1);
  }

  /**
   * AF-17 · `POST /google/continue/link`: la contraseña de la cuenta es la
   * única autoridad para conectar Google. `403` = contraseña incorrecta, el
   * intento sigue vivo (el dueño lo quema al quinto error); `401` = el intento
   * venció, se usó o se quemó: se descarta y se vuelve a Google.
   */
  async function onVincular(e: FormEvent) {
    e.preventDefault();
    const intent = linkIntent.current;
    if (!intent || password.length < 8 || !tryAcquireAuthAction()) return;
    setBusy(true);
    setError(null);
    try {
      await googleContinueLink({ link_intent: intent, password });
      linkIntent.current = null;
      anunciar(t('Listo: conectamos tu cuenta con Google.'));
    } catch (err) {
      const { status, code } = extractApiError(err);
      if (status === 403 && code === 'reauthentication_failed') {
        setPassword('');
        setError(t('Contraseña incorrecta. Prueba de nuevo.'));
      } else if (status === 401) {
        linkIntent.current = null;
        setPasoVincular(false);
        setPassword('');
        setMode('login');
        setGoogleGeneration((value) => value + 1);
        setError(t('No pudimos conectar tu cuenta. Toca «Continuar con Google» otra vez.'));
      } else {
        setError(errorMessage(err, t));
      }
    } finally {
      setBusy(false);
      releaseAuthAction();
    }
  }

  async function onFacebook() {
    if (!facebookEligible || !tryAcquireAuthAction()) return;
    let redirecting = false;
    setSocialBusy(true);
    setError(null);
    clearFacebookCallbackError();
    try {
      const sessionStateWitness = captureSessionStateWitness();
      const response = mode === 'login'
        ? await api.facebookLoginStart()
        // Facebook conserva `invitation_token` obligatorio: el alta pública no
        // lo habilita, y `facebookEligible` ya lo cierra arriba. Acá se vuelve a
        // exigir el tipo exacto para que el body no pueda salir sin token.
        : autoridad?.tipo === 'invitacion' && legal.status === 'ready'
          ? await api.facebookRegisterStart({
              invitation_token: autoridad.token,
              first_name: firstName.trim(),
              last_name: lastName.trim(),
            })
          : (() => { throw new Error('social_registration_prerequisite_changed'); })();
      const authorizationUrl = prepareFacebookRedirect(
        response,
        mode,
        social.facebook,
        sessionStateWitness,
      );
      if (IS_MOCK) {
        simulateFacebookCallbackForMock(response);
        await completeFacebookCallback();
      } else {
        window.location.assign(authorizationUrl);
        // `assign` ya fue aceptado. El unload libera toda la página; hacerlo
        // acá reabriría una ventana para otra auth antes de abandonar PayMe.
        redirecting = true;
      }
    } catch {
      setError(t('No pudimos completar el ingreso. Prueba de nuevo.'));
    } finally {
      if (!redirecting) {
        setSocialBusy(false);
        releaseAuthAction();
      }
    }
  }

  async function onRecoveryRequest() {
    if (mode !== 'login' || !social.recovery.enabled || recoveryBusy) return;
    setRecoveryBusy(true);
    setRecoveryAccepted(false);
    setError(null);
    try {
      await api.requestRecovery(email.trim());
      setRecoveryAccepted(true);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setRecoveryBusy(false);
    }
  }

  // Un segundo link abierto en la misma pestaña cambia sólo el hash: React no
  // remonta el componente. La custodia debe reaccionar a esa navegación y no
  // seguir mandando la autoridad anterior.
  useEffect(() => {
    const previous = previousSignup.current;
    previousSignup.current = signup;
    // En el primer efecto ambos son el mismo snapshot: respetar initialMode y
    // el botón explícito “Ya tengo cuenta”. Sólo una NAVEGACIÓN posterior
    // cambia el modo por autoridad nueva/retirada.
    const next = modeAfterSignupSnapshot(mode, previous !== signup, signupAvailable);
    if (next !== mode) setMode(next);
    if (previous === signup) return;
    setError(null);
  }, [signup, mode]);

  /**
   * El aviso se pide para CUALQUIER autoridad de alta: el consentimiento no
   * depende de cómo se acredite el derecho a crear la cuenta. AF-17: con
   * «Continuar con Google» publicado se carga también en el ingreso, porque su
   * versión es la que viaja y la que enlaza la frase.
   *
   * 🔴 AF-19 · el efecto depende de SI HACE FALTA el aviso, no del modo. Antes
   * dependía de `mode`: con `continue` publicado, pasar del ingreso a «Crea tu
   * cuenta» recargaba un aviso ya cargado. Durante ~300 ms la frase
   * desaparecía y el botón de arriba era `captura`, y un toque en esa ventana
   * iba al camino 0.167.0. Era la segunda causa del intermitente de
   * `google-continuar` (medido en 36 de 40 corridas). Sin `continue`, el aviso
   * sigue haciendo falta sólo en el alta, y se pide al entrar a ella, como
   * antes.
   */
  const quiereAviso = (mode === 'register' && signupAvailable) || social.googleContinue.supported;
  useEffect(() => {
    if (!quiereAviso) {
      setLegal({ status: 'idle' });
      return;
    }
    let alive = true;
    setLegal({ status: 'loading' });
    api.getPrivacyNotice()
      .then((response) => {
        if (alive) setLegal({ status: 'ready', value: response.legal_text });
      })
      .catch(() => {
        if (alive) setLegal({ status: 'error' });
      });
    return () => { alive = false; };
  }, [quiereAviso, signup, legalAttempt]);

  // AF2 · el paquete legal 3.0.0 se pide junto con el aviso. 404 = apagado en el
  // dueño (alta de siempre); otro error = como el del aviso, con reintento.
  useEffect(() => {
    if (!quiereAviso) {
      setPaquete({ status: 'idle' });
      return;
    }
    let alive = true;
    setPaquete({ status: 'loading' });
    Promise.all([api.getLegalText('terminos_uso'), api.getLegalText('aviso_privacidad_simplificado')])
      .then(([terminos, simplificado]) => {
        if (alive) setPaquete({ status: 'ready', terminos: terminos.legal_text, simplificado: simplificado.legal_text });
      })
      .catch((err) => {
        if (!alive) return;
        setPaquete({ status: extractApiError(err).status === 404 ? 'unavailable' : 'error' });
      });
    return () => { alive = false; };
  }, [quiereAviso, signup, legalAttempt]);

  // Cambiar de «Entrar» a «Crea tu cuenta» (o al revés) desmarca las casillas.
  useEffect(() => {
    setAceptaMayor(false);
    setAceptaTerminos(false);
  }, [mode]);

  const paqueteVigente = legal.status === 'ready' && paquete.status === 'ready';
  const paqueteIncierto = mode === 'register' && (paquete.status === 'loading' || paquete.status === 'error');
  const aceptacionLista = !paqueteVigente || (aceptaMayor && aceptaTerminos);
  aceptacionRef.current = paqueteVigente && legal.status === 'ready' && paquete.status === 'ready'
    ? {
      aviso_version: legal.value.version,
      aviso_hash: legal.value.hash,
      terminos_version: paquete.terminos.version,
      terminos_hash: paquete.terminos.hash,
      adult_declaration: true,
    }
    : null;
  const conAceptacion = () => (aceptacionRef.current ? { legal_acceptance: aceptacionRef.current } : {});

  /**
   * AF2 · las dos casillas aprobadas (`registro_y_puerta.txt`): sin marcar, y
   * nada avanza hasta marcarlas. La misma pieza sirve al alta con correo, al
   * paso de Google y al un-toque.
   */
  const casillasLegales = paqueteVigente ? (
    <div className="casillas-legales">
      <label className="casilla-legal">
        <input type="checkbox" checked={aceptaMayor} disabled={busy || socialBusy} onChange={(e) => setAceptaMayor(e.target.checked)} />
        <span>{t('Declaro que tengo 18 años o más.')}</span>
      </label>
      <label className="casilla-legal">
        <input type="checkbox" checked={aceptaTerminos} disabled={busy || socialBusy} onChange={(e) => setAceptaTerminos(e.target.checked)} />
        <span>
          {t('He leído y acepto los')}{' '}
          <a href={PATH_TERMINOS} target="_blank" rel="noreferrer">{t('Términos de Uso')}</a>.
        </span>
      </label>
      <p className="ingreso-legal">
        {t('Aviso de Privacidad: Consulta cómo PayMe trata tus datos personales en nuestro')}{' '}
        <a href={PATH_PRIVACIDAD} target="_blank" rel="noreferrer">{t('Aviso de Privacidad')}</a>.
      </p>
    </div>
  ) : null;

  // AF-16 · el paso de Google existe sólo en registro.
  useEffect(() => {
    if (mode === 'login') {
      setAltaConGoogle(false);
      setPerfilGoogle(false);
      credencialAlta.current = null;
      setTieneCredencial(false);
    }
  }, [mode]);

  /**
   * AF-16 · addendum 1 · «Crear mi cuenta»: el alta con el token que Google
   * entregó al botón de arriba. Los datos son los CONFIRMADOS en el formulario
   * —la sugerencia de los claims es sólo el valor inicial— y la autoridad se lee
   * al momento del toque, igual que el alta con contraseña.
   */
  async function onCrearConGoogle() {
    const credential = credencialAlta.current;
    if (!credential || !pasoGoogle || !autoridad || legal.status !== 'ready') return;
    if (!socialActionEligible({
      mode: 'register',
      providerActionEnabled: true,
      autoridad,
      legalReady: true,
      firstName,
      lastName,
      email,
      requiereInvitacion: false,
    })) return;
    if (!tryAcquireAuthAction()) return;
    // One-use: se suelta ANTES del primer await, pase lo que pase después.
    credencialAlta.current = null;
    setBusy(true);
    setError(null);
    try {
      await googleRegister({
        id_token: credential,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        ...(autoridad.tipo === 'invitacion'
          ? { invitation_token: autoridad.token }
          : { email: email.trim() }),
        ...conAceptacion(),
      });
      if (autoridad.tipo === 'invitacion') clearSignupInvitation();
    } catch (err) {
      const { code } = extractApiError(err);
      // D-R15 · el texto vigente orienta a iniciar sesión o recuperar sin
      // afirmar que la cuenta exista. Sin token, el paso vuelve a ofrecer el
      // botón de Google, que registra con estos mismos datos.
      setError(code === 'registration_not_available'
        ? errorMessage(err, t)
        : t('No pudimos completar el ingreso. Prueba de nuevo.'));
      setTieneCredencial(false);
      setGoogleGeneration((value) => value + 1);
    } finally {
      setBusy(false);
      releaseAuthAction();
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    // En el paso de Google no hay contraseña: un Enter no puede disparar el
    // alta con contraseña vacía.
    if (pasoGoogle) return;
    if (!tryAcquireAuthAction()) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        if (!autoridad || legal.status !== 'ready') {
          setError(t('No pudimos crear la cuenta. Prueba de nuevo en un momento.'));
          return;
        }
        // 🔴 El alta directa NO tiene body condicional: el DTO del dueño ya
        // tenía `invitation_token` opcional en los DOS modos, para que ausente,
        // inválida, usada o vencida caigan en la MISMA respuesta opaca. Acá se
        // manda si existe y no se manda si no, sin mirar la capability.
        await register({
          email,
          password,
          first_name: firstName,
          last_name: lastName,
          ...(autoridad.tipo === 'invitacion' ? { invitation_token: autoridad.token } : {}),
          ...conAceptacion(),
        });
        // `register` retorna sólo después de que la sesión quedó persistida.
        // Un 403 opaco conserva el token: puede ser sólo un email mal escrito.
        if (autoridad.tipo === 'invitacion') clearSignupInvitation();
      }
    } catch (err) {
      const { code } = extractApiError(err);
      // Carrera GET→POST: el owner perdió integridad legal. El aviso cacheado
      // deja de acreditar el alta y sólo un GET nuevo puede reabrirla.
      if (code === 'registration_unavailable') setLegal({ status: 'error' });
      // AF2 · el par aceptado dejó de ser el vigente (409): se vuelven a leer
      // aviso y paquete; la persona vuelve a marcar sobre el texto nuevo.
      if (code === 'legal_version_mismatch') setLegalAttempt((value) => value + 1);
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
      releaseAuthAction();
    }
  }

  /**
   * 🔴 EL SEPARADOR «O CONTINÚA CON» SÓLO EXISTE SI HAY ALGO DEBAJO.
   *
   * Es la misma condición que monta el bloque social, y por eso se calcula una
   * sola vez: una línea que anuncia alternativas sobre el vacío es peor que no
   * tener línea. Hoy, en producción, `/api/config` trae Google y Facebook
   * apagados y esto es `false`: la tarjeta termina en «¿Olvidaste…?».
   */
  /**
   * AF-16 · en el paso de Google no hay «Registrarme»: si el botón de Google
   * todavía no aparece —falta nombre o apellido; el correo tiene su propio
   * aviso—, la pantalla quedaría sin ninguna acción. Se dice qué falta.
   */
  // Con el token retenido no hay botón de Google que esperar: el que se
  // habilita con los datos es «Crear mi cuenta».
  const faltanDatosParaGoogle = pasoGoogle
    && !tieneCredencial
    && legal.status === 'ready'
    && !googleEligible
    && !faltaCorreoParaAltaSocial;
  const haySocial = (googleEligible && !capturaGoogle) || facebookEligible
    || faltaCorreoParaAltaSocial || faltanDatosParaGoogle;

  /**
   * El contenedor de GIS existe UNA sola vez en la pantalla: arriba en «Crea tu
   * cuenta» (captura) y abajo en el ingreso o en el paso sin token. El efecto
   * que dibuja el botón depende de `googleContainer` (estado): cada elemento
   * nuevo lo vuelve a dibujar.
   */
  // AF2 · con el paquete vigente, el toque que puede CREAR una cuenta (un-toque
  // o alta con Google) exige las dos casillas ANTES: el botón de Google queda
  // inerte —sin puntero ni foco— hasta marcarlas (`registro_y_puerta.txt`).
  const googlePuedeCrear = googleAuthority?.purpose === 'continue' || googleAuthority?.purpose === 'register';
  const googleInerte = paqueteVigente && googlePuedeCrear && !aceptacionLista;
  // Una sola vez en pantalla: si la ranura de Google ya las muestra (Google
  // PRIMERO en «Crea tu cuenta»), el formulario de abajo no las repite; las
  // mismas dos casillas gobiernan los dos caminos.
  const casillasEnRanura = paqueteVigente && googlePuedeCrear;
  const ranuraGoogle = (
    <div className="social-provider-slot">
      {paqueteVigente && googlePuedeCrear && casillasLegales}
      <div
        className={googleInerte ? 'social-google-gated' : undefined}
        aria-disabled={googleInerte || undefined}
        {...(googleInerte ? ({ inert: '' } as Record<string, string>) : {})}
      >
        <div
          ref={setGoogleContainer}
          className="social-google-container"
          role="group"
          aria-label={t('Continuar con Google')}
        />
      </div>
      {/* AF-17 · con «Continuar con Google» el toque puede CREAR la cuenta: la
          aceptación del aviso se dice junto al botón y enlaza el mismo aviso
          cuya versión viaja. Sin versión vigente no hay modo un-toque. AF2: con
          el paquete 3.0.0 vigente, las casillas de arriba reemplazan la frase. */}
      {googleAuthority?.purpose === 'continue' && !paqueteVigente && (
        <p className="ingreso-legal ingreso-aviso-google">
          {t('Al continuar aceptas el')}{' '}
          <a href={PATH_PRIVACIDAD}>{t('Aviso de privacidad')}</a>
        </p>
      )}
      {/* RM-182 · 5b · ranura del aviso para cambiar de cuenta en Safari: no se
          dibuja hasta que Mati apruebe el texto (decisión 11). */}
      <AvisoGoogleOtraCuenta />
      {googleLoadFailed && (
        <button
          type="button"
          className="login-toggle social-provider-retry"
          onClick={() => {
            setGoogleLoadFailed(false);
            setGoogleGeneration((value) => value + 1);
          }}
        >
          {t('Reintentar')}
        </button>
      )}
    </div>
  );

  return (
    <div className="ingreso">
      {/* §1 · la banda vive SÓLO en el riel mock. En el build real este nodo
          no se renderiza: no es un aviso escondido con CSS. */}
      {IS_MOCK && (
        <div className="ingreso-demo">
          {t('Demo · datos de ejemplo, no se cobra dinero real')}
        </div>
      )}

      <header className="ingreso-hero">
        <div className="ingreso-lockup">
          <svg
            className="ingreso-simbolo"
            viewBox="0 0 76 76"
            width="38"
            height="38"
            role="img"
            aria-label={t('Símbolo PayMe')}
          >
            <rect className="s-fondo" width="76" height="76" rx="21" />
            <path className="s-navy" d="M18.5 21 L27.5 21 L36.5 38 L27.5 55 L18.5 55 L27.5 38 Z" />
            <path className="s-blanco" d="M39.5 21 L48.5 21 L57.5 38 L48.5 55 L39.5 55 L48.5 38 Z" />
          </svg>
          <div className="ingreso-marca">
            Pay<span className="t">Me</span>
          </div>
        </div>
        <div className="ingreso-sub">{t('Divide y paga la cuenta desde donde quieras')}</div>
      </header>

      <div className="ingreso-burbuja">
        <div className="ingreso-burbuja-titulo">
          {pasoVincular
            ? t('Conecta tu cuenta con Google')
            : mode === 'login'
              // Decisión 74 de Mati, literal: «que diga solo Log in». Va igual en
              // los dos idiomas y sin `t()`: una clave «Log in → Log in» la
              // marcaría como copy sin traducir la guarda de `idioma.spec.ts`.
              ? 'Log in'
              : pasoGoogle ? t('Crea tu cuenta con Google') : t('Crea tu cuenta')}
        </div>
        {/* Decisión 74: la burbuja de «Entrar» lleva SÓLO el título; el
            subtítulo se quitó y la burbuja se ajusta sola (altura automática). */}
        {pasoGoogle && !pasoVincular && (
          <div className="ingreso-burbuja-sub" role="status">
            {tieneCredencial
              ? t('Revisa tus datos y toca «Crear mi cuenta».')
              : perfilActivo
                ? t('Google no nos dio tu nombre. Escríbelo y toca «Continuar con Google» otra vez.')
                : t('Revisa tus datos y toca «Continuar con Google» otra vez para crear tu cuenta.')}
          </div>
        )}
        {pasoVincular && (
          <div className="ingreso-burbuja-sub" role="status">
            {t('Ya tienes una cuenta con este correo. Escribe tu contraseña para conectarla con Google.')}
          </div>
        )}
      </div>

      <div className="ingreso-cuerpo">
        {pasoVincular ? (
          <form className="ingreso-tarjeta" onSubmit={onVincular}>
            <label className="ingreso-campo">
              <span className="ingreso-etiqueta">{t('Contraseña')}</span>
              <input
                className="input ingreso-input"
                type="password"
                placeholder={t('Tu contraseña')}
                aria-invalid={!!error}
                aria-describedby={error ? 'login-error' : undefined}
                autoComplete="current-password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                required
              />
            </label>
            <button className="ingreso-entrar" type="submit" disabled={busy || password.length < 8}>
              {busy ? t('Un segundo…') : t('Conectar con Google')}
            </button>
            {error && (
              <div id="login-error" className="ingreso-error" role="alert">
                {error}
              </div>
            )}
            <div className="ingreso-pie">
              <button type="button" className="login-toggle" onClick={salirDeVincular} disabled={busy}>
                {t('Volver')}
              </button>
            </div>
          </form>
        ) : (
        <form className="ingreso-tarjeta" onSubmit={onSubmit}>
          {/* 🔴 AF-16 · addendum 1 · en «Crea tu cuenta», Google PRIMERO, antes
              de cualquier campo y sin depender de nada escrito. El formulario
              con contraseña queda debajo, como alternativa. */}
          {capturaGoogle && (
            <section className="social-auth-options ingreso-alta-google" aria-busy={socialBusy}>
              {ranuraGoogle}
              <div className="social-auth-divider ingreso-alta-google-divisor" aria-hidden="true">
                <span>{t('O regístrate con tu correo')}</span>
              </div>
            </section>
          )}
          {mode === 'register' && (
            <>
              <label className="ingreso-campo">
                <span className="ingreso-etiqueta">{t('Nombre')}</span>
                <input
                  className="input ingreso-input"
                  placeholder={t('Nombre')}
                  aria-invalid={!!error}
                  aria-describedby={error ? 'login-error' : undefined}
                  autoComplete="given-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  disabled={busy || socialBusy}
                  required
                />
              </label>
              <label className="ingreso-campo">
                <span className="ingreso-etiqueta">{t('Apellido')}</span>
                <input
                  className="input ingreso-input"
                  placeholder={t('Apellido')}
                  aria-invalid={!!error}
                  aria-describedby={error ? 'login-error' : undefined}
                  autoComplete="family-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  disabled={busy || socialBusy}
                  required
                />
              </label>
            </>
          )}

          {/* §2 · la etiqueta va arriba y FIJA, y el `placeholder` deja de
              repetirla: pasa a ser la pista del artefacto. Los dos rótulos que
              el paquete define son éstos; «Nombre» y «Apellido» conservan el
              suyo porque el artefacto NO diseña el alta y no hay pista que
              copiar — inventarla sería escribir copy de una pantalla que
              todavía no se diseñó. */}
          {/* Con invitación el email lo pone la invitación: en el paso de Google
              no se pide, porque no viaja. */}
          {/* AF-17 · en el reintento de `profile_required` tampoco: el correo
              es el verificado de Google, `continue` no acepta otro. */}
          {!(pasoGoogle && (autoridad?.tipo === 'invitacion' || perfilActivo)) && (
          <label className="ingreso-campo">
            <span className="ingreso-etiqueta">{t('Email')}</span>
            <input
              className="input ingreso-input"
              type="email"
              placeholder={t('tu@email.com')}
              aria-invalid={!!error}
              aria-describedby={error ? 'login-error' : undefined}
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setRecoveryAccepted(false);
              }}
              disabled={busy || socialBusy || recoveryBusy}
              required
            />
          </label>
          )}

          {!pasoGoogle && (
          <label className="ingreso-campo">
            <span className="ingreso-etiqueta">{t('Contraseña')}</span>
            <input
              className="input ingreso-input"
              type="password"
              placeholder={t('Tu contraseña')}
              aria-invalid={!!error}
              aria-describedby={error ? 'login-error' : undefined}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy || socialBusy || recoveryBusy}
              required
            />
          </label>
          )}

          {mode === 'register' && legal.status === 'loading' && (
            <div className="legal-notice-state" role="status">{t('Cargando…')}</div>
          )}
          {mode === 'register' && (legal.status === 'error' || paquete.status === 'error') && (
            <div className="ingreso-error" role="alert">
              <div>{t('No pudimos conectar. Prueba de nuevo.')}</div>
              <button
                type="button"
                className="login-toggle"
                onClick={() => setLegalAttempt((value) => value + 1)}
              >
                {t('Reintentar')}
              </button>
            </div>
          )}
          {mode === 'register' && legal.status === 'ready' && paquete.status === 'ready' && (
            <>
              {!casillasEnRanura && casillasLegales}
              <section className="legal-notice" aria-label="Aviso de Privacidad Simplificado">
                {idioma === 'en' && (
                  <p className="legal-notice-language" lang="en">
                    This document is only available in Spanish for now.
                  </p>
                )}
                <pre lang="es">{paquete.simplificado.body}</pre>
                <div className="legal-notice-meta" lang="es">
                  Versión {paquete.simplificado.version} · {paquete.simplificado.effective_from.slice(0, 10)}
                </div>
              </section>
            </>
          )}
          {mode === 'register' && legal.status === 'ready' && paquete.status !== 'ready' && (
            <section className="legal-notice" aria-label="Aviso de privacidad">
              {idioma === 'en' && (
                <p className="legal-notice-language" lang="en">
                  This document is only available in Spanish for now.
                </p>
              )}
              <pre lang="es">{legal.value.body}</pre>
              <div className="legal-notice-meta" lang="es">
                Versión {legal.value.version} · {legal.value.effective_from.slice(0, 10)}
              </div>
            </section>
          )}

          {pasoGoogle && tieneCredencial && (
            <button
              className="ingreso-entrar"
              type="button"
              onClick={() => { void onCrearConGoogle(); }}
              disabled={busy || socialBusy || legal.status !== 'ready' || paqueteIncierto || !aceptacionLista
                || !socialActionEligible({
                  mode: 'register',
                  providerActionEnabled: true,
                  autoridad,
                  legalReady: true,
                  firstName,
                  lastName,
                  email,
                  requiereInvitacion: false,
                })}
            >
              {busy ? t('Un segundo…') : t('Crear mi cuenta')}
            </button>
          )}
          {!pasoGoogle && (
          <button
            className="ingreso-entrar"
            type="submit"
            disabled={busy || socialBusy || recoveryBusy
              || (mode === 'register' && legal.status !== 'ready')
              || paqueteIncierto
              || (mode === 'register' && !aceptacionLista)}
          >
            {busy ? t('Un segundo…') : mode === 'login' ? t('Entrar') : t('Registrarme')}
          </button>
          )}

          {/* §5 · el mensaje va DEBAJO de «Entrar» y es obligatorio: el borde
              ámbar de los campos nunca viaja solo. */}
          {error && (
            <div id="login-error" className="ingreso-error" role="alert">
              {error}
            </div>
          )}
          {!error && facebookCallbackPhase === 'error' && (
            <div id="login-error" className="ingreso-error social-callback-error" role="alert">
              <div>{t('No pudimos completar el ingreso. Prueba de nuevo.')}</div>
              <button
                type="button"
                className="login-toggle"
                onClick={clearFacebookCallbackError}
              >
                {t('Continuar')}
              </button>
            </div>
          )}

          {mode === 'login' && social.recovery.enabled && (
            <div className="ingreso-olvido">
              <button
                type="button"
                className="ingreso-olvido-boton"
                onClick={() => { void onRecoveryRequest(); }}
                disabled={busy || socialBusy || recoveryBusy || email.trim().length === 0}
              >
                {recoveryBusy ? t('Un segundo…') : t('¿Olvidaste tu contraseña?')}
              </button>
              {recoveryAccepted && (
                <div className="recovery-request-success" role="status">
                  {t('Si existe una cuenta con ese correo, te enviaremos instrucciones.')}
                </div>
              )}
            </div>
          )}

          {haySocial && (
            <>
              {/* En el paso de Google no hay acción principal de la que Google
                  sea la alternativa: el «O» no tiene a qué oponerse. */}
              {!pasoGoogle && (
                <div className="social-auth-divider" aria-hidden="true">
                  <span>{t('O continúa con')}</span>
                </div>
              )}
              <section className="social-auth-options ingreso-social" aria-busy={socialBusy}>
                {/* 🔴 D-R16 · el aviso sigue vivo y su motivo CAMBIÓ con el
                    rediseño, así que se reescribe en vez de arrastrarse: antes
                    el botón de Google vivía ARRIBA del campo de correo y la
                    persona no tenía dónde mirar. Ahora el correo está justo
                    encima, pero el botón sigue desapareciendo mientras el campo
                    esté vacío, y un control que se esfuma sin decir por qué
                    sigue siendo un callejón sin salida. El aviso ocupa el lugar
                    del botón ausente. */}
                {faltanDatosParaGoogle && (
                  <p className="note note-orange note-datos-google" role="status">
                    {t('Escribe tu nombre y apellido aquí arriba para continuar con Google.')}
                  </p>
                )}
                {faltaCorreoParaAltaSocial && (
                  <p className="note note-orange note-correo-social" role="status">
                    {t('Escribe tu correo aquí arriba para continuar con Google.')}
                  </p>
                )}
                {googleEligible && !capturaGoogle && ranuraGoogle}
                {facebookEligible && (
                  <button
                    type="button"
                    className="social-provider-button social-provider-facebook"
                    onClick={() => { void onFacebook(); }}
                    disabled={socialBusy}
                  >
                    <span>{socialBusy ? t('Un segundo…') : t('Continuar con Facebook')}</span>
                  </button>
                )}
              </section>
            </>
          )}
        </form>
        )}

        {/* §4 · fuera de la tarjeta. La disponibilidad del alta NO cambia: es
            la misma `signupAvailable` de siempre —invitación o
            `public_registration` del dueño—, así que con el alta cerrada este
            enlace no existe, igual que hoy. */}
        {!pasoVincular && (mode === 'register' || signupAvailable) && (
          <div className="ingreso-pie">
            {mode === 'login' ? `${t('¿Primera vez?')} ` : ''}
            <button
              type="button"
              className="login-toggle"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login');
                setError(null);
                setRecoveryAccepted(false);
                clearFacebookCallbackError();
              }}
            >
              {mode === 'login' ? t('Crea tu cuenta') : t('Ya tengo cuenta → entrar')}
            </button>
          </div>
        )}

        {/* 🔴 EL AVISO LEGAL NOMBRA UN SOLO DOCUMENTO. Hasta AF2 era porque los
            Términos no existían y un link a un documento inexistente es un
            callejón sin salida. Desde LEGAL-3.0.0 (AF2) existen —el dueño los
            sirve en `terminos_uso` y este front en `/terminos`—, pero sólo con
            el paquete vigente, y ahí se aceptan con las casillas, no con esta
            nota: el copy de la nota no cambia (orden AF-NOTA-ALTA, sin texto
            nuevo).
            AF-NOTA-ALTA · en «Crea tu cuenta» con el paquete 3.0.0 vigente las
            casillas ya dicen qué se acepta; «Al entrar aceptas el Aviso» sobra
            y contradice que la aceptación sea por casilla. Se deja de dibujar
            SÓLO ahí: en «entrar», y con el paquete apagado, queda como antes. */}
        {!(mode === 'register' && paqueteVigente) && (
          <p className="ingreso-legal">
            {t('Al entrar aceptas el')}{' '}
            <a href={PATH_PRIVACIDAD}>{t('Aviso de privacidad')}</a>.
          </p>
        )}

        {IS_MOCK && (
          <div className="ingreso-mock">
            {t('Modo demo: entra con cualquier email y contraseña.')}
          </div>
        )}
      </div>
    </div>
  );
}
