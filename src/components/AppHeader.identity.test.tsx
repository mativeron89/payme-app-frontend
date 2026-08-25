import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppHeader, AppHeaderBack, AppHeaderFlow } from './AppHeader';

const HEADER_SOURCE = readFileSync(new URL('./AppHeader.tsx', import.meta.url), 'utf8');
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

  it('los 17 montajes autenticados pasan userName y los tres pre-sesión siguen anónimos', () => {
    const authenticated = Object.entries(SCREEN_SOURCES)
      .filter(([path]) => !path.endsWith('/JoinMesaScreen.tsx'))
      .flatMap(([, source]) => headerCalls(source));
    const preSession = headerCalls(SCREEN_SOURCES['/src/screens/JoinMesaScreen.tsx']);

    expect(authenticated).toHaveLength(17);
    expect(authenticated.every((call) => /\buserName=/.test(call))).toBe(true);
    expect(authenticated.some((call) => /\bpaymeId=/.test(call))).toBe(false);
    expect(preSession).toHaveLength(3);
    expect(preSession.every((call) => !/\b(?:userName|paymeId)=/.test(call))).toBe(true);
  });
});
