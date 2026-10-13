import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EstadoViaje } from '../../api/viajes';
import { hayRestaurantesPendientes, type RestaurantePendiente } from './ViajesEnInicio';
import {
  alCambiarElDiaEnMexico, esProximo, hoyEnMexico, msHastaLaMedianocheDeMexico, viajesDeInicio, viajesProximos, type Reloj,
} from './proximos';

/**
 * 🔴 D302 · los viajes que todavía no empezaron: fuera de Inicio, en «Próximos». «Desde el día de su desde, en hora de
 * México» (UTC−6 fijo, como el contrato). La adenda del Bibliotecario: abierto sin `fecha_desde` y esperando pagos, en
 * Inicio como hoy.
 */
const viaje = (id: string, estado: EstadoViaje, fecha_desde: string | null) => ({ id, nombre: id, estado, fecha_desde });

describe('🔴 D302 · hoy, en hora de México', () => {
  it('el borde de la medianoche de México (06:00 UTC): un milisegundo antes es el día anterior', () => {
    expect(hoyEnMexico(Date.parse('2026-10-20T05:59:59.999Z'))).toBe('2026-10-19');
    expect(hoyEnMexico(Date.parse('2026-10-20T06:00:00.000Z'))).toBe('2026-10-20');
    // Las 23:00 del 19 en México ya son el 20 en UTC: manda México.
    expect(hoyEnMexico(Date.parse('2026-10-20T05:00:00Z'))).toBe('2026-10-19');
    // Fin de año.
    expect(hoyEnMexico(Date.parse('2027-01-01T05:59:59Z'))).toBe('2026-12-31');
    expect(hoyEnMexico(Date.parse('2027-01-01T06:00:00Z'))).toBe('2027-01-01');
  });

  it('cuánto falta para la medianoche de México: nunca 0', () => {
    expect(msHastaLaMedianocheDeMexico(Date.parse('2026-10-20T05:59:59.000Z'))).toBe(1_000);
    expect(msHastaLaMedianocheDeMexico(Date.parse('2026-10-20T06:00:00.000Z'))).toBe(24 * 60 * 60 * 1000);
    expect(msHastaLaMedianocheDeMexico(Date.parse('2026-10-20T18:00:00.000Z'))).toBe(12 * 60 * 60 * 1000);
    // Antes de 1970 en México (el módulo negativo): igual, positivo.
    expect(msHastaLaMedianocheDeMexico(0)).toBe(6 * 60 * 60 * 1000);
  });
});

describe('🔴 D302 · con la app abierta, el día cambia a cada medianoche de México', () => {
  /** Un reloj de mentira: `pasar` mueve la hora y dispara lo que venció. */
  function relojFalso(inicio: number) {
    let ahora = inicio;
    let siguiente = 1;
    const pendientes = new Map<number, { hacer: () => void; en: number }>();
    const pedidos: number[] = [];
    const reloj: Reloj = {
      ahora: () => ahora,
      esperar: (hacer, ms) => { pedidos.push(ms); pendientes.set(siguiente, { hacer, en: ahora + ms }); return siguiente++; },
      cancelar: (id) => { pendientes.delete(id); },
    };
    const pasar = (ms: number) => {
      ahora += ms;
      for (const [id, p] of [...pendientes]) if (p.en <= ahora) { pendientes.delete(id); p.hacer(); }
    };
    return { reloj, pasar, pedidos, pendientes };
  }
  const mx = (s: string) => Date.parse(`${s}-06:00`);

  it('🔴 avisa a la primera medianoche Y a la siguiente: se vuelve a armar cada día', () => {
    const f = relojFalso(mx('2026-10-03T23:58:00'));
    const avisos: string[] = [];
    alCambiarElDiaEnMexico((hoy) => avisos.push(hoy), f.reloj);
    expect(f.pedidos).toEqual([2 * 60 * 1000]);
    f.pasar(60 * 1000);
    expect(avisos).toEqual([]);
    f.pasar(60 * 1000);
    expect(avisos).toEqual(['2026-10-04']);
    f.pasar(24 * 60 * 60 * 1000);
    expect(avisos).toEqual(['2026-10-04', '2026-10-05']);
    expect(f.pedidos).toEqual([2 * 60 * 1000, 24 * 60 * 60 * 1000, 24 * 60 * 60 * 1000]);
  });

  it('el teléfono dormía: el temporizador llega tarde, avisa el día de ese momento y se arma hasta la medianoche que sigue', () => {
    const f = relojFalso(mx('2026-10-03T23:58:00'));
    const avisos: string[] = [];
    alCambiarElDiaEnMexico((hoy) => avisos.push(hoy), f.reloj);
    f.pasar(10 * 60 * 60 * 1000);
    expect(avisos).toEqual(['2026-10-04']);
    // Las 09:58 del 4: faltan 14 h 2 min.
    expect(f.pedidos.at(-1)).toBe((14 * 60 + 2) * 60 * 1000);
  });

  it('cancelar lo apaga: no avisa más', () => {
    const f = relojFalso(mx('2026-10-03T23:58:00'));
    const avisos: string[] = [];
    const cancelar = alCambiarElDiaEnMexico((hoy) => avisos.push(hoy), f.reloj);
    cancelar();
    expect(f.pendientes.size).toBe(0);
    f.pasar(3 * 24 * 60 * 60 * 1000);
    expect(avisos).toEqual([]);
  });

  it('el hook lo usa, sin otro temporizador propio', () => {
    const fuente = readFileSync(new URL('./proximos.ts', import.meta.url), 'utf8');
    const hook = fuente.slice(fuente.indexOf('export function useHoyEnMexico'));
    expect(hook).toContain('return alCambiarElDiaEnMexico(setHoy);');
    expect(hook).not.toMatch(/setTimeout|setInterval/);
  });
});

