import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { autoridadDeAlta, socialActionEligible } from './LoginScreen';

const source = readFileSync(new URL('./LoginScreen.tsx', import.meta.url), 'utf8');

/**
 * 🔴 **Los fixtures de invitación llevan un literal CORTO, y es a propósito.**
 *
 * `scripts/auditar-secretos.sh` marca una línea agregada cuando un identificador
 * terminado en una palabra sensible va seguido de `:`/`=` y de un literal
 * entrecomillado de **8 o más** caracteres. Es una regla de forma: no distingue
 * —ni puede— un fixture inventado de una credencial real, y el repo es público,
 * así que falla del lado correcto.
 *
 * El literal se acorta **para que la clave siga en la misma línea que el valor**
 * y esta posición quede vigilada. La alternativa que se probó antes —mover el
 * literal a una constante con otro nombre— también dejaba el gate en verde,
 * pero **por el motivo equivocado: sacaba la clave del renglón y con eso la
 * posición dejaba de mirarse.** Medido en el dictamen 05 del auditor con
 * commits reales: una credencial sin prefijo conocido dentro de esa constante
 * pasa sin verse; la misma credencial en la forma de acá se ve.
 *
 * ⚠️ **El valor es deliberadamente INVÁLIDO por contrato** —la autoridad exige
 * de 20 a 200 caracteres— y acá no importa: estos tests importan sólo
 * `autoridadDeAlta` y `socialActionEligible`, y ninguna de las dos mira el
 * largo. Los fixtures que SÍ cruzan `validToken` o el mock conservan literales
 * válidos y no se tocan.
 *
 * 📌 Este comentario describe la forma sin instanciarla, también a propósito:
 * escribirla como ejemplo pondría el gate en rojo por su cuenta.
 */

