import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CuadroDeTarjeta, FilaDeTitulo, ICONOS_DE_TARJETA } from './TarjetaDeTitulo';

/**
 * 🔴 D285 · la tarjeta de título blanca con ícono. Los estilos computados de cada pantalla los mide
 * `e2e/tarjeta-de-titulo-blanca.spec.ts` a 390; acá, el componente, los íconos de la especificación y el censo de la
 * clase, que sale del código y no de una lista.
 */

/** Los `d` de `PANTALLA-tarjeta-de-titulo-blanca.md` (e25d98bb…), tabla «Íconos», tal cual. */
const DE_LA_ESPECIFICACION: Record<string, string> = {
  dividir: 'M16 3h5v5M8 3H3v5M21 3l-7.5 7.5M3 3l7.5 7.5M12 12v9',
  escudo: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  banco: 'M3 10h18M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18M12 3l9 5H3z',
  compartir: 'M18 3a3 3 0 1 0 0 6a3 3 0 1 0 0-6M6 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6M18 15a3 3 0 1 0 0 6a3 3 0 1 0 0-6M8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
  tienda: 'M3 9l2-5h14l2 5M3 9h18v1a3 3 0 0 1-6 0a3 3 0 0 1-6 0a3 3 0 0 1-6 0zM5 13v8h14v-8M10 21v-5h4v5',
  cubiertos: 'M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 21V3c-2 0-3.5 2.5-3.5 6s1.5 4 3.5 4',
  tarjeta: 'M2 6.5A1.5 1.5 0 0 1 3.5 5h17A1.5 1.5 0 0 1 22 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 17.5zM2 10h20M6 15h4',
  check: 'M20 6 9 17l-5-5',
  mesa: 'M3 9h18M5 9v11M19 9v11M8 9V5h8v4',
  maleta: 'M3 8a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18',
  archivo: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
  'maleta-mas': 'M3 8a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M12 10.5v6M9 13.5h6',
  engranaje: 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
  recibo: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h4',
  escanear: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 12h8',
  lapiz: 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  barras: 'M3 21h18M6 17v-6M11 17V5M16 17v-9',
  tendencia: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  'recibo-de-pagos': 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h4',
  controles: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M16 4v4M10 10v4M18 16v4',
  campana: 'M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M13.7 21a2 2 0 0 1-3.4 0',
  entrar: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3',
  'persona-mas': 'M10 4a4 4 0 1 0 0 8a4 4 0 1 0 0-8M2 21c0-4 3.6-7 8-7 1.5 0 2.9.3 4 .9M19 14v6M16 17h6',
};

describe('🔴 D285 · los íconos y el cuadro', () => {
  it('los 23 íconos de la especificación, tal cual', () => {
    expect({ ...ICONOS_DE_TARJETA }).toEqual(DE_LA_ESPECIFICACION);
  });

  it('el cuadro: navy, un solo <path> de trazo 1.7 en blanco (currentColor), 22 px, decorativo', () => {
    const html = renderToStaticMarkup(<CuadroDeTarjeta icono="mesa" />);
    expect(html).toBe(
      '<span class="title-card-cuadro" data-icono="mesa" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24"'
      + ' fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" focusable="false">'
      + `<path d="${DE_LA_ESPECIFICACION.mesa}"></path></svg></span>`,
    );
  });

  it('el de cierre («¡Listo!»): el naranja, con el check de trazo 2.6', () => {
    const html = renderToStaticMarkup(<CuadroDeTarjeta icono="check" cierre />);
    expect(html).toContain('class="title-card-cuadro title-card-cuadro--cierre"');
    expect(html).toContain('stroke-width="2.6"');
  });

  it('la fila: el cuadro, los textos y lo de la derecha; un cuadro propio (el del viaje) reemplaza al ícono', () => {
    const fila = renderToStaticMarkup(<FilaDeTitulo icono="barras" derecha={<b>$1</b>}><h1>T</h1></FilaDeTitulo>);
    expect(fila).toMatch(/^<div class="title-card-fila"><span class="title-card-cuadro" data-icono="barras"[^]*<\/span><div class="title-card-textos"><h1>T<\/h1><\/div><b>\$1<\/b><\/div>$/);
    const propio = renderToStaticMarkup(<FilaDeTitulo icono="maleta" cuadro={<i>foto</i>}><h1>T</h1></FilaDeTitulo>);
    expect(propio).toBe('<div class="title-card-fila"><i>foto</i><div class="title-card-textos"><h1>T</h1></div></div>');
  });
});

