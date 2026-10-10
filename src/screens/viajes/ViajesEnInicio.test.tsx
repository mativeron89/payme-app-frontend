import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ViajeEnLista } from '../../api/viajes';
import { BubbleTabs } from '../../components/AppHeader';
import { traducir } from '../../i18n/idioma';
import { balanceDeLaBurbuja, ViajesAbiertosVista } from './ViajesEnInicio';

/** D265 · D267 · cada viaje abierto en Inicio, como una mesa abierta: foto o inicial, nombre y balance. */
const t = (s: string, ...a: unknown[]) => traducir(s, 'es', ...a);
const nada = () => undefined;

function enLista(extra: Partial<ViajeEnLista>): ViajeEnLista {
  return {
    id: 'v-1', nombre: 'Cancún 2026', fecha_desde: '2026-10-05', fecha_hasta: '2026-10-11', estado: 'abierto', personas: 4,
    mi_balance_cents: -54200, transferencias_pendientes: null, consumiste_cents: null, terminado_en: null,
    color: null, has_photo: false, ...extra,
  };
}

const vista = (viajes: ViajeEnLista[] | null, extra: { fallo?: boolean; fotoDe?: (id: string) => string | null } = {}) =>
  renderToStaticMarkup(<ViajesAbiertosVista viajes={viajes} fallo={extra.fallo ?? false} onReintentar={nada} fotoDe={extra.fotoDe} />);

/** Cada burbuja, leída: el texto del botón. */
const burbujas = (html: string) => [...html.matchAll(/<button type="button" class="mesa-card viaje-card">([\s\S]*?)<\/button>/g)]
  .map((m) => m[1]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());

describe('🔴 D267 · el balance de la burbuja: el texto de la app y el color del balance del viaje', () => {
  it.each([
    [-54200, 'deuda', 'Debes $542'],
    [181900, 'a-favor', 'Te deben $1,819'],
    [0, 'cero', 'Estás a mano'],
  ])('%i → %s, «%s»', (cents, tono, texto) => {
    expect(balanceDeLaBurbuja(enLista({ mi_balance_cents: cents }), t)).toEqual({ tono, texto });
  });

  it('🔴 esperando pagos: «Esperando pagos · faltan N», sin monto (el balance congelado al cerrar no baja con las transferencias)', () => {
    const v = enLista({ estado: 'esperando_pagos', mi_balance_cents: -54200, transferencias_pendientes: 2 });
    expect(balanceDeLaBurbuja(v, t)).toEqual({ tono: 'esperando', texto: 'Esperando pagos · faltan 2' });
  });

  it('nunca «saldo»', () => {
    for (const cents of [-1, 0, 1]) expect(balanceDeLaBurbuja(enLista({ mi_balance_cents: cents }), t).texto).not.toMatch(/saldo/i);
    expect(vista([enLista({}), enLista({ id: 'v-2', estado: 'esperando_pagos', transferencias_pendientes: 1 })])).not.toMatch(/saldo/i);
  });
});

