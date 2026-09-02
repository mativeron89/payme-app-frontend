import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { modeAfterSignupSnapshot } from '../screens/LoginScreen';

const SOURCES = import.meta.glob(['/src/**/*.ts', '/src/**/*.tsx'], {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

function source(path: string): string {
  const value = SOURCES[`/src/${path}`];
  if (typeof value !== 'string') throw new Error(`fuente no encontrada: ${path}`);
  return value;
}

describe('D-FF-1 · cableado owner→formulario', () => {
  const login = source('screens/LoginScreen.tsx');
  const join = source('screens/JoinMesaScreen.tsx');
  const main = source('main.tsx');
  const api = source('api/index.ts');
  const mock = source('api/mock/mockApi.ts');
  const auth = source('auth/AuthContext.tsx');

  it('la custodia corre antes de React y ambas superficies leen el mismo snapshot', () => {
    expect(main).toContain('bootstrapSignupInvitationCustody();');
    expect(main.indexOf('bootstrapSignupInvitationCustody();'))
      .toBeLessThan(main.indexOf('createRoot(el).render('));
    expect(login).toContain('useSyncExternalStore(');
    expect(join).toContain('useSyncExternalStore(');
    expect(login).not.toMatch(/key=\{[^}]*signup\.token/);
    expect(login).not.toMatch(/console\.[a-z]+\([^)]*signup\.token/);
    expect(login).not.toMatch(/>\s*\{signup\.token\}\s*</);
  });

  it('el primer snapshot no pisa “Ya tengo cuenta”; una navegación posterior sí reacciona', () => {
    expect(modeAfterSignupSnapshot('login', false, true)).toBe('login');
    expect(modeAfterSignupSnapshot('register', false, false)).toBe('register');
    expect(modeAfterSignupSnapshot('login', true, true)).toBe('register');
    expect(modeAfterSignupSnapshot('register', true, false)).toBe('login');
  });

  it('manda la autoridad y la limpia sólo después de que cada alta confirmó sesión', () => {
    const passwordSend = login.indexOf('await register({');
    // C2b · el token ya no sale del snapshot sino del resolutor de autoridad, y
    // viaja SÓLO si la autoridad es una invitación. Lo que este centinela vigila
    // no cambia: que se mande antes de limpiar y que se limpie recién con la
    // sesión confirmada.
    const passwordToken = login.indexOf('invitation_token: autoridad.token', passwordSend);
    const passwordClear = login.indexOf('clearSignupInvitation()', passwordToken);
    expect(passwordSend).toBeGreaterThan(-1);
    expect(passwordToken).toBeGreaterThan(passwordSend);
    expect(passwordClear).toBeGreaterThan(passwordToken);

    const googleSend = login.indexOf('await googleRegister({');
    const googleToken = login.indexOf('invitation_token: authority.alta.invitationToken', googleSend);
    const googleClear = login.indexOf('clearSignupInvitation()', googleToken);
    expect(googleSend).toBeGreaterThan(-1);
    expect(googleToken).toBeGreaterThan(googleSend);
    expect(googleClear).toBeGreaterThan(googleToken);
    expect(login.match(/clearSignupInvitation\(\)/g)).toHaveLength(2);

    const facebookSend = auth.indexOf('await api.facebookRegisterComplete(');
    const facebookClear = auth.indexOf("if (purpose === 'register') clearSignupInvitation();", facebookSend);
    expect(facebookSend).toBeGreaterThan(-1);
    expect(facebookClear).toBeGreaterThan(facebookSend);
    expect(auth.match(/clearSignupInvitation\(\)/g)).toHaveLength(1);
  });

  it('un 403 opaco no se interpreta ni suelta la credencial', () => {
    const mapping = login.slice(
      login.indexOf('registration_not_available:'),
      login.indexOf('registration_unavailable:'),
    );
    // 🔴 D-R15 · el copy es opaco y, desde C2b, TAMPOCO nombra la invitación:
    // con el alta abierta la persona no usó ninguna, así que hablar de «esta
    // invitación» describía un objeto inexistente. Sigue sin interpretar el
    // motivo, que es lo que este centinela protege desde el principio.
    expect(mapping).toContain('No pudimos crear la cuenta');
    expect(mapping).not.toMatch(/invitaci/i);
    expect(mapping).not.toMatch(/expired|used|email_mismatch|already_registered/i);
  });

  /**
   * 🔴 La entrada dormida que se retiró, y por qué tiene test propio.
   *
   * `email_already_registered` estaba en el mapa de errores del alta. El dueño
   * no lo emite —con el alta abierta un email tomado devuelve el MISMO 403
   * opaco—, así que era código muerto… hasta el día que algún backend lo
   * mandara: ahí la pantalla habría dicho «Ese email ya está registrado» y se
   * habría convertido en un oráculo de existencia de cuentas, que es justo lo
   * que la antienumeración del dueño evita. Se retira del camino de alta y este
   * test impide que vuelva de buena fe.
   */
  /**
   * 🔴 Las DOS superficies que ofrecen crear cuenta tienen que leer la MISMA
   * autoridad, y una de ellas se olvidó una vez.
   *
   * `JoinMesaScreen` gateaba «Crear cuenta gratis» con la invitación de ALTA,
   * que es un objeto distinto del `?t=` que trajo a la persona hasta ahí. Con el
   * alta pública abierta y sin invitación, el 401 le decía «necesitás cuenta» y
   * la pantalla no le ofrecía crearla: un callejón sin salida con cartel. Este
   * centinela impide que vuelva a divergir del formulario.
   */
  it('la entrada por link y el formulario leen la misma autoridad de alta', () => {
    const join = readFileSync(new URL('../screens/JoinMesaScreen.tsx', import.meta.url), 'utf8');
    expect(join).toContain('autoridadDeAlta(signup, social.publicRegistration) !== null');
    expect(join).not.toMatch(/signupAvailable = signup\.status === 'available'/);
  });

  it('el mapa de errores del alta no puede afirmar que un email exista', () => {
    const mapa = login.slice(
      login.indexOf('const ERROR_TEXT'),
      login.indexOf('function errorMessage'),
    );
    expect(mapa).not.toContain('email_already_registered');
    expect(mapa).not.toMatch(/ya está registrad/i);
  });

  it('si el aviso pierde integridad entre GET y POST, vuelve a cerrar el alta', () => {
    expect(login).toContain("code === 'registration_unavailable'");
    expect(login).toContain("setLegal({ status: 'error' })");
    expect(login).toContain("legal.status !== 'ready'");
  });

  it('la invitación de mesa no crea autoridad de alta', () => {
    expect(join).toContain('signupInvitationSnapshot');
    expect(join).toContain('{signupAvailable && (');
    expect(join).not.toContain('invitation_token: token');
  });

  it('real y mock pasan por el aviso/decoder y el mock tampoco ofrece alta abierta', () => {
    expect(api).toContain("'/legal/aviso_privacidad'");
    expect(api.match(/legalTextResponse/g)?.length).toBeGreaterThanOrEqual(3);
    expect(mock).toContain("throw new MockApiError(403, 'registration_not_available')");
  });
});
