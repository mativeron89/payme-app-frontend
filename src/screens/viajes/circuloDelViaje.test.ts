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
  it('🔴 abierto: escanea para ese viaje, con la cámara, «Nueva» a la vista y su nombre accesible', () => {
    const c = circuloDelViaje({ ...VIAJE, estado: 'abierto' }, es);
    expect(c).toMatchObject({ label: 'Nueva', icon: 'camera', ariaLabel: 'Escanear ticket para Cancún 2026' });
  });

  it('🔴 esperando pagos, cerrado o sin viaje todavía: el círculo de siempre', () => {
    expect(circuloDelViaje({ ...VIAJE, estado: 'esperando_pagos' }, es)).toBeUndefined();
    expect(circuloDelViaje({ ...VIAJE, estado: 'cerrado' }, es)).toBeUndefined();
    expect(circuloDelViaje(null, es)).toBeUndefined();
  });

  it('con el idioma en «en»', () => {
    const en = (s: string, ...a: unknown[]) => traducir(s, 'en', ...a);
    expect(circuloDelViaje({ ...VIAJE, estado: 'abierto' }, en)).toMatchObject({ label: 'New', ariaLabel: 'Scan a ticket for Cancún 2026' });
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
