import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IdiomaProvider } from '../i18n/idioma';
import { PuertaLegalView, puertaLista } from './PuertaLegal';
import type { StoredSession } from '../api/storage';

function render(aceptaMayor: boolean, aceptaTerminos: boolean, busy = false, error: string | null = null): string {
  return renderToStaticMarkup(
    <IdiomaProvider>
      <PuertaLegalView
        aceptaMayor={aceptaMayor}
        aceptaTerminos={aceptaTerminos}
        busy={busy}
        error={error}
        onAceptaMayor={() => undefined}
        onAceptaTerminos={() => undefined}
        onContinuar={() => undefined}
        onCerrarSesion={() => undefined}
      />
    </IdiomaProvider>,
  );
}

describe('AF2 · puerta de aceptación para quien ya tiene cuenta (decisiones 40, 44, 45)', () => {
  it('muestra los textos aprobados, los dos enlaces y las dos salidas', () => {
    const html = render(false, false);
    expect(html).toContain('Actualizamos nuestros documentos');
    expect(html).toContain('Para seguir usando PayMe, confirma lo siguiente:');
    expect(html).toContain('Declaro que tengo 18 años o más.');
    expect(html).toContain('He leído y acepto los');
    expect(html).toContain('href="/terminos"');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('se mostrará a tus amigos y a quien organice una mesa');
    expect(html).toContain('PayMe es sólo para personas de 18 años o más.');
    expect(html).toContain('Continuar');
    expect(html).toContain('Cerrar sesión');
    // No hay forma de cerrarla: ni «Ahora no» ni una cruz.
    expect(html).not.toContain('Ahora no');
    expect(html).toContain('aria-modal="true"');
  });

  it('«Continuar» sólo se habilita con las DOS casillas marcadas', () => {
    const boton = (html: string) => /<button[^>]*class="ingreso-entrar"[^>]*>/.exec(html)![0];
    expect(boton(render(false, false))).toContain('disabled=""');
    expect(boton(render(true, false))).toContain('disabled=""');
    expect(boton(render(false, true))).toContain('disabled=""');
    expect(boton(render(true, true))).not.toContain('disabled=""');
    expect(boton(render(true, true, true))).toContain('disabled=""');
  });

  it('un error se dice sin cerrar la puerta', () => {
    const html = render(true, true, false, 'No pudimos guardar tu confirmación. Prueba de nuevo.');
    expect(html).toContain('role="alert"');
    expect(html).toContain('No pudimos guardar tu confirmación');
    expect(html).toContain('Continuar');
  });
});

/**
 * AF-PUERTA-JOIN · `puertaLista` decide si `JoinMesaScreen` puede canjear. Se
 * prueba la función pura porque el orden de los efectos (hijo antes que padre)
 * es justo lo que el `useEffect` no deja ver en esta suite sin librería de render.
 */
describe('AF-PUERTA-JOIN · la puerta está lista sólo para la sesión que consultó', () => {
  const s1 = { principal_id: 'p1' } as unknown as StoredSession;
  const s2 = { principal_id: 'p2' } as unknown as StoredSession;
  const aceptacion = { required: true, aviso: { version: '3.0.0', hash: 'a'.repeat(64) }, terminos: { version: '1.0.0', hash: 'b'.repeat(64) } };

  it('abierta o cerrada para ESTA sesión: lista', () => {
    expect(puertaLista({ estado: { fase: 'abierta' }, sesion: s1 }, s1)).toBe(true);
    expect(puertaLista({ estado: { fase: 'cerrada', aceptacion }, sesion: s1 }, s1)).toBe(true);
  });

  it('en vuelo: no lista', () => {
    expect(puertaLista({ estado: { fase: 'consultando' }, sesion: s1 }, s1)).toBe(false);
  });

  it('🔴 el «abierta» de la sesión nula (o de otra) no vale para la que acaba de entrar', () => {
    // Es el render en el que la persona entra desde el link: el hijo canjearía
    // antes de que el hook consulte.
    expect(puertaLista({ estado: { fase: 'abierta' }, sesion: null }, s1)).toBe(false);
    expect(puertaLista({ estado: { fase: 'abierta' }, sesion: s2 }, s1)).toBe(false);
  });
});
