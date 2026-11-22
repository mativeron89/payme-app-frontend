import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FotosAlVolver, type FotoAlVolver } from './FotosAlVolver';

const nada = (): void => undefined;
const fotos = (n: number): FotoAlVolver[] =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, miniatura: `blob:mini-${i + 1}`, vista: `blob:vista-${i + 1}` }));

function marcado(opciones: { n: number; previas?: number; max?: number; aviso?: number | null; lista?: FotoAlVolver[] }): string {
  return renderToStaticMarkup(
    <FotosAlVolver
      fotos={opciones.lista ?? fotos(opciones.n)}
      previas={opciones.previas ?? 0}
      max={opciones.max ?? 4}
      aviso={opciones.aviso ?? null}
      titulo="Escanea el ticket"
      onSacarOtra={nada}
      onListo={nada}
      onQuitar={nada}
      onSalir={nada}
    />,
  );
}

const botonOtra = (html: string) => html.match(/<button[^>]*aria-label="Sacar otra foto"[^>]*>/)?.[0];

describe('D547 · FotosAlVolver', () => {
  it('🔴 con una foto: su miniatura numerada, «+» habilitado y el ✓ con nombre', () => {
    const html = marcado({ n: 1 });
    expect(html).toContain('<h1 class="camara-titulo" tabindex="-1">Escanea el ticket</h1>');
    expect(html).toContain('Sacaste 1 foto.');
    expect(html).toContain('aria-label="Ver la foto 1"');
    // La fila dibuja la miniatura chica, nunca la vista grande (ni el original, que la pantalla no recibe).
    expect(html).toContain('src="blob:mini-1"');
    expect(html).toContain('src="blob:vista-1"');
    expect(html).toContain('<span class="fotos-al-volver-numero" aria-hidden="true">1</span>');
    const otra = botonOtra(html);
    expect(otra).toBeDefined();
    expect(otra).not.toContain('disabled');
    const listo = html.match(/<button[^>]*class="fotos-al-volver-listo"[^>]*>/)?.[0];
    expect(listo).toContain('aria-label="Listo, ajustar el recuadro"');
    expect(listo).not.toContain('disabled');
    // Sin el tope, sin su línea; sin aviso, sin alerta.
    expect(html).not.toContain('el máximo por ticket');
    expect(html).not.toContain('role="alert"');
  });

  it('🔴 el orden: la fila de miniaturas va antes que el ✓ en la franja de abajo (izquierda y derecha)', () => {
    const html = marcado({ n: 2 });
    const abajo = html.slice(html.indexOf('fotos-al-volver-abajo'));
    expect(abajo.indexOf('fotos-al-volver-fila')).toBeLessThan(abajo.indexOf('fotos-al-volver-listo'));
  });

  it('🔴 con las partes de antes, numera desde ahí y las cuenta para el tope', () => {
    const html = marcado({ n: 2, previas: 2 });
    expect(html).toContain('Sacaste 4 fotos.');
    expect(html).toContain('aria-label="Ver la foto 3"');
    expect(html).toContain('aria-label="Ver la foto 4"');
    expect(botonOtra(html)).toContain('disabled');
    expect(html).toContain('Ya tienes 4 fotos, el máximo por ticket.');
  });

  it('🔴 con 4: «+» deshabilitado, la línea que lo explica y el ✓ habilitado', () => {
    const html = marcado({ n: 4 });
    expect(botonOtra(html)).toContain('disabled');
    expect(html).toContain('Ya tienes 4 fotos, el máximo por ticket.');
    expect(html).not.toContain('Toca ✓ para ajustar el recuadro.');
    expect(html.match(/<button[^>]*class="fotos-al-volver-listo"[^>]*>/)?.[0]).not.toContain('disabled');
  });

  it('el tope es el del dueño, no un 4 fijo', () => {
    expect(botonOtra(marcado({ n: 2, max: 2 }))).toContain('disabled');
    expect(botonOtra(marcado({ n: 3, max: 4 }))).not.toContain('disabled');
  });

  it('🔴 el aviso de una foto que no se pudo usar, con su número', () => {
    const html = marcado({ n: 2, aviso: 2 });
    expect(html).toContain('role="alert"');
    expect(html).toContain('No pudimos usar la foto 2. Quítala y saca otra.');
  });

  it('🔴 auditoría de PR108, punto 4 · mientras la miniatura se prepara (o si no se pudo), un ícono y ninguna imagen', () => {
    const html = marcado({ n: 1, lista: [{ id: 1, miniatura: null, vista: null }] });
    expect(html).not.toContain('<img');
    expect(html).toContain('class="fotos-al-volver-sin-mini"');
    // Igual se puede abrir, quitar y pasar al recuadro.
    expect(html).toContain('aria-label="Ver la foto 1"');
    expect(html.match(/<button[^>]*class="fotos-al-volver-listo"[^>]*>/)?.[0]).not.toContain('disabled');
  });

  it('muestra la última foto sin abrir un diálogo', () => {
    const html = marcado({ n: 2 });
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('role="alertdialog"');
    expect(html).toContain('src="blob:vista-2"');
    expect(html).not.toContain('src="blob:vista-1"');
  });
});