describe('🔴 D302 · qué es un viaje próximo', () => {
  const hoy = '2026-10-19';

  it('abierto y con su «desde» después de hoy: próximo', () => {
    expect(esProximo(viaje('a', 'abierto', '2026-10-20'), hoy)).toBe(true);
    expect(esProximo(viaje('a', 'abierto', '2027-01-01'), hoy)).toBe(true);
  });

  it('el día de su «desde» ya no: va en Inicio; tampoco uno que ya empezó', () => {
    expect(esProximo(viaje('a', 'abierto', '2026-10-19'), hoy)).toBe(false);
    expect(esProximo(viaje('a', 'abierto', '2026-10-05'), hoy)).toBe(false);
  });

  it('🔴 la adenda: abierto sin «desde», en Inicio; esperando pagos o cerrado con «desde» futuro, tampoco es próximo', () => {
    expect(esProximo(viaje('a', 'abierto', null), hoy)).toBe(false);
    expect(esProximo(viaje('a', 'esperando_pagos', '2026-10-25'), hoy)).toBe(false);
    expect(esProximo(viaje('a', 'cerrado', '2026-10-25'), hoy)).toBe(false);
  });

  it('Inicio: todos menos los próximos, en el orden de la lista', () => {
    const lista = [
      viaje('futuro', 'abierto', '2026-10-25'),
      viaje('en-curso', 'abierto', '2026-10-15'),
      viaje('sin-fecha', 'abierto', null),
      viaje('esperando', 'esperando_pagos', '2026-10-30'),
      viaje('hoy', 'abierto', '2026-10-19'),
    ];
    expect(viajesDeInicio(lista, hoy).map((v) => v.id)).toEqual(['en-curso', 'sin-fecha', 'esperando', 'hoy']);
  });

  it('«Próximos»: del más cercano al más lejano; con el mismo «desde», en el orden de la lista', () => {
    const lista = [
      viaje('noviembre', 'abierto', '2026-11-02'),
      viaje('pasado-manana-b', 'abierto', '2026-10-21'),
      viaje('manana', 'abierto', '2026-10-20'),
      viaje('pasado-manana-a', 'abierto', '2026-10-21'),
      viaje('en-curso', 'abierto', '2026-10-15'),
      viaje('esperando', 'esperando_pagos', '2026-10-30'),
    ];
    expect(viajesProximos(lista, hoy).map((v) => v.id)).toEqual(['manana', 'pasado-manana-b', 'pasado-manana-a', 'noviembre']);
    // No toca la lista recibida.
    expect(lista.map((v) => v.id)[0]).toBe('noviembre');
  });

  it('al llegar su día, pasa de «Próximos» a Inicio', () => {
    const lista = [viaje('puebla', 'abierto', '2026-10-20')];
    expect([viajesDeInicio(lista, '2026-10-19').length, viajesProximos(lista, '2026-10-19').length]).toEqual([0, 1]);
    expect([viajesDeInicio(lista, '2026-10-20').length, viajesProximos(lista, '2026-10-20').length]).toEqual([1, 0]);
  });
});

describe('🔴 D302 · el aviso de mesas, sin los próximos', () => {
  const pendiente: RestaurantePendiente = { ticket_id: 't-1', lugar: 'La Parolaccia', tipo_lugar: 'restaurante', faltan: 2 };

  it('un pendiente de un viaje que no empezó no tapa «No tienes mesas abiertas»', () => {
    const lista = [viaje('futuro', 'abierto', '2026-10-25'), viaje('en-curso', 'abierto', '2026-10-15')];
    const pendientes = { futuro: [pendiente], 'en-curso': [] };
    expect(hayRestaurantesPendientes(viajesDeInicio(lista, '2026-10-19'), pendientes, false)).toBe(false);
    // El día que empieza, sí cuenta.
    expect(hayRestaurantesPendientes(viajesDeInicio(lista, '2026-10-25'), pendientes, false)).toBe(true);
  });

  it('🔴 Inicio le pasa la lista sin los próximos, al aviso y a las burbujas', () => {
    const home = readFileSync(new URL('../HomeScreen.tsx', import.meta.url), 'utf8');
    expect(home).toContain('const hoy = useHoyEnMexico();');
    expect(home).toContain('hayRestaurantesPendientes(viajesEnInicio, pendientesDeViajes, viajesFallaron)');
    expect(home).toMatch(/<ViajesAbiertosEnInicio\s+viajes=\{viajesEnInicio\}/);
    expect(home).toMatch(/<ListaDeProximos viajes=\{proximos\} \/>/);
    // La lista completa de abiertos ya no llega a Inicio por otro lado.
    expect(home).not.toMatch(/viajesAbiertos\?\.viajes/);
  });
});
