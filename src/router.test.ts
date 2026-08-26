import { afterEach, describe, expect, it, vi } from 'vitest';
import { PAGES, normalizeUnknownHash, parseHash } from './router';

const sources = import.meta.glob('/src/router.ts', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;
const routerSource = sources['/src/router.ts'];

function browserStub(hash: string, replaceFails = false) {
  let actual = hash;
  const hashWrites: string[] = [];
  const dispatched: string[] = [];
  const replaceState = vi.fn((_state: unknown, _title: string, url: string) => {
    if (replaceFails) throw new Error('SecurityError');
    const hashIndex = url.indexOf('#');
    actual = hashIndex < 0 ? '' : url.slice(hashIndex);
  });
  class FakeHashChangeEvent {
    type: string;
    constructor(type: string) { this.type = type; }
  }
  vi.stubGlobal('HashChangeEvent', FakeHashChangeEvent);
  vi.stubGlobal('window', {
    location: {
      pathname: '/',
      search: '',
      get hash() { return actual; },
      set hash(next: string) { hashWrites.push(next); actual = next; },
    },
    history: { state: null, replaceState, back: vi.fn() },
    dispatchEvent: (event: { type: string }) => { dispatched.push(event.type); return true; },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  return { replaceState, hashWrites, dispatched, hash: () => actual };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseHash', () => {
  it('degrada una URI mal codificada sin lanzar', () => {
    expect(parseHash('#/mesa/%E0%A4%A').page).toBe('home');
  });
});

describe('G-35 · normalización segura del hash desconocido', () => {
  it.each(['#/saldo', '#/zzz', '#basura', '#/mesa/%E0%A4%A'])(
    '%s termina en #/home reemplazando la entrada inválida',
    (hash) => {
      const browser = browserStub(hash);

      expect(normalizeUnknownHash(hash)).toBe(true);
      expect(browser.hash()).toBe('#/home');
      expect(browser.replaceState).toHaveBeenCalledTimes(1);
      expect(browser.hashWrites).toEqual([]);
      expect(browser.dispatched).toEqual(['hashchange']);
    },
  );

  it('la población completa de páginas válidas queda intacta', () => {
    for (const page of PAGES) {
      const hash = `#/${page}`;
      const browser = browserStub(hash);
      expect(normalizeUnknownHash(hash), hash).toBe(false);
      expect(browser.hash(), hash).toBe(hash);
      expect(browser.replaceState, hash).not.toHaveBeenCalled();
    }
  });

  it.each([
    '',
    '#',
    '#/',
    '#/mesa/PA-123?t=token&r=restaurant-id',
    '#/scan?r=restaurant-id',
    '#/home?future=query',
  ])('preserva default, deep links y queries conocidas: %s', (hash) => {
    const browser = browserStub(hash);
    expect(normalizeUnknownHash(hash)).toBe(false);
    expect(browser.hash()).toBe(hash);
    expect(browser.replaceState).not.toHaveBeenCalled();
  });

  it('si replaceState está bloqueado, igual limpia mediante el fallback explícito', () => {
    const browser = browserStub('#/zzz', true);
    expect(normalizeUnknownHash('#/zzz')).toBe(true);
    expect(browser.hash()).toBe('#/home');
    expect(browser.hashWrites).toEqual(['#/home']);
  });

  it('useRoute ejecuta el normalizador al montar y en cada hashchange', () => {
    expect(routerSource).toContain('if (normalizeUnknownHash(window.location.hash)) return;');
  });
});
