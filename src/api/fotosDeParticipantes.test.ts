import { describe, expect, it, vi } from 'vitest';
import { FotosDeParticipantes } from './fotosDeParticipantes';
import { AvatarObjectUrlLease } from './profileIdentity';
import type { Participante } from './participantes';

const persona = (id: string | null, hasAvatar: boolean): Participante => ({
  firstName: 'Ana', lastName: 'Pérez', paymeId: 'payme_ap', participantId: id, hasAvatar,
});

function armar(pedir: (id: string) => Promise<Blob>) {
  const creadas: string[] = [];
  const revocadas: string[] = [];
  let n = 0;
  const alCambiar = vi.fn();
  const fotos = new FotosDeParticipantes(
    pedir,
    alCambiar,
    () => new AvatarObjectUrlLease(
      () => { n += 1; const u = `blob:foto-${n}`; creadas.push(u); return u; },
      (u) => { revocadas.push(u); },
    ),
  );
  return { fotos, creadas, revocadas, alCambiar };
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
    const pedir = vi.fn(async () => { throw new Error('avatar_not_found'); });
    const { fotos } = armar(pedir);
    fotos.cargar([persona('p-1', true)]);
    await esperar();
    fotos.cargar([persona('p-1', true)]);
    await esperar();
    expect(pedir).toHaveBeenCalledTimes(1);
    expect(fotos.url('p-1')).toBeNull();
  });

  it('🔴 dispose REVOCA cada URL de objeto', async () => {
    const pedir = vi.fn(async () => new Blob(['x'], { type: 'image/jpeg' }));
    const { fotos, creadas, revocadas } = armar(pedir);
    fotos.cargar([persona('p-1', true), persona('p-2', true)]);
    await esperar();
    expect(creadas).toHaveLength(2);
    fotos.dispose();
    expect([...revocadas].sort()).toEqual([...creadas].sort());
    expect(fotos.url('p-1')).toBeNull();
  });

  it('una foto que llega después de dispose no crea URL', async () => {
    let soltar: (b: Blob) => void = () => undefined;
    const pedir = vi.fn(() => new Promise<Blob>((r) => { soltar = r; }));
    const { fotos, creadas } = armar(pedir);
    fotos.cargar([persona('p-1', true)]);
    fotos.dispose();
    soltar(new Blob(['x'], { type: 'image/jpeg' }));
    await esperar();
    expect(creadas).toHaveLength(0);
  });
});