const PANTALLAS = import.meta.glob('/src/screens/**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const CSS = import.meta.glob('/src/**/*.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** Cada contenedor de la clase (`.title-card` o `.ingreso-burbuja`), con lo que sigue hasta su primer cierre. */
function contenedores(): Array<{ donde: string; cuerpo: string }> {
  const salida: Array<{ donde: string; cuerpo: string }> = [];
  for (const [ruta, src] of Object.entries(PANTALLAS)) {
    if (ruta.includes('.test.')) continue;
    for (const m of src.matchAll(/className="(title-card|ingreso-burbuja)(?: [^"]*)?"/g)) {
      const linea = src.slice(0, m.index).split('\n').length;
      salida.push({ donde: `${ruta}:${linea}`, cuerpo: src.slice(m.index! + m[0].length, m.index! + m[0].length + 700) });
    }
  }
  return salida;
}

describe('🔴 D285 · la clase completa, enumerada desde el código', () => {
  it('los contenedores de la tarjeta son 38, en 24 archivos (las 41 filas, con sus estados, más el pizarrón de notas)', () => {
    const todos = contenedores();
    // D290 · 0.244.0 suma `NotasScreen.tsx`: el pizarrón cargando y listo, y el apartado de otro (+3, un archivo).
    expect(todos.length).toBe(38);
    expect(new Set(todos.map((c) => c.donde.split(':')[0])).size).toBe(24);
  });

  it('cada contenedor lleva su cuadro: la fila del título, o el cuadro suelto en las burbujas de Estadísticas', () => {
    const sinCuadro = contenedores().filter((c) => !/^\s*>[^]*?<(FilaDeTitulo|CuadroDeTarjeta)\b/.test(c.cuerpo.split('</div>')[0]!));
    expect(sinCuadro.map((c) => c.donde)).toEqual([]);
  });

  it('ninguna regla de la tarjeta vuelve al celeste ni al centrado (sólo el centrado vertical)', () => {
    const malas: string[] = [];
    const selector = /title-card|ingreso-burbuja|stat-burbuja|pay-title|recibo-cierre|mesa-selection|share-title|gar-title|tds-title|ticket-title|avisos-title|est-burbuja/;
    for (const [ruta, css] of Object.entries(CSS)) {
      for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const sel = m[1]!.trim();
        if (!selector.test(sel)) continue;
        if (/--teal-l|text-align:\s*center|margin:[^;]*auto/.test(m[2]!)) malas.push(`${ruta} · ${sel}`);
      }
    }
    // El chip «Esperando pagos» va celeste por la especificación, pero no es una regla de la tarjeta.
    expect(malas).toEqual([]);
  });

  it('el contenedor: blanco con borde, --sh-2, gap 12 y alineado a la izquierda; el cuadro de 48, radio 14, navy', () => {
    const global = CSS['/src/styles/global.css']!;
    const regla = (sel: string) => global.match(new RegExp(`\\n${sel.replace(/\./g, '\\.')} \\{([^}]*)\\}`))?.[1] ?? '';
    const tarjeta = regla('.title-card');
    for (const d of ['gap: 12px;', 'margin: -42px var(--sp-4) 0;', 'padding: 16px 18px;', 'min-height: 83px;',
      'border-radius: var(--r-lg);', 'background: var(--surface);', 'border: 1px solid var(--border);',
      'box-shadow: var(--sh-2);', 'text-align: left;']) expect(tarjeta, d).toContain(d);
    const cuadro = regla('.title-card-cuadro');
    for (const d of ['width: 48px;', 'height: 48px;', 'border-radius: 14px;', 'background: var(--action);', 'color: var(--on-dark);']) {
      expect(cuadro, d).toContain(d);
    }
    expect(regla('.title-card-cuadro--cierre')).toContain('background: var(--brand);');
    expect(regla('.title-card-fila')).toMatch(/display: flex;\s*align-items: center;\s*gap: 14px;/);
  });
});
