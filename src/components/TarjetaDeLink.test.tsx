import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TarjetaDeLink } from './TarjetaDeLink';
import { CuadroDeTarjeta, ICONOS_DE_LA_INVITACION, ICONOS_DE_TARJETA } from './TarjetaDeTitulo';

/**
 * 🔴 D372 · la tarjeta de «Te invitaron a una mesa». La geometría y los colores computados los mide
 * `e2e/invitacion-estados.spec.ts`; acá, la estructura: un solo título, qué va adentro y qué afuera, el aro que se
 * oye y los dos íconos del canvas.
 */

/** Los `d` del canvas `App-Te-invitaron-a-una-mesa.dc.html` (764c46e2…), `IC.link` e `IC.retry`, tal cual. */
const DEL_CANVAS = {
  'link-cortado': 'M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1M4 4l16 16',
  reintentar: 'M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6',
};

const contar = (html: string, patron: RegExp) => html.match(patron)?.length ?? 0;

describe('🔴 D372 · la tarjeta de la invitación', () => {
  it('un solo <h1> (el título), ningún <h2>; el cuerpo y las acciones van ADENTRO de la tarjeta', () => {
    const html = renderToStaticMarkup(
      <TarjetaDeLink cuadro={{ icono: 'persona-mas' }} titulo="Te invitaron a una mesa" cuerpo="Cuerpo">
        <button type="button">Uno</button>
      </TarjetaDeLink>,
    );
    expect(contar(html, /<h1\b/g)).toBe(1);
    expect(html).toContain('<h1 class="title-card-title">Te invitaron a una mesa</h1>');
    expect(html).not.toContain('<h2');
    expect(html).toMatch(/^<section class="title-card">[^]*<p class="link-cuerpo">Cuerpo<\/p><div class="link-acciones"><button type="button">Uno<\/button><\/div><\/section>$/);
  });

  it('🔴 la nota de E3 va AFUERA, después de la tarjeta; control positivo: sin nota no hay link-nota', () => {
    const con = renderToStaticMarkup(<TarjetaDeLink cuadro={{ icono: 'tienda' }} titulo="T" cuerpo="C" nota="Tu cuenta ya está lista" />);
    expect(con).toMatch(/<\/section><p class="link-nota">Tu cuenta ya está lista<\/p>$/);
    const sin = renderToStaticMarkup(<TarjetaDeLink cuadro={{ icono: 'tienda' }} titulo="T" cuerpo="C" />);
    expect(sin).not.toContain('link-nota');
  });

  it('🔴 C · el aro se oye: progressbar con el título como nombre, la tarjeta aria-busy, y el cuadro del aro sin aria-hidden', () => {
    const html = renderToStaticMarkup(<TarjetaDeLink cuadro={{ aro: 'Sumándote a la mesa…' }} titulo="Sumándote a la mesa…" cuerpo="Un segundo." />);
    expect(html).toContain('<section class="title-card" aria-busy="true">');
    expect(html).toContain('<span class="title-card-cuadro" data-icono="aro"><span class="link-aro" role="progressbar" aria-label="Sumándote a la mesa…"></span></span>');
    expect(html).not.toContain('aria-hidden');
  });

  it('control positivo: los demás estados no llevan aria-busy, y su cuadro sí es decorativo', () => {
    const html = renderToStaticMarkup(<TarjetaDeLink cuadro={{ icono: 'link-cortado' }} titulo="T" cuerpo="C" />);
    expect(html).not.toContain('aria-busy');
    expect(html).not.toContain('progressbar');
    expect(html).toContain('aria-hidden="true"');
  });

  it('D · el cuadro verde del canje hecho, con el tilde; el restaurante sólo si llegó', () => {
    const con = renderToStaticMarkup(<TarjetaDeLink cuadro={{ icono: 'check', exito: true }} titulo="¡Te sumaste a la mesa!" restaurante="La Parolaccia" />);
    expect(con).toContain('class="title-card-cuadro title-card-cuadro--exito" data-icono="check"');
    expect(con).toContain('<p class="link-restaurante">La Parolaccia</p>');
    for (const vacio of [null, undefined, '']) {
      const sin = renderToStaticMarkup(<TarjetaDeLink cuadro={{ icono: 'check', exito: true }} titulo="¡Te sumaste a la mesa!" restaurante={vacio} />);
      expect(sin).not.toContain('link-restaurante');
      expect(sin).not.toContain('link-cuerpo');
      expect(sin).not.toContain('link-acciones');
    }
  });

  it('B · la tarjeta suelta (sin el montaje de −42, D374)', () => {
    expect(renderToStaticMarkup(<TarjetaDeLink suelta cuadro={{ icono: 'persona-mas' }} titulo="T" cuerpo="C" />))
      .toMatch(/^<section class="title-card title-card--suelta">/);
  });

  it('la tarjeta no pinta naranja por su cuenta: el único naranja lo pone la pantalla en su botón', () => {
    const html = renderToStaticMarkup(<TarjetaDeLink cuadro={{ icono: 'persona-mas' }} titulo="T" cuerpo="C" />);
    expect(html).not.toMatch(/brand|cierre/);
  });
});

describe('🔴 D372 · los dos íconos nuevos', () => {
  it('son los del canvas, tal cual, en un mapa aparte del de D285 (claves disjuntas)', () => {
    expect({ ...ICONOS_DE_LA_INVITACION }).toEqual(DEL_CANVAS);
    const deD285 = new Set(Object.keys(ICONOS_DE_TARJETA));
    // Control positivo: el mapa de D285 sigue con sus 23.
    expect(deD285.size).toBe(23);
    for (const clave of Object.keys(ICONOS_DE_LA_INVITACION)) expect(deD285.has(clave), clave).toBe(false);
  });

  it('se dibujan con el cuadro de siempre: trazo 1.7, decorativo, un solo path', () => {
    for (const icono of ['link-cortado', 'reintentar'] as const) {
      const html = renderToStaticMarkup(<CuadroDeTarjeta icono={icono} />);
      expect(html).toContain(`class="title-card-cuadro" data-icono="${icono}" aria-hidden="true"`);
      expect(html).toContain('stroke-width="1.7"');
      expect(contar(html, /<path\b/g)).toBe(1);
      expect(html).toContain(`<path d="${DEL_CANVAS[icono]}"></path>`);
    }
  });

  it('🔴 «exito» no es el valor por defecto: el cuadro de siempre sigue navy', () => {
    expect(renderToStaticMarkup(<CuadroDeTarjeta icono="check" />)).toContain('class="title-card-cuadro" data-icono="check"');
  });
});
