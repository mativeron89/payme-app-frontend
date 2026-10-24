import { describe, expect, it, vi } from 'vitest';
import { FotosEnMemoria, duenoDeSesion, claveAmigo, clavePropia, claveFotoDeViaje,
  claveInvitador, claveInvitadorDeInvitacion, claveParticipante, claveMiembroDeViaje } from './fotosEnMemoria';
import { FotosDeMiembrosDeViaje } from './fotosDeMiembrosDeViaje';
import { FotosDeParticipantes } from './fotosDeParticipantes';
import { HttpError } from './http';
import type { StoredSession } from './storage';

const session: StoredSession = { access_token: 'a', refresh_token: 'r', family_id: 'f', principal_id: 'u' };
const foto = () => new Blob(['foto'], { type: 'image/jpeg' });
function diferido<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
function armar() {
  let n = 0;
  const revocar = vi.fn();
  const cache = new FotosEnMemoria({ crearUrl: () => `blob:${++n}`, revocarUrl: revocar, duenoVigente: () => duenoDeSesion(session) });
  return { cache, revocar };
}

describe('D457 · invalidación de fotos contextuales', () => {
  it.each([claveInvitador('n'), claveInvitadorDeInvitacion('i'), claveParticipante('m', 'p'), claveMiembroDeViaje('v', 'p')])(
    '%s retira ante fallo y no deja volver al 200 de una lectura anterior', async (clave) => {
      const { cache, revocar } = armar();
      await cache.cargar(session, clave, async () => foto());
      const vieja = diferido<Blob>();
      const pendiente = cache.cargar(session, clave, () => vieja.promise, { retirarAnteError: true });
      const nuevo = cache.cargar(session, clave, async () => { throw new TypeError('offline'); }, { retirarAnteError: true, sustituirEnCurso: true });
      expect(await nuevo).toBe('retirada');
      expect(cache.ver(session, clave)).toBeNull();
      vieja.resolve(foto());
      expect(await pendiente).toBe('descartada');
      expect(cache.ver(session, clave)).toBeNull();
      expect(revocar).toHaveBeenCalledTimes(1);
    },
  );
  it.each([claveAmigo('a'), clavePropia('r'), claveFotoDeViaje('v')])('conserva la política de %s ante red caída', async (clave) => {
    const { cache, revocar } = armar();
    await cache.cargar(session, clave, async () => foto());
    expect(await cache.cargar(session, clave, async () => { throw new TypeError('offline'); })).toBe('conservada');
    expect(cache.ver(session, clave)).toBe('blob:1');
    expect(revocar).not.toHaveBeenCalled();
  });
  it('hint false invalida incluso sin foto guardada; el contexto siguiente puede pedir de nuevo', async () => {
    const { cache } = armar();
    const clave = claveMiembroDeViaje('v', 'm');
    const vieja = diferido<Blob>();
    const pendiente = cache.cargar(session, clave, () => vieja.promise, { retirarAnteError: true });
    cache.retirar(session, clave);
    vieja.resolve(foto());
    expect(await pendiente).toBe('descartada');
    expect(cache.ver(session, clave)).toBeNull();
    expect(await cache.cargar(session, clave, async () => foto(), { retirarAnteError: true })).toBe('guardada');
  });
  it.each(['mesa', 'viaje'] as const)('%s revalida una lista nueva sin repetir por un render del mismo resultado', async (canal) => {
    const { cache } = armar();
    let rechazar = false;
    const final = diferido<void>();
    const pedir = vi.fn(async () => { if (rechazar) throw new HttpError(404, { error: 'avatar_not_found' }); return foto(); });
    const cambio = () => { if (rechazar) final.resolve(); };
    const a = new FotosDeParticipantes('m', () => session, pedir, cambio, cache);
    const b = new FotosDeMiembrosDeViaje('v', () => session, pedir, cambio, cache);
    const listaMesa = [{ firstName: 'Ana', lastName: 'Prueba', paymeId: 'payme_a', participantId: 'p', hasAvatar: true, username: null }];
    const listaViaje = [{ id: 'p', has_avatar: true }];
    const cargar = (nueva: boolean) => canal === 'mesa'
      ? a.cargar(nueva ? [...listaMesa] : listaMesa, true)
      : b.cargar(nueva ? [...listaViaje] : listaViaje, true);
    cargar(false);
    // Compartir el mismo pedido hasta que termine (sin reloj/timer).
    const clave = canal === 'mesa' ? claveParticipante('m', 'p') : claveMiembroDeViaje('v', 'p');
    await cache.cargar(session, clave, pedir);
    expect(pedir).toHaveBeenCalledTimes(1);
    cargar(false);
    expect(pedir).toHaveBeenCalledTimes(1);
    rechazar = true;
    cargar(true);
    await final.promise;
    expect(pedir).toHaveBeenCalledTimes(2);
    expect(cache.ver(session, clave)).toBeNull();
    a.dispose(); b.dispose();
  });
});
