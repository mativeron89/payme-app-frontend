import { afterEach, describe, expect, it } from 'vitest';

class MemoryStorage {
  values = new Map<string, string>();
  failSet = false;
  failGet = false;

  getItem(key: string) {
    if (this.failGet) throw new Error('blocked');
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    if (this.failSet) throw new Error('blocked');
    this.values.set(key, value);
  }

  removeItem(key: string) { this.values.delete(key); }
}

type StorageListener = (event: StorageEvent) => void;
const events = new Set<StorageListener>();
const storage = new MemoryStorage();
const fakeWindow = {
  addEventListener(type: string, listener: StorageListener) {
    if (type === 'storage') events.add(listener);
  },
  removeEventListener(type: string, listener: StorageListener) {
    if (type === 'storage') events.delete(listener);
  },
  emitStorage(key: string | null) {
    events.forEach((listener) => listener({ key } as StorageEvent));
  },
};

Object.assign(globalThis, { localStorage: storage, window: fakeWindow });
const api = await import('./storage');

function stored(id: string, family = `${id}-family`) {
  return {
    access_token: `${id}-access`,
    refresh_token: `${id}-refresh`,
    user: { id, payme_id: id, email: `${id}@x`, first_name: id, last_name: id },
    family_id: family,
    principal_id: id,
  };
}

afterEach(() => {
  storage.values.clear();
  storage.failSet = false;
  storage.failGet = false;
  events.clear();
});

describe('sesión observable y CAS', () => {
  it('otra pestaña A→B notifica la fuente actual y una CAS vieja no restaura A', () => {
    const a = stored('a');
    const b = stored('b');
    const observed: Array<string | null> = [];
    const unsubscribe = api.subscribeSession(() => observed.push(api.loadSession()?.principal_id ?? null));

    api.saveSession(a);
    storage.setItem('payme_app_session', JSON.stringify(b));
    fakeWindow.emitStorage('payme_app_session');

    expect(observed).toEqual(['a', 'b']);
    expect(api.replaceCurrentSession(a, a)).toBe(false);
    expect(api.loadSession()?.family_id).toBe(b.family_id);
    unsubscribe();
  });

  it('otra pestaña A→logout limpia el estado observable', () => {
    const observed: Array<string | null> = [];
    const unsubscribe = api.subscribeSession(() => observed.push(api.loadSession()?.principal_id ?? null));
    api.saveSession(stored('a'));
    storage.removeItem('payme_app_session');
    fakeWindow.emitStorage('payme_app_session');

    expect(observed).toEqual(['a', null]);
    unsubscribe();
  });

  it('relogin del mismo principal con otra familia propaga la nueva familia', () => {
    const observed: Array<string | null> = [];
    const first = stored('a', 'family-1');
    const relogin = stored('a', 'family-2');
    const unsubscribe = api.subscribeSession(() => observed.push(api.loadSession()?.family_id ?? null));

    api.saveSession(first);
    storage.setItem('payme_app_session', JSON.stringify(relogin));
    fakeWindow.emitStorage('payme_app_session');

    expect(observed).toEqual(['family-1', 'family-2']);
    expect(api.isCurrentSession(first)).toBe(false);
    unsubscribe();
  });

  it('un evento viejo fuera de orden relee B y no usa su payload para restaurar A', () => {
    const a = stored('a');
    const b = stored('b');
    const observed: Array<string | null> = [];
    const unsubscribe = api.subscribeSession(() => observed.push(api.loadSession()?.principal_id ?? null));
    api.saveSession(a);
    api.saveSession(b);
    fakeWindow.emitStorage('payme_app_session');

    expect(observed).toEqual(['a', 'b', 'b']);
    expect(api.loadSession()?.principal_id).toBe('b');
    unsubscribe();
  });

  it('una respuesta vieja de la misma familia no pisa una rotación más nueva', () => {
    const before = stored('a', 'family-a');
    const rotated = { ...before, access_token: 'new-access', refresh_token: 'new-refresh' };
    api.saveSession(before);
    api.saveSession(rotated);

    expect(api.replaceCurrentSession(before, before)).toBe(false);
    expect(api.loadSession()).toMatchObject({ access_token: 'new-access', refresh_token: 'new-refresh' });
  });

  it('si set falla aunque get funcione, rechaza la sesión nueva sin adoptar memoria', () => {
    const b = stored('b');
    api.saveSession(b);
    storage.failSet = true;

    expect(() => api.saveSession(stored('a'))).toThrow('session_storage_unavailable');
    expect(api.loadSession()?.principal_id).toBe('b');
  });

  it('una sesión malformada o con refresh vacío falla cerrada', () => {
    storage.setItem('payme_app_session', JSON.stringify({ ...stored('a'), refresh_token: '' }));
    expect(api.loadSession()).toBeNull();
  });
});
