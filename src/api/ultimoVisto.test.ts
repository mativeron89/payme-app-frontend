/**
 * D237 · «lo último visto»: de quién es, cuándo se vacía, que lo igual no se
 * vuelve a dibujar, y dónde se puede leer (sólo pantallas que MUESTRAN).
 */
import { describe, expect, it } from 'vitest';
import { CLAVES_DE_AMIGOS, CLAVES_DE_MESAS, UltimoVisto, subioSinLeer } from './ultimoVisto';

function conDueno(inicial: string | null) {
  const estado = { dueno: inicial };
  const cache = new UltimoVisto(() => estado.dueno);
  return { cache, estado };
}

describe('D237 · lo último visto, en memoria y por cuenta', () => {
  it('sin nada guardado no hay nada', () => {
    const { cache } = conDueno('A');
    expect(cache.leer('inicio.mesasAbiertas')).toBeUndefined();
  });

  it('lo guardado con una cuenta se lee con esa cuenta', () => {
    const { cache } = conDueno('A');
    cache.guardar('mesas.historial', [{ id: 1 }]);
    expect(cache.leer('mesas.historial')).toEqual([{ id: 1 }]);
  });

  it('🔴 si lo nuevo es IGUAL, devuelve el MISMO objeto de antes (React no vuelve a dibujar)', () => {
    const { cache } = conDueno('A');
    const primero = cache.guardar('amigos.amigos', [{ id: 'x', nombre: 'Ana' }]);
    const igual = cache.guardar('amigos.amigos', [{ id: 'x', nombre: 'Ana' }]);
    expect(igual).toBe(primero);
    const distinto = cache.guardar('amigos.amigos', [{ id: 'x', nombre: 'Ana López' }]);
    expect(distinto).not.toBe(primero);
    expect(cache.leer('amigos.amigos')).toBe(distinto);
  });

  it('🔴 con otra cuenta adentro no se lee nada, y lo de la anterior se vacía', () => {
    const { cache, estado } = conDueno('A');
    cache.guardar('inicio.mesasAbiertas', { mesas: ['PA-1'] });
    estado.dueno = 'B';
    expect(cache.leer('inicio.mesasAbiertas')).toBeUndefined();
    expect(cache.tamano()).toBe(0);
    // Y aunque vuelva la A, lo suyo ya no está.
    estado.dueno = 'A';
    expect(cache.leer('inicio.mesasAbiertas')).toBeUndefined();
  });

  it('🔴 sin sesión no se lee ni se guarda', () => {
    const { cache, estado } = conDueno('A');
    cache.guardar('sinLeer', 3);
    estado.dueno = null;
    expect(cache.leer('sinLeer')).toBeUndefined();
    cache.guardar('sinLeer', 5);
    expect(cache.tamano()).toBe(0);
  });

  it('🔴 al cambiar la sesión (cerrar, otra cuenta) se vacía solo', () => {
    const { cache, estado } = conDueno('A');
    let avisar: () => void = () => undefined;
    cache.vigilarSesion((oyente) => {
      avisar = oyente;
      return () => undefined;
    });
    cache.guardar('amigos.grupos', ['Familia']);
    cache.guardar('mesas.tusMesas', { mesas: [] });
    // Un refresco de tokens no cambia el dueño: no se vacía.
    avisar();
    expect(cache.tamano()).toBe(2);
    // Cerrar sesión.
    estado.dueno = null;
    avisar();
    expect(cache.tamano()).toBe(0);
  });

  it('olvidar borra sólo lo pedido; las listas de mesas y de amigos', () => {
    const { cache } = conDueno('A');
    for (const clave of [...CLAVES_DE_MESAS, ...CLAVES_DE_AMIGOS, 'sinLeer'] as const) cache.guardar(clave, 1);
    cache.olvidar(...CLAVES_DE_MESAS);
    for (const clave of CLAVES_DE_MESAS) expect(cache.leer(clave)).toBeUndefined();
    for (const clave of CLAVES_DE_AMIGOS) expect(cache.leer(clave)).toBe(1);
    expect(cache.leer('sinLeer')).toBe(1);
    expect(CLAVES_DE_MESAS).toEqual(['inicio.mesasAbiertas', 'inicio.invitaciones', 'mesas.tusMesas', 'mesas.historial']);
    expect(CLAVES_DE_AMIGOS).toEqual(['amigos.amigos', 'amigos.grupos', 'amigos.solicitudes']);
  });

  it('🔴 al llegar el sin leer: si SUBIÓ se borra lo de las mesas, y nada más', () => {
    const { cache } = conDueno('A');
    expect(cache.registrarSinLeer(2)).toBe(2);
    for (const clave of [...CLAVES_DE_MESAS, ...CLAVES_DE_AMIGOS] as const) cache.guardar(clave, 1);
    // Igual: no se toca nada.
    cache.registrarSinLeer(2);
    for (const clave of CLAVES_DE_MESAS) expect(cache.leer(clave)).toBe(1);
    // Bajó (se leyó un aviso): tampoco.
    cache.registrarSinLeer(1);
    for (const clave of CLAVES_DE_MESAS) expect(cache.leer(clave)).toBe(1);
    // Subió: lo de las mesas se va; lo de Amigos queda.
    expect(cache.registrarSinLeer(3)).toBe(3);
    for (const clave of CLAVES_DE_MESAS) expect(cache.leer(clave)).toBeUndefined();
    for (const clave of CLAVES_DE_AMIGOS) expect(cache.leer(clave)).toBe(1);
    expect(cache.leer('sinLeer')).toBe(3);
  });

  it('el sin leer que SUBE borra lo de las mesas; igual o menos, no', () => {
    expect(subioSinLeer(undefined, 4)).toBe(false);
    expect(subioSinLeer(2, 2)).toBe(false);
    expect(subioSinLeer(3, 1)).toBe(false);
    expect(subioSinLeer(2, 3)).toBe(true);
  });
});