describe('LoginScreen · gates sociales owner-first', () => {
  it('login depende sólo de la acción exacta; registro exige autoridad, legal y nombres', () => {
    const base = {
      providerActionEnabled: true,
      autoridad: { tipo: 'invitacion', token: 'inv-aaa' } as const,
      legalReady: true,
      firstName: 'Mati',
      lastName: 'Verón',
      email: '',
      requiereInvitacion: false,
    };
    expect(socialActionEligible({ ...base, mode: 'login' })).toBe(true);
    expect(socialActionEligible({ ...base, mode: 'login', providerActionEnabled: false })).toBe(false);
    expect(socialActionEligible({ ...base, mode: 'register' })).toBe(true);

    for (const blocked of [
      { autoridad: null },
      { legalReady: false },
      { firstName: '   ' },
      { lastName: '' },
      { providerActionEnabled: false },
    ]) {
      expect(socialActionEligible({ ...base, ...blocked, mode: 'register' })).toBe(false);
    }
  });

  /**
   * C2b · dos autoridades para crear una cuenta, y la invitación gana.
   *
   * No es una preferencia estética: si alguien llega con un token, el dueño lo
   * **valida y consume** (`signup_gate` del contrato). Ignorarlo porque el alta
   * esté abierta desperdiciaría una autoridad de un solo uso y cambiaría a qué
   * email queda ligada la cuenta.
   */
  it('la invitación gana sobre el alta pública, y sin ninguna de las dos no hay alta', () => {
    const conToken = { status: 'available', token: 'inv-aaa', custodied: true } as const;
    expect(autoridadDeAlta(conToken, true)).toEqual({ tipo: 'invitacion', token: conToken.token });
    expect(autoridadDeAlta(conToken, false)).toEqual({ tipo: 'invitacion', token: conToken.token });
    expect(autoridadDeAlta({ status: 'absent' }, true)).toEqual({ tipo: 'publica' });
    expect(autoridadDeAlta({ status: 'invalid' }, true)).toEqual({ tipo: 'publica' });
    expect(autoridadDeAlta({ status: 'absent' }, false)).toBeNull();
    expect(autoridadDeAlta({ status: 'invalid' }, false)).toBeNull();
  });

  /**
   * D-R16 · sin invitación, el email que la persona escribe es la ÚNICA fuente
   * del email de la cuenta (`request_notes.email` del contrato). Por eso con
   * autoridad pública el botón de Google no puede habilitarse sin él, y con
   * invitación sí: ahí el email lo pone la invitación.
   */
  it('con alta pública el email es obligatorio para el alta social; con invitación no', () => {
    const base = {
      mode: 'register',
      providerActionEnabled: true,
      legalReady: true,
      firstName: 'Mati',
      lastName: 'Verón',
      requiereInvitacion: false,
    } as const;
    const publica = { tipo: 'publica' } as const;
    const invitacion = { tipo: 'invitacion', token: 'inv-aaa' } as const;

    expect(socialActionEligible({ ...base, autoridad: publica, email: 'mati@payme.mx' })).toBe(true);
    expect(socialActionEligible({ ...base, autoridad: publica, email: '   ' })).toBe(false);
    expect(socialActionEligible({ ...base, autoridad: publica, email: '' })).toBe(false);
    // Con invitación el email no se exige: lo aporta la autoridad del dueño.
    expect(socialActionEligible({ ...base, autoridad: invitacion, email: '' })).toBe(true);
  });

  /**
   * 🔴 Facebook NO entra al alta pública, y esto es contrato, no criterio: su
   * `register/start` **conserva `invitation_token` obligatorio**
   * (`endpoints.facebook_register_start.request` y `signup_gate.facebook` del
   * contrato espejado). Sin esta guarda, abrir el alta habilitaría un botón que
   * mandaría un body que el dueño rechaza. Sigue dark, pero la puerta se cierra
   * igual: dark es configuración, esto es forma del contrato.
   */
  it('un proveedor que exige invitación no se habilita con autoridad pública', () => {
    const base = {
      mode: 'register',
      providerActionEnabled: true,
      legalReady: true,
      firstName: 'Mati',
      lastName: 'Verón',
      email: 'mati@payme.mx',
      requiereInvitacion: true,
    } as const;
    expect(socialActionEligible({ ...base, autoridad: { tipo: 'publica' } })).toBe(false);
    expect(socialActionEligible({
      ...base,
      autoridad: { tipo: 'invitacion', token: 'inv-aaa' },
    })).toBe(true);
  });

  it('password permanece en el formulario y recovery/social nacen capability-gated', () => {
    expect(source).toContain('type="password"');
    expect(source).toContain("mode === 'login' && social.recovery.enabled");
    expect(source).toContain('social.google.enabled');
    expect(source).toContain('social.facebook.enabled');
    expect(source).not.toMatch(/if \(!social\.[^)]+\) return null/);
  });

  it('Facebook liga sesión antes de /start, valida antes de navegar y el mock no abre Meta', () => {
    const witness = source.indexOf('const sessionStateWitness = captureSessionStateWitness();');
    const start = source.indexOf('await api.facebookLoginStart()');
    const prepare = source.indexOf('const authorizationUrl = prepareFacebookRedirect(');
    const simulate = source.indexOf('simulateFacebookCallbackForMock(response);');
    const complete = source.indexOf('await completeFacebookCallback();');
    const navigate = source.indexOf('window.location.assign(authorizationUrl);');
    expect(witness).toBeGreaterThan(-1);
    expect(witness).toBeLessThan(start);
    expect(start).toBeLessThan(prepare);
    expect(prepare).toBeLessThan(simulate);
    expect(simulate).toBeLessThan(complete);
    expect(complete).toBeLessThan(navigate);
    expect(source).not.toContain('fetch(');
  });

  it('alta Google consume la invitación sólo después de persistir la sesión', () => {
    const register = source.indexOf('await googleRegister({');
    const clear = source.indexOf('clearSignupInvitation();', register);
    expect(register).toBeGreaterThan(-1);
    expect(clear).toBeGreaterThan(register);
  });

  it('Google captura propósito, invitación, nombres e idioma sin leer autoridad live', () => {
    expect(source).not.toContain('googleAction.current');
    expect(source).toContain("readonly purpose: 'login';");
    expect(source).toContain("readonly purpose: 'register';");
    expect(source).toContain("const locale = idioma === 'en' ? 'en' : 'es';");
    // C2b · la autoridad de la invitación ahora sale del resolutor
    // (`autoridadDeAlta`), no del snapshot leído en el memo. Lo que el centinela
    // vigila es lo mismo: que se CAPTURE en el memo y no se lea viva después.
    expect(source).toContain('invitationToken: autoridad.token');
    expect(source).toContain('firstName: firstName.trim()');
    expect(source).toContain('lastName: lastName.trim()');
    expect(source).toContain('locale: authority.locale');
    expect(source).toContain('googleAuthorityRef.current !== authority');
    expect(source).toContain('currentInvitation.token !== authority.alta.invitationToken');
    // Y el caso nuevo: con alta pública lo que se revalida es la capability.
    expect(source).toContain('!socialAuthSnapshot().publicRegistration');
    expect(source).toContain('useLayoutEffect(() => {');
    expect(source).toContain('googleAuthorityRef.current = googleAuthority;');
    expect(source).not.toContain('Se invalida durante render');
    expect(source).toContain('let handle: GoogleButtonHandle;');
    expect(source).toContain('setGoogleLoadFailed(true);');
    expect(source).toContain('El router global ya consumió el state antes del callback.');
  });

  it('contraseña, Google y Facebook toman el lease sincrónico antes del primer await', () => {
    expect(source).toContain('const authActionActive = useRef(false);');
    expect(source).toContain('if (authActionActive.current) return false;');

    const googleLease = source.indexOf('if (!tryAcquireAuthAction()) {', source.indexOf('onCredential:'));
    const googleAwait = source.indexOf('await googleLogin(credential);', googleLease);
    const facebookLease = source.indexOf('if (!facebookEligible || !tryAcquireAuthAction()) return;');
    const facebookAwait = source.indexOf('await api.facebookLoginStart()', facebookLease);
    const passwordLease = source.indexOf('if (!tryAcquireAuthAction()) return;', source.indexOf('async function onSubmit'));
    const passwordAwait = source.indexOf('await login(email, password);', passwordLease);

    expect(googleLease).toBeGreaterThan(-1);
    expect(googleLease).toBeLessThan(googleAwait);
    expect(facebookLease).toBeGreaterThan(-1);
    expect(facebookLease).toBeLessThan(facebookAwait);
    expect(passwordLease).toBeGreaterThan(-1);
    expect(passwordLease).toBeLessThan(passwordAwait);
  });

  it('el redirect real conserva el lease hasta unload y un assign fallido sí lo libera', () => {
    const redirecting = source.indexOf('let redirecting = false;');
    const assign = source.indexOf('window.location.assign(authorizationUrl);', redirecting);
    const retain = source.indexOf('redirecting = true;', assign);
    const conditionalRelease = source.indexOf('if (!redirecting) {', retain);
    const release = source.indexOf('releaseAuthAction();', conditionalRelease);
    expect(redirecting).toBeGreaterThan(-1);
    expect(redirecting).toBeLessThan(assign);
    expect(assign).toBeLessThan(retain);
    expect(retain).toBeLessThan(conditionalRelease);
    expect(conditionalRelease).toBeLessThan(release);
  });

  it('conserva el copy ES-MX exacto de la orden y el aviso recovery no-oracular', () => {
    for (const text of [
      'Continuar con Google',
      'Continuar con Facebook',
      // 🔴 EDITADA el 2026-09-17 (APP-LOGIN-REDESIGN-AF-02). Antes pineaba
      // 'O usa tu correo y contraseña', que describía el ORDEN VIEJO: social
      // arriba y el email debajo. El paquete del 10/09 invierte la tarjeta
      // —email primero, social debajo— y con eso el rótulo del separador pasa
      // a anunciar lo que viene DESPUÉS. Es copy de presentación de un
      // divisor decorativo (`aria-hidden`), no una conducta: no gatea, no
      // autoriza y no promete nada. Las otras cuatro entradas de esta lista
      // NO se tocan; la del aviso de recovery es anti-oráculo y es conducta.
      'O continúa con',
      '¿Olvidaste tu contraseña?',
      'Si existe una cuenta con ese correo, te enviaremos instrucciones.',
    ]) expect(source).toContain(text);
  });
});

