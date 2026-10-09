import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FilaCrearViaje, PanelViajes } from './PestanaViajes';

/** AF-VIAJES · D242 · la pestaña «Viajes» de Inicio (1a, 1b). */
const nada = () => undefined;
const listo = (abiertos: number, cerrados: number) => ({ estado: 'listo' as const, counts: { abiertos, cerrados } });

describe('la pestaña Viajes', () => {
  it('1a · Abiertos y Cerrados lado a lado, con cuántos hay (el conteo del dueño)', () => {
    const html = renderToStaticMarkup(<PanelViajes conteo={listo(2, 1)} onReintentar={nada} />);
    expect(html).toContain('Abiertos');
    expect(html).toContain('2 viajes');
    expect(html).toContain('Cerrados');
    expect(html).toContain('1 viaje<');
    expect(html).toContain('launch-pair');
    expect(html).not.toContain('Todavía no tienes viajes');
  });

  it('1b · sin viajes, la tarjeta es el vacío con «Crear viaje», y no hay fila aparte', () => {
    const html = renderToStaticMarkup(<PanelViajes conteo={listo(0, 0)} onReintentar={nada} />);
    expect(html).toContain('Todavía no tienes viajes');
    expect(html).toContain('PayMe va calculando quién le debe a quién.');
    expect(html).toContain('Crear viaje');
    expect(renderToStaticMarkup(<FilaCrearViaje conteo={listo(0, 0)} />)).toBe('');
  });

  it('1a · con viajes, la fila «Crear viaje» va debajo de la tarjeta', () => {
    const html = renderToStaticMarkup(<FilaCrearViaje conteo={listo(1, 0)} />);
    expect(html).toContain('Crear viaje');
    expect(html).toContain('Ponle nombre y suma a tus amigos');
  });

  it('un error de red no se muestra como vacío: dice que no pudo y ofrece reintentar', () => {
    const html = renderToStaticMarkup(<PanelViajes conteo={{ estado: 'error' }} onReintentar={nada} />);
    expect(html).toContain('No pudimos cargar tus viajes');
    expect(html).toContain('Reintentar');
    expect(html).not.toContain('Todavía no tienes viajes');
    expect(renderToStaticMarkup(<FilaCrearViaje conteo={{ estado: 'error' }} />)).toBe('');
  });
});

describe('Inicio · la tercera pestaña depende de la capacidad', () => {
  const home = readFileSync(new URL('../HomeScreen.tsx', import.meta.url), 'utf8');

  it('con Viajes, «Viajes» reemplaza a «Asociadas»; sin Viajes, «Asociadas» como siempre', () => {
    expect(home).toMatch(/const conViajes = useViajesHabilitado\(\);/);
    expect(home).toMatch(/const pestanas = conViajes \? TABS\.filter\(\(x\) => x\.id !== 'asociadas'\) : TABS;/);
    expect(home).toMatch(/\.\.\.\(conViajes \? \[\{ id: 'viajes', label: t\('Viajes'\) \}\] : \[\]\)/);
    expect(home).toMatch(/\{tab === 'viajes' && <PanelViajes /);
  });
});
