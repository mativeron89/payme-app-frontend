/**
 * D237 · «lo último visto»: de quién es, cuándo se vacía, que lo igual no se
 * vuelve a dibujar, y dónde se puede leer (sólo pantallas que MUESTRAN).
 */
import { describe, expect, it } from 'vitest';
import { CLAVES_DE_AMIGOS, CLAVES_DE_MESAS, UltimoVisto, subioSinLeer, type ClaveUltimoVisto } from './ultimoVisto';

function conDueno(inicial: string | null) {
  const estado = { dueno: inicial };
  const cache = new UltimoVisto(() => estado.dueno);
  /** Pide y guarda en el acto, con la cuenta de ahora (el caso de siempre). */
  const guardarYa = <T>(clave: ClaveUltimoVisto, valor: T) => cache.guardar(cache.turno(), clave, valor)?.valor;
  const sinLeerYa = (n: number) => cache.registrarSinLeer(cache.turno(), n)?.valor;
  return { cache, estado, guardarYa, sinLeerYa };
}

describe('D237 · lo último visto, en memoria y por cuenta', () => {
  it('sin nada guardado no hay nada', () => {
    const { cache } = conDueno('A');
    expect(cache.leer('inicio.mesasAbiertas')).toBeUndefined();
  });

  it('lo guardado con una cuenta se lee con esa cuenta', () => {
    const { cache, guardarYa } = conDueno('A');
    guardarYa('mesas.historial', [{ id: 1 }]);
    expect(cache.leer('mesas.historial')).toEqual([{ id: 1 }]);
  });

  it('🔴 si lo nuevo es IGUAL, devuelve el MISMO objeto de antes (React no vuelve a dibujar)', () => {
    const { cache, guardarYa } = conDueno('A');
    const primero = guardarYa('amigos.amigos', [{ id: 'x', nombre: 'Ana' }]);
    const igual = guardarYa('amigos.amigos', [{ id: 'x', nombre: 'Ana' }]);
    expect(igual).toBe(primero);
    const distinto = guardarYa('amigos.amigos', [{ id: 'x', nombre: 'Ana López' }]);
    expect(distinto).not.toBe(primero);
    expect(cache.leer('amigos.amigos')).toBe(distinto);
  });

  it('🔴 con otra cuenta adentro no se lee nada, y lo de la anterior se vacía', () => {
    const { cache, estado, guardarYa } = conDueno('A');
    guardarYa('inicio.mesasAbiertas', { mesas: ['PA-1'] });
    estado.dueno = 'B';
    expect(cache.leer('inicio.mesasAbiertas')).toBeUndefined();
    expect(cache.tamano()).toBe(0);
    // Y aunque vuelva la A, lo suyo ya no está.
    estado.dueno = 'A';
    expect(cache.leer('inicio.mesasAbiertas')).toBeUndefined();
  });

  it('🔴 sin sesión no se lee ni se guarda', () => {
    const { cache, estado, guardarYa } = conDueno('A');
    guardarYa('sinLeer', 3);
    estado.dueno = null;
    expect(cache.leer('sinLeer')).toBeUndefined();
    guardarYa('sinLeer', 5);
    expect(cache.tamano()).toBe(0);
  });

  it('🔴 al cambiar la sesión (cerrar, otra cuenta) se vacía solo', () => {
    const { cache, estado, guardarYa } = conDueno('A');
    let avisar: () => void = () => undefined;
    cache.vigilarSesion((oyente) => {
      avisar = oyente;
      return () => undefined;
    });
    guardarYa('amigos.grupos', ['Familia']);
    guardarYa('mesas.tusMesas', { mesas: [] });
    // Un refresco de tokens no cambia el dueño: no se vacía.
    avisar();
    expect(cache.tamano()).toBe(2);
    // Cerrar sesión.
    estado.dueno = null;
    avisar();
    expect(cache.tamano()).toBe(0);
  });

  it('olvidar borra sólo lo pedido; las listas de mesas y de amigos', () => {
    const { cache, guardarYa } = conDueno('A');
    for (const clave of [...CLAVES_DE_MESAS, ...CLAVES_DE_AMIGOS, 'sinLeer'] as const) guardarYa(clave, 1);
    cache.olvidar(...CLAVES_DE_MESAS);
    for (const clave of CLAVES_DE_MESAS) expect(cache.leer(clave)).toBeUndefined();
    for (const clave of CLAVES_DE_AMIGOS) expect(cache.leer(clave)).toBe(1);
    expect(cache.leer('sinLeer')).toBe(1);
    expect(CLAVES_DE_MESAS).toEqual(['inicio.mesasAbiertas', 'inicio.invitaciones', 'mesas.tusMesas', 'mesas.historial']);
    expect(CLAVES_DE_AMIGOS).toEqual(['amigos.amigos', 'amigos.grupos', 'amigos.solicitudes']);
  });

  it('🔴 al llegar el sin leer: si SUBIÓ se borra lo de las mesas, y nada más', () => {
    const { cache, guardarYa, sinLeerYa } = conDueno('A');
    expect(sinLeerYa(2)).toBe(2);
    for (const clave of [...CLAVES_DE_MESAS, ...CLAVES_DE_AMIGOS] as const) guardarYa(clave, 1);
    // Igual: no se toca nada.
    sinLeerYa(2);
    for (const clave of CLAVES_DE_MESAS) expect(cache.leer(clave)).toBe(1);
    // Bajó (se leyó un aviso): tampoco.
    sinLeerYa(1);
    for (const clave of CLAVES_DE_MESAS) expect(cache.leer(clave)).toBe(1);
    // Subió: lo de las mesas se va; lo de Amigos queda.
    expect(sinLeerYa(3)).toBe(3);
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

/** Con la sesión enganchada, como en la app (`AuthProvider`). */
function conSesion(inicial: string | null) {
  const r = conDueno(inicial);
  let avisar: () => void = () => undefined;
  r.cache.vigilarSesion((oyente) => {
    avisar = oyente;
    return () => undefined;
  });
  const cambiarA = (dueno: string | null) => {
    r.estado.dueno = dueno;
    avisar();
  };
  return { ...r, cambiarA };
}

describe('🔴 T-01 · la respuesta tardía de otra cuenta no se guarda ni se muestra', () => {
  it('A pide, cierra sesión, entra B y recién ahí llega lo de A: B no lo ve', () => {
    const { cache, cambiarA, guardarYa } = conSesion('A');
    guardarYa('amigos.grupos', ['Familia de A']);
    const deA = cache.turno();
    cambiarA(null);
    cambiarA('B');
    expect(cache.esDeAhora(deA)).toBe(false);
    expect(cache.guardar(deA, 'amigos.amigos', [{ id: 'amiga-de-A' }])).toBeNull();
    expect(cache.leer('amigos.amigos')).toBeUndefined();
    expect(cache.tamano()).toBe(0);
    // Lo que pide B sí se guarda.
    expect(guardarYa('amigos.amigos', [{ id: 'amigo-de-B' }])).toEqual([{ id: 'amigo-de-B' }]);
    expect(cache.leer('amigos.amigos')).toEqual([{ id: 'amigo-de-B' }]);
  });

  it('lo mismo con nada guardado todavía de A', () => {
    const { cache, cambiarA } = conSesion('A');
    const deA = cache.turno();
    cambiarA(null);
    cambiarA('B');
    expect(cache.guardar(deA, 'inicio.mesasAbiertas', { mesas: ['PA-1'] })).toBeNull();
    expect(cache.leer('inicio.mesasAbiertas')).toBeUndefined();
    expect(cache.tamano()).toBe(0);
  });

  it('lo mismo si la sesión cambió sin aviso (otra pestaña del navegador)', () => {
    const { cache, estado, guardarYa } = conDueno('A');
    guardarYa('mesas.historial', [{ id: 'pago-de-A' }]);
    const deA = cache.turno();
    estado.dueno = 'B';
    expect(cache.guardar(deA, 'mesas.historial', [{ id: 'otro-pago-de-A' }])).toBeNull();
    expect(cache.leer('mesas.historial')).toBeUndefined();
  });

  it('🔴 un «vaciar» en el medio: lo pedido antes no se guarda, aunque sea la misma cuenta', () => {
    const { cache, guardarYa } = conDueno('A');
    guardarYa('mesas.historial', [{ id: 1 }]);
    const antes = cache.turno();
    cache.vaciar();
    expect(cache.esDeAhora(antes)).toBe(false);
    expect(cache.guardar(antes, 'mesas.historial', [{ id: 2 }])).toBeNull();
    expect(cache.registrarSinLeer(antes, 9)).toBeNull();
    expect(cache.leer('mesas.historial')).toBeUndefined();
    expect(cache.leer('sinLeer')).toBeUndefined();
    // Lo pedido después del vaciar, sí.
    expect(guardarYa('mesas.historial', [{ id: 3 }])).toEqual([{ id: 3 }]);
  });

  it('el sin leer tardío de A no borra lo de las mesas de B', () => {
    const { cache, cambiarA, guardarYa, sinLeerYa } = conSesion('A');
    sinLeerYa(1);
    const deA = cache.turno();
    cambiarA('B');
    sinLeerYa(5);
    guardarYa('mesas.tusMesas', { mesas: ['PA-B'] });
    expect(cache.registrarSinLeer(deA, 9)).toBeNull();
    expect(cache.leer('mesas.tusMesas')).toEqual({ mesas: ['PA-B'] });
    expect(cache.leer('sinLeer')).toBe(5);
  });

  it('🔴 lo que B ya pidió llega aunque la memoria tuviera todavía lo de A: su pantalla no queda esperando', () => {
    const { cache, estado, guardarYa } = conDueno('A');
    guardarYa('amigos.grupos', ['Familia de A']);
    estado.dueno = 'B';
    const primero = cache.turno();
    const segundo = cache.turno();
    expect(cache.guardar(primero, 'amigos.amigos', ['amigo de B'])?.valor).toEqual(['amigo de B']);
    // El primero soltó lo de A; el segundo pedido de B también llega.
    expect(cache.guardar(segundo, 'amigos.grupos', ['Familia de B'])?.valor).toEqual(['Familia de B']);
    expect(cache.leer('amigos.grupos')).toEqual(['Familia de B']);
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

  /**
   * T-01 · en cada lector, el turno se saca ANTES de pedir (la línea siguiente
   * es el pedido) y es lo que se le pasa a `guardar`/`registrarSinLeer`. Sacarlo
   * dentro del `.then` volvería a tomar la cuenta de cuando llega la respuesta.
   */
  it('🔴 T-01 · cada lector saca el turno justo antes de pedir y guarda con ese turno', () => {
    for (const ruta of LECTORES) {
      const lineas = FUENTES[ruta]!.split('\n');
      const turnos = lineas.flatMap((l, i) => (l.includes('ultimoVisto.turno()') ? [i] : []));
      const guardados = lineas.filter((l) => /ultimoVisto\.(guardar|registrarSinLeer)\s*[<(]/.test(l));
      expect(turnos.length, ruta).toBeGreaterThan(0);
      expect(turnos.length, ruta).toBe(guardados.length);
      for (const i of turnos) {
        expect(lineas[i]!.trim(), ruta).toBe('const turno = ultimoVisto.turno();');
        const siguiente = lineas.slice(i + 1).find((l) => l.trim() !== '' && !l.trim().startsWith('//'))!;
        expect(siguiente.trim(), `${ruta}:${i + 2}`).toMatch(/^(return )?(api\b|void Promise\.all\(|traerHistorialCompleto\()/);
      }
      for (const l of guardados) expect(l, ruta).toMatch(/ultimoVisto\.(guardar|registrarSinLeer)(<[^>]+>)?\(turno, /);
    }
  });

  it('🔴 T-01 · un error tardío de otra cuenta tampoco borra ni muestra nada: cada `catch` que olvida, primero mira el turno', () => {
    let vistos = 0;
    for (const ruta of LECTORES) {
      const lineas = FUENTES[ruta]!.split('\n');
      lineas.forEach((l, i) => {
        if (!/\.catch\(\(\) => \{\s*$/.test(l)) return;
        const fin = lineas.findIndex((x, j) => j > i && x.trim() === '});');
        const cuerpo = lineas.slice(i + 1, fin).filter((x) => x.trim() !== '' && !x.trim().startsWith('//'));
        if (!cuerpo.some((x) => x.includes('ultimoVisto.olvidar('))) return;
        vistos += 1;
        expect(cuerpo[0]!.trim(), `${ruta}:${i + 2}`).toBe('if (!ultimoVisto.esDeAhora(turno)) return;');
      });
    }
    // Inicio, invitaciones, tus mesas, historial, amigos y grupos.
    expect(vistos).toBe(6);
  });

  it('ni la mesa, ni el alta, ni la cámara, ni Avisos lo leen', () => {
    for (const ruta of ['../screens/MesaScreen.tsx', '../screens/CreateMesaFlow.tsx', '../screens/AvisosScreen.tsx', '../screens/JoinMesaScreen.tsx']) {
      expect(FUENTES[ruta], ruta).toBeDefined();
      expect(FUENTES[ruta], ruta).not.toMatch(/ultimoVisto\.leer|ultimoVisto\.guardar/);
    }
  });
});