const FUENTES = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

describe('🔴 D237 · guardas: memoria sola, y sólo para mostrar', () => {
  it('el módulo no toca localStorage, sessionStorage ni IndexedDB', () => {
    const codigo = FUENTES['./ultimoVisto.ts']!.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(codigo).not.toMatch(/localStorage|sessionStorage|indexedDB|IDB/);
  });

  /**
   * Los ÚNICOS archivos que leen lo último visto. Son pantallas que muestran
   * listas; ninguno es un camino de acción (pagar, cerrar la mesa, aceptar,
   * rechazar, unirse), que piden lo suyo. Sumar uno es un acto explícito: hay
   * que agregarlo acá y explicar por qué no es una acción.
   */
  const LECTORES = [
    '../components/useSinLeer.ts',
    '../screens/HomeScreen.tsx',
    '../screens/InvitacionEnInicio.tsx',
    '../screens/MesasScreen.tsx',
    '../screens/SocialScreen.tsx',
  ];

  it('sólo estos archivos leen lo último visto', () => {
    const lectores = Object.entries(FUENTES)
      .filter(([ruta]) => !/\.test\.tsx?$/.test(ruta) && ruta !== './ultimoVisto.ts')
      .filter(([, codigo]) => /ultimoVisto\.leer\s*[<(]/.test(codigo))
      .map(([ruta]) => ruta)
      .sort();
    expect(lectores).toEqual(LECTORES);
  });

  it('ni la mesa, ni el alta, ni la cámara, ni Avisos lo leen', () => {
    for (const ruta of ['../screens/MesaScreen.tsx', '../screens/CreateMesaFlow.tsx', '../screens/AvisosScreen.tsx', '../screens/JoinMesaScreen.tsx']) {
      expect(FUENTES[ruta], ruta).toBeDefined();
      expect(FUENTES[ruta], ruta).not.toMatch(/ultimoVisto\.leer|ultimoVisto\.guardar/);
    }
  });
});
