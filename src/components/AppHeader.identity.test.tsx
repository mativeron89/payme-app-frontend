import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppHeader, AppHeaderBack, AppHeaderFlow } from './AppHeader';

const HEADER_SOURCE = readFileSync(new URL('./AppHeader.tsx', import.meta.url), 'utf8');
const GLOBAL_CSS = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');
const SCREEN_SOURCES = import.meta.glob('/src/screens/*.tsx', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const headerCalls = (source: string): string[] => (
  source.match(/<AppHeader(?:Back|Flow)?\b[\s\S]*?\/>/g) ?? []
);

describe('cabeceras autenticadas · identidad propia por nombre', () => {
  it('las tres variantes muestran nombre completo y jamás aceptan un fallback payme_id', () => {
    const name = 'Sofía Fernández';
    const html = [
      renderToStaticMarkup(<AppHeader userName={name} />),
      renderToStaticMarkup(<AppHeaderBack userName={name} onBack={() => undefined} />),
      renderToStaticMarkup(<AppHeaderFlow userName={name} onBack={() => undefined} />),
    ].join('\n');

    expect(html.match(/Sofía Fernández/g)).toHaveLength(3);
    expect(html).not.toContain('payme_mx_');
    expect(HEADER_SOURCE).not.toMatch(/\bpaymeId\b/);
    expect(HEADER_SOURCE).not.toContain('hdr-id');
  });

  it('sin un nombre presentable deja el slot vacío y conserva el logo', () => {
    const html = [
      renderToStaticMarkup(<AppHeader />),
      renderToStaticMarkup(<AppHeaderBack onBack={() => undefined} />),
      renderToStaticMarkup(<AppHeaderFlow onBack={() => undefined} />),
    ].join('\n');

    expect(html.match(/class="hdr-mark"/g)).toHaveLength(3);
    expect(html).not.toContain('class="hdr-user"');
  });

  it('M04 · mantiene una sola caja óptica para marca y nombre', () => {
    expect(GLOBAL_CSS).toMatch(/\.hdr-user-group\s*\{[\s\S]*?align-items:\s*center;[\s\S]*?height:\s*34px;/);
  });

  /**
   * Decisión de Mati 2026-09-22 («Centrado verticalmente con el logo»: el centro
   * del nombre a la altura del centro del cuadrado azul y de «PayMe»). El
   * `translateY(-1px)` de M04 subía la tinta del nombre 1,5 px por encima del
   * cuadrado; sin desplazamientos el centrado de flex ya la deja a 0,5 px del
   * cuadrado y a 0,2 px de las mayúsculas de «PayMe» (medido con canvas; la
   * guarda en píxeles vive en `af-rediseno-12-censo-visual`). Cualquier
   * `transform`/`margin` vertical nuevo sobre `.hdr-user` vuelve a mover eso.
   */
  /**
   * Revisión de Mati del 22/09 en su iPhone («Sigue alto» → «Lo bajo un poco
   * más»): el descenso vive en UNA constante, `--hdr-user-nudge`, medida en
   * Chromium y WebKit (ver el comentario de `.hdr-user`). Ningún otro
   * desplazamiento vertical puede sumarse por fuera de esa constante.
   */
  it('el descenso del nombre es una sola constante medida en los dos motores', () => {
    // Iteración 2 (Mati en su iPhone, v0.187.2: «Sigue un poco alto»): 3px.
    expect(GLOBAL_CSS).toMatch(/--hdr-user-nudge:\s*3px;/);
    const regla = GLOBAL_CSS.match(/\.hdr-user\s*\{[^}]*\}/)?.[0] ?? '';
    expect(regla).toContain('align-self: center;');
    expect(regla).toContain('transform: translateY(var(--hdr-user-nudge));');
    expect(regla).not.toMatch(/margin-(top|bottom)\s*:/);
    expect(regla).not.toMatch(/(top|bottom)\s*:\s*-?\d/);
    // Una sola DEFINICIÓN (línea que empieza con la propiedad); las menciones
    // en comentarios no cuentan.
    expect((GLOBAL_CSS.match(/^\s*--hdr-user-nudge:/gm) ?? []).length).toBe(1);
  });

  // AF-29 (2026-09-19): 17 → 18 por `TusRestaurantesScreen` (2b), y AF-31:
  // 18 → 20 por `QueComesScreen` (2c) y `EvolucionScreen` (2f). Montan
  // `AppHeaderBack` con `userName`.
  it('los 20 montajes autenticados pasan userName y los tres pre-sesión siguen anónimos', () => {
    const authenticated = Object.entries(SCREEN_SOURCES)
      .filter(([path]) => !path.endsWith('/JoinMesaScreen.tsx'))
      .flatMap(([, source]) => headerCalls(source));
    const preSession = headerCalls(SCREEN_SOURCES['/src/screens/JoinMesaScreen.tsx']);

    expect(authenticated).toHaveLength(20);
    expect(authenticated.every((call) => /\buserName=/.test(call))).toBe(true);
    expect(authenticated.some((call) => /\bpaymeId=/.test(call))).toBe(false);
    expect(preSession).toHaveLength(3);
    expect(preSession.every((call) => !/\b(?:userName|paymeId)=/.test(call))).toBe(true);
  });
});
