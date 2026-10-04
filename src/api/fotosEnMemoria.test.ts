import { describe, expect, it } from 'vitest';
import {
  FotosEnMemoria,
  claveAmigo,
  duenoDeSesion,
  podarFotosDeAmigos,
  PREFIJO_AMIGO,
} from './fotosEnMemoria';
import { MockApiError } from './mock/mockApi';

/**
 * E173-3 · decisión 175 · el caché de fotos en memoria. Las URLs son de mentira
 * y se cuentan: así se ve qué se creó, qué se revocó y cuándo.
 */
const ANA = { family_id: 'fam-ana', principal_id: 'u-ana' };
const BETO = { family_id: 'fam-beto', principal_id: 'u-beto' };

function armar(opciones: { maximo?: number } = {}) {
  let vigente: string | null = duenoDeSesion(ANA);
  const creadas: string[] = [];
  const revocadas: string[] = [];
  let n = 0;
  const oyentesDeSesion = new Set<() => void>();
  const cache = new FotosEnMemoria({
    crearUrl: () => { n += 1; const u = `blob:foto-${n}`; creadas.push(u); return u; },
    revocarUrl: (u) => { revocadas.push(u); },
    duenoVigente: () => vigente,
    maximo: opciones.maximo,
  });
  const soltarVigilancia = cache.vigilarSesion((oyente) => {
    oyentesDeSesion.add(oyente);
    return () => oyentesDeSesion.delete(oyente);
  });
  const cambiarSesion = (s: typeof ANA | null) => {
    vigente = s ? duenoDeSesion(s) : null;
    for (const o of oyentesDeSesion) o();
  };
  /** Como cuando el aviso de otra pestaña no llega: cambia la sesión sin avisar. */
  const cambiarSinAvisar = (s: typeof ANA | null) => {
    vigente = s ? duenoDeSesion(s) : null;
  };
  return { cache, creadas, revocadas, cambiarSesion, cambiarSinAvisar, soltarVigilancia, oyentesDeSesion };
}

const foto = (contenido: string) => new Blob([contenido], { type: 'image/jpeg' });
const no404 = () => Promise.reject(new MockApiError(404, 'avatar_not_found'));

function diferido<T>() {
  let resolver: (v: T) => void = () => undefined;
  let rechazar: (e: unknown) => void = () => undefined;
  const promesa = new Promise<T>((res, rej) => { resolver = res; rechazar = rej; });
  return { promesa, resolver, rechazar };
}

