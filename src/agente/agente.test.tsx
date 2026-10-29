import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { aplicarCapacidadDeRecomendaciones, reiniciarSugerenciasParaTests } from '../api/sugerencias';
import { FilaPermisoOpcionalView, modoDeFilaOpcional } from '../components/SeccionPrivacidad';
import { traducir } from '../i18n/idioma';
import { mesaCalificable } from './CalificarMesa';
import { avanceDelPresupuesto, centavosDelPresupuesto } from './PresupuestoDelMes';
import { HttpError } from '../api/http';
import { MockApiError } from '../api/mock/mockApi';
import type { Cerca } from '../api/agente';
import { buscarCerca, faseDeErrorDeCerca, textoDeDistancia, textoDeEstrellas, type Busqueda } from './TarjetaCerca';

const t = (s: string, ...a: unknown[]) => traducir(s, 'es', ...a);

afterEach(() => reiniciarSugerenciasParaTests());

describe('D554 · «Lo de siempre, cerca»', () => {
  it('la distancia en metros o en km', () => {
    expect(textoDeDistancia(250, 'es-MX')).toBe('250 m');
    expect(textoDeDistancia(950, 'es-MX')).toBe('950 m');
    expect(textoDeDistancia(1000, 'es-MX')).toBe('1 km');
    expect(textoDeDistancia(1550, 'es-MX')).toBe('1.6 km');
  });

  it('las estrellas propias: el promedio con un decimal, cuántas personas, y un nombre accesible', () => {
    expect(textoDeEstrellas(4.6, 7, 'es-MX', t)).toEqual({ visible: '4.6 · 7', accesible: '4.6 estrellas en PayMe, de 7 personas' });
    expect(textoDeEstrellas(4, 3, 'es-MX', t).visible).toBe('4.0 · 3');
  });
});

describe('O2/O3 del PR #109 y O3 del PR #95 · la búsqueda de «cerca»', () => {
  const CERCA: Cerca = { radioM: 1000, platos: [], atribucion: { textos: [], urls: [] } } as unknown as Cerca;
  const UBICACION = { tipo: 'ok', ubicacion: { lat: 19.43, lon: -99.13 } } as const;

  it('el 429 del dueño (real o mock) tiene su fase; cualquier otro fallo, el error genérico', () => {
    expect(faseDeErrorDeCerca(new HttpError(429, { error: 'too_many_requests' }))).toBe('demasiadas');
    expect(faseDeErrorDeCerca(new MockApiError(429, 'too_many_requests'))).toBe('demasiadas');
    expect(faseDeErrorDeCerca(new HttpError(500, { error: 'internal_error' }))).toBe('error');
    expect(faseDeErrorDeCerca(new HttpError(403, { error: 'permission_required' }))).toBe('error');
    expect(faseDeErrorDeCerca(new Error('red'))).toBe('error');
    expect(traducir('Hiciste muchas búsquedas seguidas. Prueba en un rato.', 'en'))
      .toBe("You've searched a lot in a row. Try again in a while.");
    expect(traducir('Buscar de nuevo', 'en')).toBe('Search again');
  });

  it('con la cuenta de siempre, la lista llega', async () => {
    const fases: Busqueda['fase'][] = [];
    await buscarCerca({
      pedir: async () => UBICACION, postear: async () => CERCA, vigente: () => true, poner: (b) => { fases.push(b.fase); },
    });
    expect(fases).toEqual(['ubicando', 'buscando', 'lista']);
  });

  it('🔴 si la cuenta cambia mientras espera el POST, el resultado de la anterior se descarta', async () => {
    let epoca = 0;
    const marca = epoca;
    const fases: Busqueda['fase'][] = [];
    await buscarCerca({
      pedir: async () => UBICACION,
      postear: async () => { epoca += 1; return CERCA; },
      vigente: () => marca === epoca,
      poner: (b) => { fases.push(b.fase); },
    });
    expect(fases).toEqual(['ubicando', 'buscando']);
  });

  it('🔴 si la cuenta cambia mientras espera la ubicación, ni siquiera se busca', async () => {
    let epoca = 0;
    const marca = epoca;
    const fases: Busqueda['fase'][] = [];
    let posteos = 0;
    await buscarCerca({
      pedir: async () => { epoca += 1; return UBICACION; },
      postear: async () => { posteos += 1; return CERCA; },
      vigente: () => marca === epoca,
      poner: (b) => { fases.push(b.fase); },
    });
    expect(fases).toEqual(['ubicando']);
    expect(posteos).toBe(0);
  });

  it('un error de la cuenta anterior tampoco se muestra', async () => {
    let epoca = 0;
    const marca = epoca;
    const fases: Busqueda['fase'][] = [];
    await buscarCerca({
      pedir: async () => UBICACION,
      postear: async () => { epoca += 1; throw new HttpError(429, { error: 'too_many_requests' }); },
      vigente: () => marca === epoca,
      poner: (b) => { fases.push(b.fase); },
    });
    expect(fases).toEqual(['ubicando', 'buscando']);
  });

  it('el 429 vigente se muestra como «demasiadas»', async () => {
    const fases: Busqueda['fase'][] = [];
    await buscarCerca({
      pedir: async () => UBICACION,
      postear: async () => { throw new HttpError(429, { error: 'too_many_requests' }); },
      vigente: () => true,
      poner: (b) => { fases.push(b.fase); },
    });
    expect(fases).toEqual(['ubicando', 'buscando', 'demasiadas']);
  });
});

