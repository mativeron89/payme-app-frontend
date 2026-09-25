import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IdiomaProvider } from '../i18n/idioma';
import { PuertaLegalView } from './PuertaLegal';

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