describe('E173-3 · FotosEnMemoria', () => {
  it('🔴 hit: la segunda vez la foto ya está, y revalidar con los mismos bytes no crea ni revoca nada', async () => {
    const { cache, creadas, revocadas } = armar();
    const clave = claveAmigo('sofi');
    expect(cache.ver(ANA, clave)).toBeNull();
    expect(await cache.cargar(ANA, clave, async () => foto('A'))).toBe('guardada');
    expect(cache.ver(ANA, clave)).toBe('blob:foto-1');

    expect(await cache.cargar(ANA, clave, async () => foto('A'))).toBe('igual');
    expect(cache.ver(ANA, clave)).toBe('blob:foto-1');
    expect(creadas).toEqual(['blob:foto-1']);
    expect(revocadas).toEqual([]);
  });

  it('🔴 revalidación: mientras viaja se sigue viendo la guardada; con bytes nuevos reemplaza y revoca la vieja', async () => {
    const { cache, revocadas } = armar();
    const clave = claveAmigo('sofi');
    await cache.cargar(ANA, clave, async () => foto('A'));
    const pedido = diferido<Blob>();
    const enCurso = cache.cargar(ANA, clave, () => pedido.promesa);
    expect(cache.ver(ANA, clave)).toBe('blob:foto-1');
    pedido.resolver(foto('B'));
    expect(await enCurso).toBe('guardada');
    expect(cache.ver(ANA, clave)).toBe('blob:foto-2');
    expect(revocadas).toEqual(['blob:foto-1']);
  });

  it('🔴 revalidación con 404: la foto se retira y su URL se revoca', async () => {
    const { cache, revocadas } = armar();
    const clave = claveAmigo('sofi');
    await cache.cargar(ANA, clave, async () => foto('A'));
    expect(await cache.cargar(ANA, clave, no404)).toBe('retirada');
    expect(cache.ver(ANA, clave)).toBeNull();
    expect(revocadas).toEqual(['blob:foto-1']);
  });

  it.each([
    ['un 500', () => Promise.reject(new MockApiError(500, 'internal'))],
    ['un error de red', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['una respuesta inválida', () => Promise.reject(new Error('avatar_response_media_type_invalid'))],
  ])('%s NO retira la guardada: no prueba que la foto ya no se pueda ver', async (_caso, pedir) => {
    const { cache, revocadas } = armar();
    const clave = claveAmigo('sofi');
    await cache.cargar(ANA, clave, async () => foto('A'));
    expect(await cache.cargar(ANA, clave, pedir)).toBe('conservada');
    expect(cache.ver(ANA, clave)).toBe('blob:foto-1');
    expect(revocadas).toEqual([]);
  });

  it('dos pedidos simultáneos de la misma foto viajan una sola vez', async () => {
    const { cache } = armar();
    let pedidos = 0;
    const pedido = diferido<Blob>();
    const pedir = () => { pedidos += 1; return pedido.promesa; };
    const a = cache.cargar(ANA, claveAmigo('sofi'), pedir);
    const b = cache.cargar(ANA, claveAmigo('sofi'), pedir);
    pedido.resolver(foto('A'));
    expect(await a).toBe('guardada');
    expect(await b).toBe('guardada');
    expect(pedidos).toBe(1);
  });

  it('🔴 cerrar sesión vacía la memoria de fotos y revoca TODO', async () => {
    const { cache, creadas, revocadas, cambiarSesion } = armar();
    await cache.cargar(ANA, claveAmigo('sofi'), async () => foto('A'));
    await cache.cargar(ANA, 'propia:rev-1', async () => foto('P'));
    cambiarSesion(null);
    expect(cache.tamano).toBe(0);
    expect([...revocadas].sort()).toEqual([...creadas].sort());
    expect(cache.ver(ANA, claveAmigo('sofi'))).toBeNull();
  });

  it('🔴 cambiar de cuenta vacía la memoria de fotos: la otra sesión no ve nada de la anterior', async () => {
    const { cache, revocadas, cambiarSesion } = armar();
    await cache.cargar(ANA, claveAmigo('sofi'), async () => foto('A'));
    cambiarSesion(BETO);
    expect(revocadas).toEqual(['blob:foto-1']);
    expect(cache.ver(BETO, claveAmigo('sofi'))).toBeNull();
    expect(cache.ver(ANA, claveAmigo('sofi'))).toBeNull();
  });

  it('🔴 aunque el aviso de sesión no llegue, la primera carga de otra cuenta vacía la memoria y revoca', async () => {
    const { cache, revocadas, cambiarSinAvisar } = armar();
    await cache.cargar(ANA, claveAmigo('sofi'), async () => foto('A'));
    cambiarSinAvisar(BETO);
    expect(cache.ver(BETO, claveAmigo('sofi'))).toBeNull();
    await cache.cargar(BETO, claveAmigo('juan'), async () => foto('J'));
    expect(revocadas).toEqual(['blob:foto-1']);
    expect(cache.ver(BETO, claveAmigo('sofi'))).toBeNull();
    expect(cache.tamano).toBe(1);
  });

  it('un refresh de tokens (mismo dueño) NO vacía la memoria de fotos', async () => {
    const { cache, revocadas, cambiarSesion } = armar();
    await cache.cargar(ANA, claveAmigo('sofi'), async () => foto('A'));
    cambiarSesion({ ...ANA });
    expect(cache.ver(ANA, claveAmigo('sofi'))).toBe('blob:foto-1');
    expect(revocadas).toEqual([]);
  });

  it('🔴 una foto que llega después de cerrar sesión se descarta: no crea URL', async () => {
    const { cache, creadas, cambiarSesion } = armar();
    const pedido = diferido<Blob>();
    const enCurso = cache.cargar(ANA, claveAmigo('sofi'), () => pedido.promesa);
    cambiarSesion(null);
    pedido.resolver(foto('A'));
    expect(await enCurso).toBe('descartada');
    expect(creadas).toEqual([]);
    expect(cache.tamano).toBe(0);
  });

  it('un 404 que llega después de cambiar de cuenta no toca las fotos de la cuenta nueva', async () => {
    const { cache, cambiarSesion } = armar();
    const pedido = diferido<Blob>();
    const enCurso = cache.cargar(ANA, claveAmigo('sofi'), () => pedido.promesa);
    cambiarSesion(BETO);
    await cache.cargar(BETO, claveAmigo('sofi'), async () => foto('B'));
    pedido.rechazar(new MockApiError(404, 'avatar_not_found'));
    expect(await enCurso).toBe('descartada');
    expect(cache.ver(BETO, claveAmigo('sofi'))).not.toBeNull();
  });

  it('con una sesión que no es la vigente, ni siquiera pide', async () => {
    const { cache } = armar();
    let pedidos = 0;
    expect(await cache.cargar(BETO, claveAmigo('sofi'), async () => { pedidos += 1; return foto('A'); })).toBe('descartada');
    expect(pedidos).toBe(0);
  });

  it('podar deja sólo las del prefijo que siguen en la lista, y revoca el resto', async () => {
    const { cache, revocadas } = armar();
    await cache.cargar(ANA, claveAmigo('sofi'), async () => foto('S'));
    await cache.cargar(ANA, claveAmigo('juan'), async () => foto('J'));
    await cache.cargar(ANA, 'propia:rev-1', async () => foto('P'));
    cache.podar(ANA, PREFIJO_AMIGO, new Set(['sofi']));
    expect(cache.ver(ANA, claveAmigo('sofi'))).toBe('blob:foto-1');
    expect(cache.ver(ANA, claveAmigo('juan'))).toBeNull();
    expect(cache.ver(ANA, 'propia:rev-1')).toBe('blob:foto-3');
    expect(revocadas).toEqual(['blob:foto-2']);
  });

  it('🔴 podarFotosDeAmigos: sale quien ya no está y quien tiene has_avatar false; sin la clave (dueño viejo) se conserva', async () => {
    const { cache } = armar();
    for (const id of ['sofi', 'juan', 'maria', 'ex']) await cache.cargar(ANA, claveAmigo(id), async () => foto(id));
    podarFotosDeAmigos(ANA, [
      { id: 'sofi', has_avatar: true },
      { id: 'juan' },
      { id: 'maria', has_avatar: false },
    ], cache);
    expect(cache.tiene(ANA, claveAmigo('sofi'))).toBe(true);
    expect(cache.tiene(ANA, claveAmigo('juan'))).toBe(true);
    expect(cache.tiene(ANA, claveAmigo('maria'))).toBe(false);
    expect(cache.tiene(ANA, claveAmigo('ex'))).toBe(false);
  });

  it('retirar saca una sola, y con otra sesión no hace nada', async () => {
    const { cache, revocadas } = armar();
    await cache.cargar(ANA, claveAmigo('sofi'), async () => foto('S'));
    cache.retirar(BETO, claveAmigo('sofi'));
    expect(cache.tiene(ANA, claveAmigo('sofi'))).toBe(true);
    cache.retirar(ANA, claveAmigo('sofi'));
    expect(cache.tiene(ANA, claveAmigo('sofi'))).toBe(false);
    expect(revocadas).toEqual(['blob:foto-1']);
  });

  it('con el tope lleno sale la menos usada, y su URL se revoca', async () => {
    const { cache, revocadas } = armar({ maximo: 2 });
    await cache.cargar(ANA, 'a', async () => foto('1'));
    await cache.cargar(ANA, 'b', async () => foto('2'));
    // Revalidar «a» la vuelve la más usada.
    expect(await cache.cargar(ANA, 'a', async () => foto('1'))).toBe('igual');
    await cache.cargar(ANA, 'c', async () => foto('3'));
    expect(cache.tiene(ANA, 'a')).toBe(true);
    expect(cache.tiene(ANA, 'b')).toBe(false);
    expect(cache.tiene(ANA, 'c')).toBe(true);
    expect(revocadas).toEqual(['blob:foto-2']);
  });

  it('avisa a los suscriptores al guardar, reemplazar y retirar; no con los mismos bytes', async () => {
    const { cache } = armar();
    let avisos = 0;
    const soltar = cache.suscribir(() => { avisos += 1; });
    await cache.cargar(ANA, 'a', async () => foto('1'));
    expect(avisos).toBe(1);
    await cache.cargar(ANA, 'a', async () => foto('1'));
    expect(avisos).toBe(1);
    await cache.cargar(ANA, 'a', async () => foto('2'));
    expect(avisos).toBe(2);
    await cache.cargar(ANA, 'a', no404);
    expect(avisos).toBe(3);
    soltar();
    await cache.cargar(ANA, 'a', async () => foto('3'));
    expect(avisos).toBe(3);
  });

  it('soltar la vigilancia deja de escuchar la sesión', () => {
    const { soltarVigilancia, oyentesDeSesion } = armar();
    expect(oyentesDeSesion.size).toBe(1);
    soltarVigilancia();
    expect(oyentesDeSesion.size).toBe(0);
  });
});

describe('E173-3 · sólo memoria (decisión 175)', () => {
  const FUENTE = import.meta.glob('./fotosEnMemoria.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const codigo = (FUENTE['./fotosEnMemoria.ts'] ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('🔴 las fotos no persisten: ni localStorage, ni sessionStorage, ni IndexedDB, ni Cache API', () => {
    expect(codigo.length).toBeGreaterThan(0);
    for (const prohibido of ['localStorage', 'sessionStorage', 'indexedDB', 'caches.', 'CacheStorage']) {
      expect(codigo, prohibido).not.toContain(prohibido);
    }
  });
});