describe('🔴 D265 · las burbujas de los viajes abiertos', () => {
  it('una por viaje, en el orden del dueño: el rótulo, la inicial, el nombre, el balance y «Ver viaje →»', () => {
    const html = vista([
      enLista({}),
      enLista({ id: 'v-2', nombre: 'Monterrey', mi_balance_cents: 105000 }),
    ]);
    expect(burbujas(html)).toEqual([
      'Tu viaje abierto C Cancún 2026 Debes $542 Ver viaje →',
      'Tu viaje abierto M Monterrey Te deben $1,050 Ver viaje →',
    ]);
    expect(html).toContain('<section class="home-viajes" aria-label="Tus viajes abiertos">');
  });

  it('🔴 el color de cada balance va en su texto', () => {
    const html = vista([enLista({}), enLista({ id: 'v-2', mi_balance_cents: 1 }), enLista({ id: 'v-3', mi_balance_cents: 0 }),
      enLista({ id: 'v-4', estado: 'esperando_pagos', transferencias_pendientes: 3 })]);
    const clases = [...html.matchAll(/class="viaje-card-balance viaje-card-balance--([a-z-]+)"/g)].map((m) => m[1]);
    expect(clases).toEqual(['deuda', 'a-favor', 'cero', 'esperando']);
  });

  it('🔴 la foto, si tiene, sobre el color del viaje; sin foto, la inicial. El color del viaje queda en el círculo', () => {
    const html = vista([enLista({ color: 'violeta', has_photo: true }), enLista({ id: 'v-2', nombre: 'Monterrey', color: 'verde' })],
      { fotoDe: (id) => (id === 'v-1' ? 'blob:foto-cancun' : 'blob:no') });
    expect(html).toContain('<span class="vj-insignia vj-insignia--grande vj-insignia--color" style="background:#6D28D9" aria-hidden="true"><img class="vj-insignia-foto" src="blob:foto-cancun" alt=""/></span>');
    expect(html).toContain('<span class="vj-insignia vj-insignia--grande vj-insignia--color" style="background:#15803D" aria-hidden="true">M</span>');
    // `has_photo: false`: la inicial, aunque hubiera una foto guardada.
    expect(html).not.toContain('blob:no');
    // El color del viaje no tiñe la tarjeta: sólo el `style` del círculo.
    expect(html.match(/style="/g)).toHaveLength(2);
  });

  it('sin viajes abiertos, o mientras carga: nada', () => {
    expect(vista([])).toBe('');
    expect(vista(null)).toBe('');
  });

  it('sin poder preguntar: lo dice y ofrece reintentar, en vez de no mostrar nada', () => {
    const html = vista(null, { fallo: true });
    expect(html).toContain('No pudimos cargar tus viajes');
    expect(html).toContain('Reintentar');
    expect(burbujas(html)).toEqual([]);
  });
});

describe('🔴 D265 · el cableado en Inicio', () => {
  const home = readFileSync(new URL('../HomeScreen.tsx', import.meta.url), 'utf8');

  it('sólo con Viajes encendido, y con los abiertos del dueño', () => {
    expect(home).toMatch(/\{conViajes && \(\s*<ViajesAbiertosEnInicio/);
    expect(home).toMatch(/useEffect\(\(\) => \{\s*if \(conViajes\) void cargarViajes\(\);\s*\}, \[conViajes, cargarViajes\]\);/);
    expect(home).toContain(".getViajes('abiertos')");
    expect(home).toContain("ultimoVisto.guardar(turno, 'inicio.viajesAbiertos', r)");
  });

  it('debajo de la burbuja de las mesas', () => {
    expect(home.indexOf('<section className="home-mesa"')).toBeGreaterThan(0);
    expect(home.indexOf('<ViajesAbiertosEnInicio')).toBeGreaterThan(home.indexOf('<section className="home-mesa"'));
  });

  it('🔴 lo guardado se olvida después de crear, aceptar, salir y cerrar un viaje', () => {
    const fuente = (ruta: string) => readFileSync(new URL(ruta, import.meta.url), 'utf8');
    const despues = (codigo: string, llamada: string) => {
      const i = codigo.indexOf(llamada);
      expect(i, llamada).toBeGreaterThan(0);
      const siguientes = codigo.slice(i).split('\n').slice(1, 4).map((l) => l.trim()).filter((l) => !l.startsWith('//'));
      expect(siguientes[0], llamada).toBe('olvidarLoDeViajes();');
    };
    despues(fuente('./CrearViajeScreen.tsx'), 'await api.crearViaje(');
    despues(fuente('../AvisosScreen.tsx'), 'await api.aceptarViaje(viajeId);');
    despues(fuente('./ViajeScreen.tsx'), 'await api.salirDeViaje(viajeId);');
    despues(fuente('./ViajeScreen.tsx'), 'await api.cerrarViaje(viajeId);');
  });
});

describe('🔴 D265 · las pestañas de Inicio en negrita', () => {
  const tabs = [{ id: 'cuenta', label: 'Cuenta' }, { id: 'estadisticas', label: 'Estadísticas' }, { id: 'viajes', label: 'Viajes' }];

  it('`negrita` suma la clase; sin ella, como siempre', () => {
    expect(renderToStaticMarkup(<BubbleTabs tabs={tabs} active="cuenta" onSelect={nada} negrita />))
      .toMatch(/^<div class="btabs btabs--negrita" role="tablist">/);
    expect(renderToStaticMarkup(<BubbleTabs tabs={tabs} active="cuenta" onSelect={nada} />)).toMatch(/^<div class="btabs" role="tablist">/);
  });

  it('sólo Inicio la pide: Amigos y Balance no', () => {
    const fuente = (ruta: string) => readFileSync(new URL(ruta, import.meta.url), 'utf8');
    expect(fuente('../HomeScreen.tsx')).toMatch(/onSelect=\{\(id\) => setTab\(id as TabId\)\}\s*\/\/[^\n]*\n\s*negrita\s*\/>/);
    expect(fuente('../SocialScreen.tsx')).not.toContain('negrita');
    expect(fuente('./BalanceScreen.tsx')).not.toMatch(/<BubbleTabs[^>]*negrita/);
  });
});
