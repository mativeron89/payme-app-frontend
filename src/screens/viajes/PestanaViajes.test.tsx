import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ViajeEnLista } from '../../api/viajes';
import { FilaCrearViaje, ListaDeInicio, PanelViajes, type ConteoDeViajes } from './PestanaViajes';

/** AF-VIAJES · D242 · la pestaña «Viajes» de Inicio (1a, 1b); D246 · la lista elegida debajo de «Crear viaje». */
const nada = () => undefined;

function enLista(extra: Partial<ViajeEnLista>): ViajeEnLista {
  return {
    id: 'v-1', nombre: 'Cancún 2026', fecha_desde: '2026-10-05', fecha_hasta: '2026-10-11', estado: 'abierto', personas: 4,
    mi_balance_cents: -54200, transferencias_pendientes: null, consumiste_cents: null, terminado_en: null, ...extra,
  };
}

const listo = (abiertos: number, cerrados: number, viajes: ViajeEnLista[] = []): ConteoDeViajes =>
  ({ estado: 'listo', counts: { abiertos, cerrados }, viajes });

const panel = (conteo: ConteoDeViajes, elegida: 'abiertos' | 'cerrados' = 'abiertos') =>
  renderToStaticMarkup(<PanelViajes conteo={conteo} elegida={elegida} onElegir={nada} onReintentar={nada} />);

