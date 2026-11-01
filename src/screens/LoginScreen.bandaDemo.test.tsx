import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * AF-7 · i1 (auditoría del PR #116): la banda «Demo · datos de ejemplo, no se cobra dinero real» existe SÓLO en el riel
 * mock.
 *
 * La guarda `e2e/sin-promesa-de-pago.spec.ts` la excluye por su clase (`sinLaBandaDelMock`) antes de leer, porque en el
 * build real ese nodo no se dibuja. Hasta acá ningún test fijaba esa invariante: si alguien sacaba el `IS_MOCK &&`, la
 * banda salía a producción diciendo «no se cobra» y la guarda no la veía. Esto la fija dibujando el ingreso de verdad,
 * sin el riel mock (cero nodos `.ingreso-demo` y cero veces el texto) y con él (la banda está, que prueba que el test
 * la ve). La sesión es un doble: el ingreso sólo la desestructura.
 */
vi.mock('../auth/AuthContext', () => {
  const nada = () => Promise.resolve();
  const auth = {
    login: nada, register: nada, googleLogin: nada, googleRegister: nada, googleContinue: nada,
    googleRedirectSignup: nada, googleContinueLink: nada, facebookCallbackPhase: 'idle',
    completeFacebookCallback: nada, clearFacebookCallbackError: () => undefined, vueltaGoogle: { fase: 'idle' },
    descartarVueltaGoogle: () => undefined, anunciar: () => undefined,
  };
  return { useAuth: () => auth };
});

const BANDA = 'Demo · datos de ejemplo, no se cobra dinero real';

async function ingreso(mock: boolean): Promise<string> {
  vi.resetModules();
  vi.stubEnv('VITE_MOCK', mock ? '1' : '');
  const { IS_MOCK } = await import('../api');
  expect(IS_MOCK, 'el riel del módulo es el pedido').toBe(mock);
  const { LoginScreen } = await import('./LoginScreen');
  return renderToStaticMarkup(<LoginScreen />);
}

afterEach(() => { vi.unstubAllEnvs(); });

describe('la banda «Demo» del ingreso', () => {
  it('🔴 fuera del mock no se dibuja: ni el nodo ni el texto', async () => {
    const html = await ingreso(false);
    expect(html).toContain('class="ingreso"');
    expect(html).not.toContain('ingreso-demo');
    expect(html).not.toContain(BANDA);
  });

  it('en el mock, sí (el test la ve cuando está)', async () => {
    const html = await ingreso(true);
    expect(html).toContain('class="ingreso-demo"');
    expect(html).toContain(BANDA);
  });
});