describe('D553 · la calificación al cerrar la mesa', () => {
  it('sólo una mesa que ya pasó', () => {
    for (const s of ['fully_paid', 'expired', 'settling', 'settled', 'dispersing', 'completed'] as const) expect(mesaCalificable(s)).toBe(true);
    for (const s of ['pending_auth', 'open', 'partially_paid', 'auth_failed', 'cancelled'] as const) expect(mesaCalificable(s)).toBe(false);
  });
});

describe('D554 · R-13 a · el presupuesto del mes', () => {
  it('el monto escrito, en centavos enteros y sin floats', () => {
    expect(centavosDelPresupuesto('4,200')).toBe(420000);
    expect(centavosDelPresupuesto('$4200.5')).toBe(420050);
    expect(centavosDelPresupuesto(' 1 ')).toBe(100);
    expect(centavosDelPresupuesto('0.99')).toBeNull();
    expect(centavosDelPresupuesto('4.200,50')).toBeNull();
    expect(centavosDelPresupuesto('')).toBeNull();
    expect(centavosDelPresupuesto('1000001')).toBeNull();
  });

  it('el avance de la barra: entero, con tope en 100 y sin barra sin monto', () => {
    const base = { origen: 'editado' as const, promedioCents: null, basis: 'consumption' as const };
    expect(avanceDelPresupuesto({ ...base, montoCents: 420000, gastadoCents: 186750 })).toBe(44);
    expect(avanceDelPresupuesto({ ...base, montoCents: 100000, gastadoCents: 250000 })).toBe(100);
    expect(avanceDelPresupuesto({ ...base, origen: null, montoCents: null, gastadoCents: 0 })).toBeNull();
  });
});

describe('D554 · R-2 a · la fila «Recomendaciones» en Privacidad', () => {
  it('su título y su texto, con el enlace al Aviso; apagado y deshabilitado sin estado leído', () => {
    const html = renderToStaticMarkup(
      <FilaPermisoOpcionalView finalidad="recomendaciones" estado={null} ocupado={false} mensaje={null} onCambiar={() => undefined} />,
    );
    expect(html).toContain('Recomendaciones');
    expect(html).toContain('Tu ubicación no se guarda.');
    expect(html).toContain('href="/privacy"');
    expect(html).toMatch(/disabled=""/);
    expect(html).not.toMatch(/checked=""/);
  });

  it('🔴 apagada por defecto: una cuenta sin el permiso la ve apagada', () => {
    const html = renderToStaticMarkup(
      <FilaPermisoOpcionalView finalidad="recomendaciones" estado={{ purpose_key: 'recomendaciones', granted: false, state: 'never' }}
        ocupado={false} mensaje={null} onCambiar={() => undefined} />,
    );
    expect(html).not.toMatch(/checked=""/);
    expect(html).not.toMatch(/disabled=""/);
  });

  it('con la bandera del dueño apagada sólo se revoca, y sin el estado del agente no hay fila', () => {
    aplicarCapacidadDeRecomendaciones(false);
    expect(modoDeFilaOpcional({ supported: true, enabled: false }, { purpose_key: 'recomendaciones', granted: true, state: 'granted' }, true, false))
      .toBe('solo_revocar');
    expect(modoDeFilaOpcional({ supported: true, enabled: false }, { purpose_key: 'recomendaciones', granted: false, state: 'never' }, true, false))
      .toBe('oculta');
    expect(modoDeFilaOpcional(null, null, false, false)).toBe('oculta');
  });
});
