import { describe, expect, it, vi } from 'vitest';
import { FotosDeViajes } from './fotosDeViajes';
import { FotosEnMemoria, claveFotoDeViaje, duenoDeSesion } from './fotosEnMemoria';
import { MockApiError } from './mock/mockApi';
import type { StoredSession } from './storage';

/** D255 · la foto de cada viaje (App Backend 2.174.0), con las reglas de las de los miembros. */
const viaje = (id: string, has_photo: boolean) => ({ id, has_photo });

const SESION = {
  access_token: 'a', refresh_token: 'r', family_id: 'fam', principal_id: 'u-1', user: null,
} as unknown as StoredSession;

function armar(pedir: (id: string) => Promise<Blob>) {
  let n = 0;
  const cache = new FotosEnMemoria({
    crearUrl: () => { n += 1; return `blob:foto-${n}`; },
    revocarUrl: () => undefined,
    duenoVigente: () => duenoDeSesion(SESION),
  });
  const alCambiar = vi.fn();
  const fotos = new FotosDeViajes(() => SESION, (id) => pedir(id), alCambiar, cache);
  return { fotos, cache, alCambiar };
}

const esperar = () => new Promise((r) => setTimeout(r, 0));
const jpeg = (byte: number) => new Blob([new Uint8Array([byte])], { type: 'image/jpeg' });

describe('🔴 D255 · FotosDeViajes', () => {
  it('pide SÓLO con has_photo, una vez por viaje', async () => {
    const pedir = vi.fn(async () => jpeg(1));
    const { fotos, alCambiar } = armar(pedir);
    const lista = [viaje('v-1', true), viaje('v-2', false)];
    fotos.cargar(lista);
    fotos.cargar(lista);
    await esperar();
    expect(pedir).toHaveBeenCalledTimes(1);
    expect(pedir).toHaveBeenCalledWith('v-1');
    expect(fotos.url('v-1')).toBe('blob:foto-1');
    expect(fotos.url('v-2')).toBeNull();
    expect(alCambiar).toHaveBeenCalledTimes(1);
  });

  it('después de subir una nueva, `recargar` la vuelve a pedir y se ve la nueva', async () => {
    let byte = 1;
    const pedir = vi.fn(async () => jpeg(byte));
    const { fotos } = armar(pedir);
    fotos.cargar([viaje('v-1', true)]);
    await esperar();
    byte = 2;
    fotos.recargar('v-1');
    fotos.cargar([viaje('v-1', true)]);
    await esperar();
    expect(pedir).toHaveBeenCalledTimes(2);
    expect(fotos.url('v-1')).toBe('blob:foto-2');
  });

  it('🔴 has_photo false (la quitaron) la retira; un 404 también; un error deja la inicial sin reintentar', async () => {
    let respuesta: 'foto' | '404' | 'error' = 'foto';
    const pedir = vi.fn(async () => {
      if (respuesta === '404') throw new MockApiError(404, 'viaje_photo_not_found');
      if (respuesta === 'error') throw new Error('red');
      return jpeg(1);
    });
    const { fotos, cache } = armar(pedir);
    fotos.cargar([viaje('v-1', true)]);
    await esperar();
    fotos.cargar([viaje('v-1', false)]);
    expect(fotos.url('v-1')).toBeNull();
    expect(cache.tiene(SESION, claveFotoDeViaje('v-1'))).toBe(false);
    // Vuelve a tener foto: se pide de nuevo.
    respuesta = '404';
    fotos.cargar([viaje('v-1', true)]);
    await esperar();
    expect(pedir).toHaveBeenCalledTimes(2);
    expect(fotos.url('v-1')).toBeNull();
    respuesta = 'error';
    fotos.cargar([viaje('v-2', true)]);
    await esperar();
    fotos.cargar([viaje('v-2', true)]);
    await esperar();
    expect(pedir).toHaveBeenCalledTimes(3);
    expect(fotos.url('v-2')).toBeNull();
  });

  it('dispose: deja de avisar a la pantalla', async () => {
    const { fotos, alCambiar } = armar(async () => jpeg(1));
    fotos.cargar([viaje('v-1', true)]);
    fotos.dispose();
    await esperar();
    expect(alCambiar).not.toHaveBeenCalled();
  });
});
