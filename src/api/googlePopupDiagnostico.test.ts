import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MARGEN_CREDENCIAL_MS,
  motorDe,
  plataformaDe,
  vigilarPopupGoogle,
  type EventoPopupTrabado,
} from './googlePopupDiagnostico';

/**
 * RM-182 · 5a. Sin DOM simulado (jsdom está prohibido en este repo): `window` y
 * `document` son `EventTarget` de Node con lo mínimo que el módulo lee.
 */
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const UA_MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const UA_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

type Doc = EventTarget & { activeElement: { tagName: string } | null; visibilityState: string };

let win: EventTarget;
let doc: Doc;
const iframe = { tagName: 'IFRAME' };
const container = { contains: (n: unknown) => n === iframe } as unknown as HTMLElement;
let reloj = 0;

beforeEach(() => {
  vi.useFakeTimers();
  win = new EventTarget();
  doc = Object.assign(new EventTarget(), { activeElement: null, visibilityState: 'visible' }) as Doc;
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('navigator', { userAgent: UA_IPHONE, maxTouchPoints: 5 });
  reloj = 1_000;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function abrirPopup(): void {
  win.dispatchEvent(new Event('blur'));
  doc.activeElement = iframe;
  vi.advanceTimersByTime(0);
}
function volver(ms: number): void {
  reloj += ms;
  win.dispatchEvent(new Event('focus'));
}

describe('RM-182 · 5a · google_popup_stuck', () => {
  it('🔴 el popup se abrió, la ventana volvió y no llegó credencial: UN evento, sin datos personales', () => {
    const eventos: EventoPopupTrabado[] = [];
    const vigia = vigilarPopupGoogle(container, { registrar: (e) => eventos.push(e), ahora: () => reloj });
    abrirPopup();
    volver(45_000);
    vi.advanceTimersByTime(MARGEN_CREDENCIAL_MS);
    expect(eventos).toEqual([{ event: 'google_popup_stuck', engine: 'webkit', platform: 'ios', open_ms: 45_000 }]);
    // Sólo esas cuatro claves: nada de correo, nombre, UA completo ni credencial.
    expect(Object.keys(eventos[0]).sort()).toEqual(['engine', 'event', 'open_ms', 'platform']);
    // Un segundo regreso sin reabrir no duplica.
    volver(10);
    vi.advanceTimersByTime(MARGEN_CREDENCIAL_MS);
    expect(eventos).toHaveLength(1);
    vigia.dispose();
  });

  it('🔴 si la credencial llega (antes o dentro del margen), no se registra nada', () => {
    const eventos: EventoPopupTrabado[] = [];
    const vigia = vigilarPopupGoogle(container, { registrar: (e) => eventos.push(e), ahora: () => reloj });
    abrirPopup();
    volver(3_000);
    vi.advanceTimersByTime(MARGEN_CREDENCIAL_MS - 1);
    vigia.credencialRecibida();
    vi.advanceTimersByTime(MARGEN_CREDENCIAL_MS);
    expect(eventos).toEqual([]);
    vigia.dispose();
  });

  it('un blur que NO va al iframe de Google (otra pestaña, otra app) no cuenta como apertura', () => {
    const eventos: EventoPopupTrabado[] = [];
    const vigia = vigilarPopupGoogle(container, { registrar: (e) => eventos.push(e), ahora: () => reloj });
    win.dispatchEvent(new Event('blur'));
    doc.activeElement = { tagName: 'IFRAME' }; // un iframe AJENO al contenedor
    vi.advanceTimersByTime(0);
    volver(5_000);
    vi.advanceTimersByTime(MARGEN_CREDENCIAL_MS);
    expect(eventos).toEqual([]);
    vigia.dispose();
  });

  it('volver por visibilidad (la pestaña de Google queda atrás en iPhone) también cuenta', () => {
    const eventos: EventoPopupTrabado[] = [];
    const vigia = vigilarPopupGoogle(container, { registrar: (e) => eventos.push(e), ahora: () => reloj });
    abrirPopup();
    reloj += 8_000;
    doc.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(MARGEN_CREDENCIAL_MS);
    expect(eventos).toHaveLength(1);
    vigia.dispose();
  });

  it('dispose suelta los oyentes y cancela lo pendiente', () => {
    const eventos: EventoPopupTrabado[] = [];
    const vigia = vigilarPopupGoogle(container, { registrar: (e) => eventos.push(e), ahora: () => reloj });
    abrirPopup();
    volver(1_000);
    vigia.dispose();
    vi.advanceTimersByTime(MARGEN_CREDENCIAL_MS);
    abrirPopup();
    volver(1_000);
    vi.advanceTimersByTime(MARGEN_CREDENCIAL_MS);
    expect(eventos).toEqual([]);
  });

  it('sin `registrar`, escribe en la consola con console.info y nada más', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const fetchEspia = vi.fn();
    vi.stubGlobal('fetch', fetchEspia);
    const vigia = vigilarPopupGoogle(container, { ahora: () => reloj });
    abrirPopup();
    volver(2_000);
    vi.advanceTimersByTime(MARGEN_CREDENCIAL_MS);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0][0]).toBe('[payme] google_popup_stuck');
    expect(fetchEspia).not.toHaveBeenCalled();
    info.mockRestore();
    vigia.dispose();
  });
});

describe('RM-182 · motor y plataforma en trazo grueso', () => {
  it('iPhone es WebKit/iOS aunque sea Chrome de iOS', () => {
    expect([motorDe(UA_IPHONE), plataformaDe(UA_IPHONE, 5)]).toEqual(['webkit', 'ios']);
    const crios = UA_IPHONE.replace('Version/18.0', 'CriOS/140.0');
    expect(motorDe(crios)).toBe('webkit');
  });
  it('Safari de Mac es WebKit/macOS; un iPad que se presenta como Mac es iOS', () => {
    expect([motorDe(UA_MAC_SAFARI), plataformaDe(UA_MAC_SAFARI, 0)]).toEqual(['webkit', 'macos']);
    expect(plataformaDe(UA_MAC_SAFARI, 5)).toBe('ios');
  });
  it('Chrome de Mac es Blink', () => {
    expect(motorDe(UA_CHROME)).toBe('blink');
  });
});