describe('la pestaña Viajes', () => {
  it('1a · Abiertos y Cerrados lado a lado, con cuántos hay (el conteo del dueño)', () => {
    const html = panel(listo(2, 1));
    expect(html).toContain('Abiertos');
    expect(html).toContain('2 viajes');
    expect(html).toContain('Cerrados');
    expect(html).toContain('1 viaje<');
    expect(html).toContain('launch-pair');
    expect(html).not.toContain('Todavía no tienes viajes');
  });

  it('🔴 D246 · se eligen: lo elegido con `aria-pressed` y el borde (no sólo color); al entrar, Abiertos', () => {
    const abiertos = panel(listo(2, 1));
    expect(abiertos.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(abiertos).toMatch(/class="launch vj-lanzador vj-lanzador--elegido" aria-pressed="true"><span class="launch-ico" aria-hidden="true">.*?<\/span><span class="launch-label">Abiertos/);
    const cerrados = panel(listo(2, 1), 'cerrados');
    expect(cerrados).toMatch(/vj-lanzador--elegido" aria-pressed="true"><span class="launch-ico" aria-hidden="true">.*?<\/span><span class="launch-label">Cerrados/);
  });

  it('1b · sin viajes, la tarjeta es el vacío con «Crear viaje», y no hay fila ni lista aparte', () => {
    const html = panel(listo(0, 0));
    expect(html).toContain('Todavía no tienes viajes');
    expect(html).toContain('PayMe va calculando quién le debe a quién.');
    expect(renderToStaticMarkup(<FilaCrearViaje conteo={listo(0, 0)} />)).toBe('');
    expect(renderToStaticMarkup(<ListaDeInicio conteo={listo(0, 0)} elegida="abiertos" />)).toBe('');
  });

  it('1a · con viajes, la fila «Crear viaje» va debajo de la tarjeta', () => {
    const html = renderToStaticMarkup(<FilaCrearViaje conteo={listo(1, 0)} />);
    expect(html).toContain('Crear viaje');
    expect(html).toContain('Ponle nombre y suma a tus amigos');
  });

  it('un error de red no se muestra como vacío: dice que no pudo y ofrece reintentar', () => {
    const html = panel({ estado: 'error' });
    expect(html).toContain('No pudimos cargar tus viajes');
    expect(html).toContain('Reintentar');
    expect(html).not.toContain('Todavía no tienes viajes');
    expect(renderToStaticMarkup(<FilaCrearViaje conteo={{ estado: 'error' }} />)).toBe('');
  });
});

describe('D246 · la lista elegida, debajo de «Crear viaje»', () => {
  it('Abiertos: cada viaje con su línea y su balance o los pagos que faltan', () => {
    const html = renderToStaticMarkup(<ListaDeInicio conteo={listo(2, 0, [
      enLista({}),
      enLista({ id: 'v-2', nombre: 'Monterrey', estado: 'esperando_pagos', mi_balance_cents: 105000, transferencias_pendientes: 2 }),
    ])} elegida="abiertos" />);
    expect(html).toContain('Cancún 2026');
    expect(html).toContain('5–11 oct · 4 personas');
    expect(html).toContain('Debes $542');
    expect(html).toContain('Esperando pagos · faltan 2');
    expect(html.indexOf('Cancún')).toBeLessThan(html.indexOf('Monterrey'));
  });

  it('Cerrados: «Gastaste» con lo que consumí (1r)', () => {
    const html = renderToStaticMarkup(<ListaDeInicio conteo={listo(1, 1, [
      enLista({ id: 'v-3', nombre: 'Oaxaca puente', estado: 'cerrado', mi_balance_cents: null, consumiste_cents: 223000, terminado_en: '2026-08-20T15:00:00.000Z' }),
    ])} elegida="cerrados" />);
    expect(html).toContain('Oaxaca puente');
    expect(html).toContain('Gastaste');
    expect(html).toContain('$2,230');
  });

  it('lista vacía: «No tienes viajes abiertos» o «No tienes viajes cerrados»', () => {
    expect(renderToStaticMarkup(<ListaDeInicio conteo={listo(0, 2)} elegida="abiertos" />)).toContain('No tienes viajes abiertos');
    expect(renderToStaticMarkup(<ListaDeInicio conteo={listo(2, 0)} elegida="cerrados" />)).toContain('No tienes viajes cerrados');
  });
});

describe('Inicio · la tercera pestaña depende de la capacidad', () => {
  const home = readFileSync(new URL('../HomeScreen.tsx', import.meta.url), 'utf8');

  it('con Viajes, «Viajes» reemplaza a «Asociadas»; sin Viajes, «Asociadas» como siempre', () => {
    expect(home).toMatch(/const conViajes = useViajesHabilitado\(\);/);
    expect(home).toMatch(/const pestanas = conViajes \? TABS\.filter\(\(x\) => x\.id !== 'asociadas'\) : TABS;/);
    expect(home).toMatch(/\.\.\.\(conViajes \? \[\{ id: 'viajes', label: t\('Viajes'\) \}\] : \[\]\)/);
    expect(home).toMatch(/\{tab === 'viajes' && \(\s*<PanelViajes /);
  });

  it('🔴 D246 · con la pestaña Viajes no se ve «No tienes mesas abiertas»', () => {
    expect(home).toMatch(/tab !== 'viajes' && \(\s*<div className="mesa-empty">\s*<div className="mesa-empty-title">\{t\('No tienes mesas abiertas'\)\}/);
  });
});

describe('H02 · después de salir, Inicio con la pestaña Viajes', () => {
  it('el pedido se lee mientras dure y se olvida al consumirlo', async () => {
    const m = await import('./inicioEnViajes');
    expect(m.inicioPideViajes()).toBe(false);
    m.pedirInicioEnViajes();
    expect(m.inicioPideViajes()).toBe(true);
    expect(m.inicioPideViajes()).toBe(true);
    m.olvidarInicioEnViajes();
    expect(m.inicioPideViajes()).toBe(false);
  });

  it('Inicio arranca en la pestaña pedida y olvida el pedido en un efecto (StrictMode no lo pierde)', () => {
    const fuente = readFileSync(new URL('../HomeScreen.tsx', import.meta.url), 'utf8');
    expect(fuente).toMatch(/useState<TabId>\(\(\) => \(inicioPideViajes\(\) \? 'viajes' : 'cuenta'\)\)/);
    expect(fuente).toMatch(/useEffect\(\(\) => \{ olvidarInicioEnViajes\(\); \}, \[\]\);/);
  });
});