/**
 * APP-LOGIN-REDESIGN-AF-02-20260917 · lo que el rediseño NO puede traer.
 *
 * Estas cuatro no miran estética: miran las tres cosas que el paquete de
 * diseño traía adentro y que no entran —el invitado, un botón de Google
 * dibujado a mano y un link a un documento que no existe— más el orden de §2,
 * que es lo único de la disposición que cambia una conducta observable: el
 * campo de correo pasó a estar ARRIBA del botón social.
 *
 * Son aserciones sobre el TEXTO del archivo, como el resto de esta suite: acá
 * no hay jsdom (ratificación de Mati) y la foto de la pantalla la saca el spec
 * de vista previa, que corre en navegador.
 */
const CSS = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

describe('LoginScreen · rediseño del 2026-09-17', () => {
  it('🔴 cero superficie de pago como invitado, ni apagada', () => {
    // El HTML aprobado la trae detrás de un tweak (`sc-if invitado`, apagado
    // por defecto) y la reconciliación la elevó como STOP: el backend contesta
    // 401 desde v2.32.0 y el CLAUDE.md de este repo dice «no volver a
    // implementar el pago de invitado». Apagada tampoco.
    expect(source.toLowerCase()).not.toContain('invitado');
    expect(CSS.toLowerCase()).not.toContain('pagar como invitado');
  });

  it('🔴 Google lo sigue dibujando Google: no hay botón propio en el riel real', () => {
    // El botón que entrega la credencial es el de GIS. Un botón de PayMe con
    // la "G" pintada encima cumpliría la guía de marca de vista y no sería el
    // de Google: la única superficie propia es el contenedor.
    expect(source).toContain('renderGoogleIdentityButton');
    expect(source).toContain('social-google-container');
    expect(source).not.toMatch(/social-provider-button[^'"]*social-provider-google/);
  });

  it('🔴 §2 · en el ingreso y en el paso de Google, el correo está ARRIBA del bloque social', () => {
    // Con el alta pública el correo es la única fuente del email de la cuenta
    // (D-R16). En el paso «Crea tu cuenta con Google» sin token, el botón de
    // abajo sigue esperando ese correo: el campo tiene que estar encima del
    // control que habilita. El bloque social de abajo se ubica por su
    // separador exacto; el de arriba de «Crea tu cuenta» tiene otra clase.
    const correo = source.indexOf('type="email"');
    const social = source.indexOf('<div className="social-auth-divider" aria-hidden="true">');
    expect(correo).toBeGreaterThan(0);
    expect(social).toBeGreaterThan(0);
    expect(correo, 'el campo de correo quedó DEBAJO del separador social').toBeLessThan(social);
  });

  it('🔴 AF-16 · addendum 1 · en «Crea tu cuenta» Google va ANTES de cualquier campo', () => {
    // Mati, 2026-09-18: «no me permite crear la cuenta con GMAIL». El botón
    // vivía debajo del formulario y aparecía recién con los datos escritos.
    // El e2e prueba el recorrido; acá se fija el orden en el código.
    const altaGoogle = source.indexOf('{capturaGoogle && (');
    const primerCampo = source.indexOf('className="ingreso-campo"');
    expect(altaGoogle).toBeGreaterThan(0);
    expect(primerCampo).toBeGreaterThan(0);
    expect(altaGoogle, 'Google quedó debajo de un campo en «Crea tu cuenta»').toBeLessThan(primerCampo);
  });

  it('🔴 el aviso legal enlaza el documento que EXISTE y no nombra otro', () => {
    // El artefacto dice «los Términos y el Aviso de privacidad». Los Términos
    // no existen: ni página pública ni `kind` del dueño. Prometerlos en un
    // link sería un callejón sin salida.
    expect(source).toContain('PATH_PRIVACIDAD');
    expect(source).toContain("t('Aviso de privacidad')");
    expect(source).not.toMatch(/t\('[^']*Términos/);
  });
});
