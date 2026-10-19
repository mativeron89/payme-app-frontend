import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { avisoDeFotos, duenoDelAviso, informarAvisoDeFotos, reiniciarAvisoDeFotosParaTests } from './avisoDeFotos';

afterEach(() => reiniciarAvisoDeFotosParaTests());

describe('enmienda 10 · el estado del aviso «Tu foto entre amigos», por cuenta y familia', () => {
  it('sin informar, no se sabe; lo informado vale sólo para esa cuenta y familia', () => {
    const a = duenoDelAviso({ family_id: 'f1', principal_id: 'p1' })!;
    const otra = duenoDelAviso({ family_id: 'f1', principal_id: 'p2' })!;
    expect(a).toBe('f1:p1');
    expect(avisoDeFotos(a)).toBe('sin-saber');
    informarAvisoDeFotos(a, 'pendiente');
    expect(avisoDeFotos(a)).toBe('pendiente');
    expect(avisoDeFotos(otra)).toBe('sin-saber');
    expect(avisoDeFotos(null)).toBe('sin-saber');
    informarAvisoDeFotos(a, 'resuelto');
    expect(avisoDeFotos(a)).toBe('resuelto');
    expect(duenoDelAviso(null)).toBeNull();
  });
});

describe('enmienda 10 · el cableado (la fuente)', () => {
  it('el aviso informa su estado y se marca con data-guia-espera; el motor lo trata como una ventana', () => {
    const aviso = readFileSync(new URL('../components/FriendAvatarNotice.tsx', import.meta.url), 'utf8');
    expect(aviso).toContain(`useInformarAvisoDeFotos(session ? \`\${session.family_id}:\${session.principal_id}\` : null,
    !consultaLista ? 'sin-saber' : ready !== null ? 'pendiente' : 'resuelto');`);
    expect(aviso).toContain("aria-label={t('Actualización del Aviso de Privacidad')} data-guia-espera=\"\">");
    const motor = readFileSync(new URL('./GuiaContenido.tsx', import.meta.url), 'utf8');
    expect(motor).toContain(`querySelectorAll<HTMLElement>('[aria-modal="true"], dialog[open], [data-guia-espera]')`);
    // La tarjeta y la fila lo leen.
    expect(readFileSync(new URL('./TarjetaTutorial.tsx', import.meta.url), 'utf8')).toContain('const avisoDeFotos = useAvisoDeFotos();');
    expect(readFileSync(new URL('./AccesoGuia.tsx', import.meta.url), 'utf8')).toContain('avisoDeFotos: useAvisoDeFotos()');
  });
});
