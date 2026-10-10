import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoriaDeCuenta } from './memoriaDeCuenta';
import { UltimoVisto } from './ultimoVisto';

/**
 * C-07 (auditoría Codex completa, MEDIA) · un dato de una cuenta en memoria (el
 * nombre del viaje, lo que leyó la cámara) no se lee con otra cuenta ni después
 * de cerrar sesión. Usa el mismo `turno()` de T-01.
 */
function conSesion(inicial: string | null) {
  const estado = { dueno: inicial };
  const cuenta = new UltimoVisto(() => estado.dueno);
  let avisar: () => void = () => undefined;
  cuenta.vigilarSesion((oyente) => { avisar = oyente; return () => undefined; });
  return { cuenta, cambiarA: (d: string | null) => { estado.dueno = d; avisar(); }, estado };
}

describe('🔴 C-07 · la memoria es de una cuenta', () => {
  it('con la misma cuenta se lee', () => {
    const { cuenta } = conSesion('A');
    const m = new MemoriaDeCuenta<string>(cuenta);
    m.guardar('Cancún de A');
    expect(m.leer()).toBe('Cancún de A');
  });

  it('A guarda, entra B: B no lee nada', () => {
    const { cuenta, cambiarA } = conSesion('A');
    const m = new MemoriaDeCuenta<string>(cuenta);
    m.guardar('Cancún de A');
    cambiarA('B');
    expect(m.leer()).toBeNull();
  });

  it('sin aviso de la sesión (otra pestaña): tampoco', () => {
    const { cuenta, estado } = conSesion('A');
    const m = new MemoriaDeCuenta<string>(cuenta);
    m.guardar('Cancún de A');
    estado.dueno = 'B';
    expect(m.leer()).toBeNull();
    // Y lo de A ya no está aunque vuelva A sin aviso.
    estado.dueno = 'A';
    expect(m.leer()).toBeNull();
  });

  it('🔴 A cierra sesión y vuelve a entrar A: lo de antes ya no está (se borra al salir)', () => {
    const { cuenta, cambiarA } = conSesion('A');
    const m = new MemoriaDeCuenta<string>(cuenta);
    m.guardar('Cancún de A');
    cambiarA(null);
    // Se borra al salir, sin esperar a que alguien la lea.
    expect(m.vacia()).toBe(true);
    cambiarA('A');
    expect(m.leer()).toBeNull();
  });

  it('un refresco de tokens (el mismo dueño) no la borra', () => {
    const { cuenta, cambiarA } = conSesion('A');
    const m = new MemoriaDeCuenta<string>(cuenta);
    m.guardar('Cancún de A');
    cambiarA('A');
    expect(m.leer()).toBe('Cancún de A');
  });

  it('sin sesión, lo guardado no se lee', () => {
    const { cuenta } = conSesion(null);
    const m = new MemoriaDeCuenta<string>(cuenta);
    m.guardar('nadie');
    expect(m.leer()).toBeNull();
  });

  it('🔴 T-01 · sin nada guardado, cada cambio de dueño invalida los turnos de antes', () => {
    const { cuenta, cambiarA } = conSesion('A');
    const deA = cuenta.turno();
    cambiarA(null);
    cambiarA('A');
    expect(cuenta.esDeAhora(deA)).toBe(false);
    expect(cuenta.guardar(deA, 'sinLeer', 1)).toBeNull();
  });
});

// ─── El nombre del viaje y el ticket escaneado, con la sesión de verdad ──────
class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const sesion = (familia: string, principal: string) => ({
  access_token: 'a', refresh_token: 'r', family_id: familia, principal_id: principal,
  user: { id: principal, payme_id: `payme_mx_${principal}`, email: `${principal}@example.com`, first_name: 'X', last_name: 'Y' },
});

async function conLaApp() {
  vi.resetModules();
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('window', { addEventListener: () => undefined, removeEventListener: () => undefined });
  const storage = await import('./storage');
  const visto = await import('./ultimoVisto');
  const circulo = await import('../screens/viajes/circuloDelViaje');
  const escaneado = await import('../screens/viajes/ticketEscaneado');
  visto.vigilarUltimoVistoConLaSesion();
  return { storage, circulo, escaneado };
}

const OCR = { items: [{ name: 'Tacos', price_cents: 10000, quantity: 1 }], receipt: 'recibo-de-A' } as never;

describe('🔴 C-07 · el nombre recordado del viaje y el ticket escaneado', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('recordar el nombre con A, entrar B y leer el mismo id: nada', async () => {
    const { storage, circulo } = await conLaApp();
    storage.saveSession(sesion('fam-a', 'user-a'));
    circulo.recordarNombreDeViaje('viaje-1', 'Cancún de A');
    expect(circulo.nombreDeViajeRecordado('viaje-1')).toBe('Cancún de A');
    storage.saveSession(sesion('fam-b', 'user-b'));
    expect(circulo.nombreDeViajeRecordado('viaje-1')).toBeNull();
  });

  it('lo mismo con el ticket escaneado', async () => {
    const { storage, escaneado } = await conLaApp();
    storage.saveSession(sesion('fam-a', 'user-a'));
    escaneado.guardarTicketEscaneado('viaje-1', OCR);
    expect(escaneado.ticketEscaneadoDe('viaje-1')).toBe(OCR);
    storage.saveSession(sesion('fam-b', 'user-b'));
    expect(escaneado.ticketEscaneadoDe('viaje-1')).toBeNull();
  });

  it('cerrar sesión y volver a entrar con la misma cuenta: el nombre ya no está', async () => {
    const { storage, circulo } = await conLaApp();
    storage.saveSession(sesion('fam-a', 'user-a'));
    circulo.recordarNombreDeViaje('viaje-1', 'Cancún de A');
    storage.clearSession();
    storage.saveSession(sesion('fam-a2', 'user-a'));
    expect(circulo.nombreDeViajeRecordado('viaje-1')).toBeNull();
  });
});
