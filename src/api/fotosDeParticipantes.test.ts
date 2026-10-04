import { describe, expect, it, vi } from 'vitest';
import { FotosDeParticipantes } from './fotosDeParticipantes';
import { FotosEnMemoria, duenoDeSesion } from './fotosEnMemoria';
import { MockApiError } from './mock/mockApi';
import type { Participante } from './participantes';
import type { StoredSession } from './storage';

const persona = (id: string | null, hasAvatar: boolean): Participante => ({
  firstName: 'Ana', lastName: 'Pérez', paymeId: 'payme_ap', participantId: id, hasAvatar, username: null,
});

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
  const nueva = (mesa = 'PA-1') => new FotosDeParticipantes(mesa, () => SESION, (id) => pedir(id), alCambiar, cache);
  const cerrarSesion = () => { vigente = null; cache.vaciar(); };
  return { fotos: nueva(), nueva, cache, creadas, revocadas, alCambiar, cerrarSesion };
}

const esperar = () => new Promise((r) => setTimeout(r, 0));

describe('AF-32 · FotosDeParticipantes', () => {
  it('pide SÓLO con has_avatar y participant_id, una vez por persona', async () => {
    const pedir = vi.fn(async () => new Blob(['x'], { type: 'image/jpeg' }));
    const { fotos, alCambiar } = armar(pedir);
    const lista = [persona('p-1', true), persona('p-2', false), persona(null, true)];
    fotos.cargar(lista);
    fotos.cargar(lista); // una recarga de la lista no repite pedidos
    await esperar();
    expect(pedir).toHaveBeenCalledTimes(1);
    expect(pedir).toHaveBeenCalledWith('p-1');
    expect(fotos.url('p-1')).toBe('blob:foto-1');
    expect(fotos.url('p-2')).toBeNull();
    expect(alCambiar).toHaveBeenCalledTimes(1);
  });

  it('🔴 ante un error: iniciales y NINGÚN reintento', async () => {
    const pedir = vi.fn(async () => { throw new Error('avatar_response_media_type_invalid'); });
    const { fotos } = armar(pedir);
    fotos.cargar([persona('p-1', true)]);
    await esperar();
    fotos.cargar([persona('p-1', true)]);
    await esperar();
    expect(pedir).toHaveBeenCalledTimes(1);
    expect(fotos.url('p-1')).toBeNull();
  });

  it('🔴 E173-3 · dispose YA NO revoca: volver a la mesa la muestra al instante y la revalida', async () => {
    let contenido = 'x';
    const pedir = vi.fn(async () => new Blob([contenido], { type: 'image/jpeg' }));
    const { fotos, nueva, creadas, revocadas } = armar(pedir);
    fotos.cargar([persona('p-1', true), persona('p-2', true)]);
    await esperar();
    expect(creadas).toHaveLength(2);
    fotos.dispose();
    expect(revocadas).toEqual([]);

    const otraVez = nueva();
    // Antes de pedir nada: la guardada ya se ve.
    expect(otraVez.url('p-1')).toBe('blob:foto-1');
    contenido = 'y';
    otraVez.cargar([persona('p-1', true)]);
    await esperar();
    expect(pedir).toHaveBeenCalledTimes(3);
    expect(otraVez.url('p-1')).toBe('blob:foto-3');
    expect(revocadas).toEqual(['blob:foto-1']);
  });

  it('🔴 un 404 al revalidar retira la foto; has_avatar false también', async () => {
    let respuesta: 'foto' | '404' = 'foto';
    const pedir = vi.fn(async () => {
      if (respuesta === '404') throw new MockApiError(404, 'avatar_not_found');
      return new Blob(['x'], { type: 'image/jpeg' });
    });
    const { fotos, nueva, alCambiar } = armar(pedir);
    fotos.cargar([persona('p-1', true), persona('p-2', true)]);
    await esperar();
    fotos.dispose();

    respuesta = '404';
    const otraVez = nueva();
    alCambiar.mockClear();
    otraVez.cargar([persona('p-1', true), persona('p-2', false)]);
    await esperar();
    expect(otraVez.url('p-1')).toBeNull();
    expect(otraVez.url('p-2')).toBeNull();
    expect(alCambiar).toHaveBeenCalledTimes(2);
  });

  it('las fotos son por mesa: la misma persona en otra mesa es otra clave', async () => {
    const pedir = vi.fn(async () => new Blob(['x'], { type: 'image/jpeg' }));
    const { fotos, nueva } = armar(pedir);
    fotos.cargar([persona('p-1', true)]);
    await esperar();
    expect(nueva('PA-2').url('p-1')).toBeNull();
  });

  it('cerrar sesión revoca las fotos de la mesa', async () => {
    const pedir = vi.fn(async () => new Blob(['x'], { type: 'image/jpeg' }));
    const { fotos, creadas, revocadas, cerrarSesion } = armar(pedir);
    fotos.cargar([persona('p-1', true)]);
    await esperar();
    cerrarSesion();
    expect(revocadas).toEqual(creadas);
    expect(fotos.url('p-1')).toBeNull();
  });

  it('una foto que llega después de dispose se guarda (misma sesión) pero no avisa a la pantalla', async () => {
    let soltar: (b: Blob) => void = () => undefined;
    const pedir = vi.fn(() => new Promise<Blob>((r) => { soltar = r; }));
    const { fotos, nueva, alCambiar } = armar(pedir);
    fotos.cargar([persona('p-1', true)]);
    await esperar();
    fotos.dispose();
    soltar(new Blob(['x'], { type: 'image/jpeg' }));
    await esperar();
    expect(alCambiar).not.toHaveBeenCalled();
    expect(nueva().url('p-1')).toBe('blob:foto-1');
  });
});
