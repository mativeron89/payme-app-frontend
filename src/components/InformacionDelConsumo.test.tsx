import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { InformacionDelConsumo } from './InformacionDelConsumo';

const contexto = vi.hoisted(() => ({ session: null as null | { family_id: string; principal_id: string } }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => contexto }));
vi.mock('../api/fotoDelTicket', () => ({ useCapacidadFotoDelTicket: () => ({ guardaCompleta: true }) }));
vi.mock('../api/ocrPaginas', () => ({ useCapacidadOcrPaginas: () => true }));
vi.mock('../i18n/idioma', () => ({ useIdioma: () => ({ t: (s: string) => s }) }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  contexto.session = null;
});

it('primer render de una caja válida según sesión, ejemplo y límite exacto', () => {
  vi.stubEnv('VITE_TICKET_CROP_ENABLED', '1');
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-04-01T00:00:00Z'));
  // El render estático mide lo que se muestra antes del efecto que programa el vencimiento.
  const render = (fecha: string, code = 'PA-12345') => renderToStaticMarkup(
    <InformacionDelConsumo caja={{ page: 0, x: 0, y: 0, w: 0.5, h: 0.1 }}
      nombre="Agua" origen={{ tipo: 'mesa', code }} fecha={fecha} />,
  );
  const reciente = '2026-01-01T00:00:00.001Z';
  expect(render(reciente)).toBe('');
  contexto.session = { family_id: 'familia', principal_id: 'persona' };
  expect(render(reciente)).toContain('aria-haspopup="dialog"');
  expect(render('2026-01-01T00:00:00.000Z')).toBe('');
  expect(render(reciente, 'PA-1224')).toBe('');
});
