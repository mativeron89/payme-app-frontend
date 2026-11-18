import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { minimoPorEntrada } from '../splash';
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
});
