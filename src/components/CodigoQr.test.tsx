import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { codificarQr } from '../qr/codificarQr';
import { LINKS_DE_REFERENCIA } from '../qr/qrFixtures';
import { CodigoQr } from './CodigoQr';

/** D622 · AF-3 · mejora 6 · el QR se dibuja en un `<svg>`: un solo `path`, zona de silencio de 4 módulos, sin red. */

const t = (s: string, ...a: unknown[]): string => s.replace(/\{(\d+)\}/g, (_, i) => String(a[Number(i)]));
const LINK = LINKS_DE_REFERENCIA[2].texto;

/** Los módulos oscuros que dibuja el `path` (subtrazos `M x y h w v1 h-w z`), como «fila,columna» del lienzo con margen. */
function oscurosDelPath(d: string): Set<string> {
  const oscuros = new Set<string>();
  const subtrazo = /M(\d+) (\d+)h(\d+)v1h-(\d+)z/g;
  let consumido = 0;
  for (const m of d.matchAll(subtrazo)) {
    expect(m.index).toBe(consumido);
    consumido += m[0].length;
    const [x, y, w, w2] = [m[1], m[2], m[3], m[4]].map(Number);
    expect(w2).toBe(w);
    for (let i = 0; i < w; i++) oscuros.add(`${y},${x + i}`);
  }
  expect(consumido, 'el path no trae nada fuera de los subtrazos de módulos').toBe(d.length);
  return oscuros;
}

describe('CodigoQr', () => {
  it('🔴 un svg con nombre accesible que NO es el link, y la línea de ayuda', () => {
    const html = renderToStaticMarkup(<CodigoQr texto={LINK} codigo="PA-48213" t={t} />);
    expect(html).toMatch(/<svg[^>]* role="img"[^>]* aria-label="QR para unirse a la mesa PA-48213"/);
    expect(html).not.toContain(LINK);
    expect(html).not.toContain('?t=');
    expect(html).toContain('<p class="codigo-qr-ayuda">Que lo escaneen con la cámara.</p>');
  });

  it('🔴 dibuja exactamente los módulos de la matriz, corridos 4 por la zona de silencio', () => {
    const html = renderToStaticMarkup(<CodigoQr texto={LINK} codigo="PA-48213" t={t} />);
    const m = codificarQr(LINK)!;
    const lado = m.tamano + 8;
    expect(html).toContain(`viewBox="0 0 ${lado} ${lado}"`);
    // El fondo blanco cubre el lienzo entero, zona de silencio incluida.
    expect(html).toMatch(new RegExp(`<rect width="${lado}" height="${lado}" fill="#fff"`));
    const paths = [...html.matchAll(/<path d="([^"]+)"/g)].map((x) => x[1]);
    expect(paths).toHaveLength(1);
    const dibujados = oscurosDelPath(paths[0]);
    const esperados = new Set<string>();
    m.modulos.forEach((fila, r) => fila.forEach((v, c) => { if (v) esperados.add(`${r + 4},${c + 4}`); }));
    expect(dibujados).toEqual(esperados);
    // La zona de silencio: ningún módulo oscuro en las 4 filas y columnas del borde.
    for (const clave of dibujados) {
      const [r, c] = clave.split(',').map(Number);
      expect(r >= 4 && r < lado - 4 && c >= 4 && c < lado - 4, clave).toBe(true);
    }
  });

  it('🔴 sin imágenes, canvas ni referencias externas', () => {
    const html = renderToStaticMarkup(<CodigoQr texto={LINK} codigo="PA-48213" t={t} />);
    expect(html).not.toMatch(/<image|<img|<canvas|href=|url\(|<foreignObject/);
    expect(html).toContain('shape-rendering="crispEdges"');
  });

  it('🔴 si el link no entra en la versión 10 no dibuja nada (ni la línea de ayuda)', () => {
    expect(renderToStaticMarkup(<CodigoQr texto={'a'.repeat(214)} codigo="PA-48213" t={t} />)).toBe('');
  });

  it('sin link (texto vacío) no dibuja nada', () => {
    expect(renderToStaticMarkup(<CodigoQr texto="" codigo="PA-48213" t={t} />)).toBe('');
  });
});
