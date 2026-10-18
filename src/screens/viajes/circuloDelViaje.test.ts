import { describe, expect, it, vi } from 'vitest';
import { saveSession } from '../../api/storage';
import { traducir } from '../../i18n/idioma';
import { circuloDelViaje, nombreDeViajeRecordado, recordarNombreDeViaje } from './circuloDelViaje';

/**
 * D250 · Mati: «en viaje que te habia puesto dos burbujas, una de scan y otra
 * manual, reemplaza la del scan con justamente el circulo este, que cuando
 * escaneas desde un viaje que ese escan se contabilice al viaje».
 */
const es = (s: string, ...a: unknown[]) => traducir(s, 'es', ...a);
const VIAJE = { id: 'd1000000-0000-4000-8000-000000000001', nombre: 'Cancún 2026' };

describe('D250 · el círculo de la cámara dentro de un viaje', () => {
  it('🔴 abierto: escanea para ese viaje, con la cámara, «Escanear» a la vista y su nombre accesible', () => {
    const c = circuloDelViaje({ ...VIAJE, estado: 'abierto' }, es);
    expect(c).toMatchObject({ label: 'Escanear', icon: 'camera', ariaLabel: 'Escanear ticket para Cancún 2026' });
  });

  it('🔴 esperando pagos, cerrado o sin viaje todavía: el círculo de siempre', () => {
    expect(circuloDelViaje({ ...VIAJE, estado: 'esperando_pagos' }, es)).toBeUndefined();
    expect(circuloDelViaje({ ...VIAJE, estado: 'cerrado' }, es)).toBeUndefined();
    expect(circuloDelViaje(null, es)).toBeUndefined();
  });

  it('con el idioma en «en»', () => {
    const en = (s: string, ...a: unknown[]) => traducir(s, 'en', ...a);
    expect(circuloDelViaje({ ...VIAJE, estado: 'abierto' }, en)).toMatchObject({ label: 'Scan', ariaLabel: 'Scan a ticket for Cancún 2026' });
  });
});

describe('D250 · el nombre del viaje para el título del escaneo', () => {
  it('se recuerda por id y sólo para ese id (con una sesión: C-07)', () => {
    const valores = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => valores.get(k) ?? null,
      setItem: (k: string, v: string) => { valores.set(k, v); },
      removeItem: (k: string) => { valores.delete(k); },
    });
    saveSession({
      access_token: 'a', refresh_token: 'r', family_id: 'fam-d250', principal_id: 'user-d250',
      user: { id: 'user-d250', payme_id: 'payme_mx_d250', email: 'd250@example.com', first_name: 'X', last_name: 'Y' },
    });
    expect(nombreDeViajeRecordado('otro')).toBeNull();
    recordarNombreDeViaje(VIAJE.id, VIAJE.nombre);
    expect(nombreDeViajeRecordado(VIAJE.id)).toBe('Cancún 2026');
    expect(nombreDeViajeRecordado('otro')).toBeNull();
    expect(nombreDeViajeRecordado(null)).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe('🔴 D276-1 · el círculo de la barra según las fechas (`centroPorFechas`)', () => {
  const desde = '2026-10-05';
  const hasta = '2026-10-11';
  const CANCUN = { ...VIAJE, estado: 'abierto' as const, fecha_desde: desde, fecha_hasta: hasta };
  const OAXACA = { id: 'd1000000-0000-4000-8000-000000000002', nombre: 'Oaxaca', estado: 'abierto' as const, fecha_desde: desde, fecha_hasta: hasta };

  it('🔴 un viaje que cubre hoy: el círculo de ESE viaje (D250), con su nombre para el lector de pantalla', async () => {
    const { centroPorFechas } = await import('./circuloDelViaje');
    expect(centroPorFechas([CANCUN], undefined, es))
      .toMatchObject({ label: 'Escanear', icon: 'camera', ariaLabel: 'Escanear ticket para Cancún 2026' });
  });

  it('🔴 un viaje: el toque abre el menú de fotos (D368) EN EL MISMO gesto y el escaneo de ese viaje', async () => {
    vi.resetModules();
    const camara = vi.fn();
    const menu = vi.fn();
    const ir = vi.fn();
    vi.doMock('../../camara/camaraNativa', () => ({ abrirCamaraNativa: camara, abrirMenuDeFotos: menu }));
    vi.doMock('../../router', async (orig) => ({ ...(await orig<typeof import('../../router')>()), navigate: ir }));
    try {
      const { centroPorFechas } = await import('./circuloDelViaje');
      centroPorFechas([CANCUN], undefined, es)!.onClick();
      // D368 · el menú del teléfono (sin `capture`), no la cámara directo.
      expect(camara).not.toHaveBeenCalled();
      expect(menu).toHaveBeenCalledTimes(1);
      expect(ir).toHaveBeenCalledWith('scan', VIAJE.id);
      expect(menu.mock.invocationCallOrder[0]).toBeLessThan(ir.mock.invocationCallOrder[0]!);
    } finally {
      vi.doUnmock('../../camara/camaraNativa');
      vi.doUnmock('../../router');
      vi.resetModules();
    }
  });

  it('🔴 dos viajes: «Escanear» abre la hoja «¿Para qué viaje?» y NO la cámara (se abre en el toque que elige)', async () => {
    vi.resetModules();
    const camara = vi.fn();
    vi.doMock('../../camara/camaraNativa', () => ({ abrirCamaraNativa: camara, abrirMenuDeFotos: camara }));
    try {
      const { centroPorFechas } = await import('./circuloDelViaje');
      const { abrirHojaParaQueViaje, hojaParaQueViajeAbierta, cerrarHojaParaQueViaje } = await import('./hojaParaQueViajeEstado');
      const c = centroPorFechas([CANCUN, OAXACA], undefined, es)!;
      expect(c).toMatchObject({ label: 'Escanear', icon: 'camera', ariaLabel: 'Escanear ticket para un viaje' });
      expect(c.onClick).toBe(abrirHojaParaQueViaje);
      expect(hojaParaQueViajeAbierta()).toBe(false);
      c.onClick();
      expect(hojaParaQueViajeAbierta()).toBe(true);
      expect(camara).not.toHaveBeenCalled();
      cerrarHojaParaQueViaje();
    } finally {
      vi.doUnmock('../../camara/camaraNativa');
      vi.resetModules();
    }
  });

  it('🔴 sin viajes que cubran hoy, o con un centro propio de la pantalla (el de un viaje, el del pago): `undefined`', async () => {
    const { centroPorFechas } = await import('./circuloDelViaje');
    expect(centroPorFechas([], undefined, es)).toBeUndefined();
    const propio = { label: 'Pagar', icon: 'card' as const, onClick: () => undefined };
    expect(centroPorFechas([CANCUN], propio, es)).toBeUndefined();
    expect(centroPorFechas([CANCUN, OAXACA], propio, es)).toBeUndefined();
  });

  it('con el idioma en «en»', async () => {
    const { centroPorFechas } = await import('./circuloDelViaje');
    const en = (s: string, ...a: unknown[]) => traducir(s, 'en', ...a);
    expect(centroPorFechas([CANCUN, OAXACA], undefined, en)).toMatchObject({ label: 'Scan', ariaLabel: 'Scan a ticket for a trip' });
  });
});
