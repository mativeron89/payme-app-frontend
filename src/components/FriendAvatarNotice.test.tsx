import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IdiomaProvider } from '../i18n/idioma';
import { FriendAvatarNoticeView } from './FriendAvatarNotice';

describe('U05 · presentación no bloqueante', () => {
  it('explica la audiencia, enlaza el aviso y ofrece las dos acciones explícitas', () => {
    const html = renderToStaticMarkup(
      <IdiomaProvider>
        <FriendAvatarNoticeView
          version="2.5.5"
          busy={false}
          error={false}
          onAcknowledge={() => undefined}
          onDefer={() => undefined}
        />
      </IdiomaProvider>,
    );
    expect(html).toContain('Tu foto entre amigos');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('2.5.5');
    expect(html).toContain('Entendido');
    expect(html).toContain('Ahora no');
  });
});
