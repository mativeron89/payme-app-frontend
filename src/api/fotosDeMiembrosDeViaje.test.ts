import { describe, expect, it, vi } from 'vitest';
import { FotosDeMiembrosDeViaje } from './fotosDeMiembrosDeViaje';
import { FotosEnMemoria, claveMiembroDeViaje, duenoDeSesion } from './fotosEnMemoria';
import { MockApiError } from './mock/mockApi';
import type { StoredSession } from './storage';

const miembro = (id: string, has_avatar: boolean) => ({ id, has_avatar });

const SESION = {
  access_token: 'a', refresh_token: 'r', family_id: 'fam', principal_id: 'u-1', user: null,
} as unknown as StoredSession;

function armar(pedir: (id: string) => Promise<Blob>) {
  const creadas: string[] = [];
  const revocadas: string[] = [];
  let n = 0;
  let vigente: string | null = duenoDeSesion(SESION);
  const cache = new FotosEnMemoria({
    crearUrl: () => { n += 1; const u = `blob:foto-${n}`; creadas.push(u); return u; },
    revocarUrl: (u) => { revocadas.push(u); },
    duenoVigente: () => vigente,
  });
  const alCambiar = vi.fn();
  const nueva = (viaje = 'v-1') => new FotosDeMiembrosDeViaje(viaje, () => SESION, (id) => pedir(id), alCambiar, cache);
  const cerrarSesion = () => { vigente = null; cache.vaciar(); };
  return { fotos: nueva(), nueva, cache, creadas, revocadas, alCambiar, cerrarSesion };
}

const esperar = () => new Promise((r) => setTimeout(r, 0));

describe('D245 · FotosDeMiembrosDeViaje', () => {
  it('pide SÓLO con has_avatar, una vez por miembro', async () => {
    const pedir = vi.fn(async () => new Blob(['x'], { type: 'image/jpeg' }));
    const { fotos, alCambiar } = armar(pedir);
    const lista = [miembro('m-1', true), miembro('m-2', false)];
    fotos.cargar(lista);
    fotos.cargar(lista); // el viaje que se vuelve a pedir no repite pedidos
    await esperar();
    expect(pedir).toHaveBeenCalledTimes(1);
    expect(pedir).toHaveBeenCalledWith('m-1');
    expect(fotos.url('m-1')).toBe('blob:foto-1');
    expect(fotos.url('m-2')).toBeNull();
    expect(alCambiar).toHaveBeenCalledTimes(1);
  });

  it('🔴 ante un error: iniciales y NINGÚN reintento', async () => {
    const pedir = vi.fn(async () => { throw new Error('avatar_response_media_type_invalid'); });
    const { fotos } = armar(pedir);
    fotos.cargar([miembro('m-1', true)]);
    await esperar();
    fotos.cargar([miembro('m-1', true)]);
    await esperar();
    expect(pedir).toHaveBeenCalledTimes(1);
    expect(fotos.url('m-1')).toBeNull();
  });

  it('🔴 un 404 al revalidar retira la foto; has_avatar false también', async () => {
    let respuesta: 'foto' | '404' = 'foto';
    const pedir = vi.fn(async () => {
      if (respuesta === '404') throw new MockApiError(404, 'avatar_not_found');
      return new Blob(['x'], { type: 'image/jpeg' });
    });
    const { fotos, nueva, alCambiar } = armar(pedir);
    fotos.cargar([miembro('m-1', true), miembro('m-2', true)]);
    await esperar();
    fotos.dispose();
    respuesta = '404';
    const otraVez = nueva();
    alCambiar.mockClear();
    otraVez.cargar([miembro('m-1', true), miembro('m-2', false)]);
    await esperar();
    expect(otraVez.url('m-1')).toBeNull();
    expect(otraVez.url('m-2')).toBeNull();
    expect(alCambiar).toHaveBeenCalledTimes(2);
  });

  it('las fotos son por viaje: el mismo id de miembro en otro viaje es otra clave', async () => {
    const pedir = vi.fn(async () => new Blob(['x'], { type: 'image/jpeg' }));
    const { fotos, nueva } = armar(pedir);
    fotos.cargar([miembro('m-1', true)]);
    await esperar();
    expect(nueva('v-2').url('m-1')).toBeNull();
    expect(claveMiembroDeViaje('v-1', 'm-1')).not.toBe(claveMiembroDeViaje('v-2', 'm-1'));
  });

  it('cerrar sesión revoca las fotos del viaje', async () => {
    const pedir = vi.fn(async () => new Blob(['x'], { type: 'image/jpeg' }));
    const { fotos, creadas, revocadas, cerrarSesion } = armar(pedir);
    fotos.cargar([miembro('m-1', true)]);
    await esperar();
    cerrarSesion();
    expect(revocadas).toEqual(creadas);
    expect(fotos.url('m-1')).toBeNull();
  });

  it('🔴 H04 · has_avatar false llega con el pedido en curso: el 200 tardío no la guarda', async () => {
    let soltar: (b: Blob) => void = () => undefined;
    const pedir = vi.fn(() => new Promise<Blob>((r) => { soltar = r; }));
    const { fotos, alCambiar } = armar(pedir);
    fotos.cargar([miembro('m-1', true)]);
    await esperar();
    expect(pedir).toHaveBeenCalledTimes(1);
    fotos.cargar([miembro('m-1', false)]);
    soltar(new Blob(['x'], { type: 'image/jpeg' }));
    await esperar();
    expect(fotos.url('m-1')).toBeNull();
    expect(alCambiar).not.toHaveBeenCalled();
  });
});
