import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { minimoPorEntrada } from '../splash';
import { joinLinkMessage } from './joinLinkView';
import { settleInvitationFailure } from './invitationCustody';
import { traducir } from '../i18n/idioma';
const source = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
describe('UX ampliada', () => {
  it('K18 · explicación ES/EN y compartir nativo condicionado', () => {
    const s = source('./CreateMesaFlow.tsx');
    const text = 'La eliges tú para toda la mesa y se reparte según lo que consumió cada quien. Es voluntaria y puedes cambiarla después.';
    expect(s).toContain(text);
    expect(traducir(text, 'en')).toBe("You set it for the whole table and it's split by what each person had. It's optional and you can change it later.");
    expect(s).toContain("typeof navigator.share === 'function'");
    expect(s).toContain('compartirTexto(');
  });
  it('K19 · link y QR 1 s; resto 4 s; Google principal sin alterar autoridad', () => {
    for (const hash of ['#/mesa/PA-2847?t=ejemplo', '#/mesa/PA-2847']) expect(minimoPorEntrada(hash)).toBe(1000);
    expect(minimoPorEntrada('', '/mesa/PA-2847')).toBe(1000);
    expect(minimoPorEntrada('', '/', '?r=ejemplo')).toBe(1000);
    for (const hash of ['', '#/home', '#/mas']) expect(minimoPorEntrada(hash)).toBe(4000);
    expect(source('./LoginScreen.tsx')).toContain('ingreso-desde-mesa');
  });
  it('K20 · acciones de texto y confirmación dentro de la app', () => {
    const s = source('./SocialScreen.tsx');
    expect(s).not.toContain('window.confirm');
    expect(s).toContain('useHojaModal');
    expect(s).toContain("t('Quitar de amigos')");
    expect(s).toContain("t('Bloquear a {0}'");
    expect(s).toContain('aria-expanded={');
  });
  it('K21 · enlaces vigentes y correo de baja con asunto fijo', () => {
    const s = source('./MasScreen.tsx');
    for (const text of ['Legal y ayuda', 'Aviso de privacidad', 'Términos de uso', 'Escríbenos: soporte@paymemx.com', 'Eliminar mi cuenta']) expect(s).toContain(text);
    expect(s).toContain('href={PATH_PRIVACIDAD}'); expect(s).toContain('href={PATH_TERMINOS}');
    expect(s).toContain('mailto:soporte@paymemx.com?subject=Solicitud%20de%20baja%20de%20cuenta%20PayMe');
  });
  it('K22 · errores sin jerga y familia única de tarjeta', () => {
    const create = source('./CreateMesaFlow.tsx'); const pay = source('./MesaScreen.tsx');
    expect(create).toContain("t('No pudimos abrir la mesa. Prueba de nuevo.')");
    expect(create).toContain("t('No encontramos ese restaurante.')");
    for (const s of [create, pay]) {
      expect(s).not.toMatch(/t\('([^']*(?:tokenizar|reconciliación|reconciliar)[^']*)'\)/i);
      expect(s).toContain('Estamos confirmando un intento anterior. No se hizo ningún cobro nuevo. Vuelve a intentar en unos minutos.');
      expect(s).toContain("t('Revisar de nuevo')");
    }
  });
  it('K23 · 403,409,410 neutros; solicitudes llenas distintas; red reintentable', () => {
    for (const status of [403,409,410]) {
      const m = joinLinkMessage(settleInvitationFailure(status));
      expect(m.title).toBe('No pudimos sumarte a esta mesa.'); expect(m.body).toBe(''); expect(m.retryable).toBe(false);
    }
    const m = joinLinkMessage(settleInvitationFailure(409, 'join_requests_full'));
    expect(m.title).toBe('Esta mesa tiene muchas solicitudes pendientes. Pídele a quien la abrió que acepte las que tiene.');
    expect(m.retryable).toBe(false);
    expect(joinLinkMessage(settleInvitationFailure(null)).retryable).toBe(true);
    expect(traducir(m.title, 'en')).toBe('This table has a lot of pending requests. Ask whoever opened it to accept the ones they have.');
    const code = source('../components/UnirmeConCodigo.tsx'); expect(code).toContain("code === 'join_requests_full'"); expect(code).toContain(m.title);
  });
});
