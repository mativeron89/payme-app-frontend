import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DetalleViaje, TicketEnViaje, ViajeEnLista } from '../../api/viajes';
import { AppBottomBar } from '../../components/AppBottomBar';
import { BubbleTabs } from '../../components/AppHeader';
import { traducir } from '../../i18n/idioma';
import { AvisoSinMesas } from '../AvisoSinMesas';
import {
  etiquetaDeLaBurbuja,
  etiquetaDelPendiente,
  montoDeLaBurbuja,
  restaurantesPendientes,
  textoDeFaltan,
  ViajesAbiertosVista,
  type PendientesDeViajes,
} from './ViajesEnInicio';

/**
 * D265 · cada viaje abierto en Inicio. D275 · con el diseño de Claude Design (`PANTALLA-burbuja-del-viaje.md`): la foto,
 * el nombre y el monto; debajo, separada, cada restaurante con gente por elegir (D271); y «No tienes mesas abiertas» al
 * pie, sobre la barra.
 */
const t = (s: string, ...a: unknown[]) => traducir(s, 'es', ...a);
const en = (s: string, ...a: unknown[]) => traducir(s, 'en', ...a);
const nada = () => undefined;
const MENOS = '−';

function enLista(extra: Partial<ViajeEnLista>): ViajeEnLista {
  return {
    id: 'v-1', nombre: 'Cancún 2026', fecha_desde: '2026-10-05', fecha_hasta: '2026-10-11', estado: 'abierto', personas: 4,
    mi_balance_cents: -54200, transferencias_pendientes: null, consumiste_cents: null, terminado_en: null,
    color: null, has_photo: false, ...extra,
  };
}

const vista = (viajes: ViajeEnLista[] | null, extra: {
  fallo?: boolean; fotoDe?: (id: string) => string | null; pendientes?: PendientesDeViajes | null;
} = {}) => renderToStaticMarkup(
  <ViajesAbiertosVista viajes={viajes} pendientes={extra.pendientes} fallo={extra.fallo ?? false} onReintentar={nada} fotoDe={extra.fotoDe} />,
);

const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
/** Cada burbuja de viaje: su `aria-label` y su texto. */
const burbujas = (html: string) => [...html.matchAll(/<button type="button" class="viaje-burbuja" aria-label="([^"]*)">([\s\S]*?)<\/button>/g)]
  .map((m) => ({ aria: m[1], texto: texto(m[2]!) }));
const pendientesEn = (html: string) => [...html.matchAll(/<button type="button" class="viaje-pendiente" aria-label="([^"]*)">([\s\S]*?)<\/button>/g)]
  .map((m) => ({ aria: m[1], texto: texto(m[2]!) }));

describe('🔴 D275 · el monto de la burbuja: tres colores, el «−» y los centavos sólo si los hay', () => {
  it.each([
    [1056568, 'a-favor', '$10,565.68'],
    [0, 'cero', '$0'],
    [-54200, 'deuda', `${MENOS}$542`],
    [-54250, 'deuda', `${MENOS}$542.50`],
    [181900, 'a-favor', '$1,819'],
    [-1, 'deuda', `${MENOS}$0.01`],
  ])('%i → %s, «%s»', (cents, tono, monto) => {
    expect(montoDeLaBurbuja(cents)).toEqual({ tono, texto: monto });
  });

  it('nunca «.00», nunca el guion común ni «+», nunca «saldo»', () => {
    for (const cents of [-54200, 0, 181900, 100]) {
      const { texto: m } = montoDeLaBurbuja(cents);
      expect(m).not.toContain('.00');
      expect(m).not.toMatch(/^[-+]/);
      expect(m).not.toMatch(/saldo/i);
    }
  });

  it('el `aria-label`: «Holbox, te deben $10,565.68» / «Holbox, debes $542» / «Holbox, estás al día»', () => {
    expect(etiquetaDeLaBurbuja('Holbox', 1056568, t)).toBe('Holbox, te deben $10,565.68');
    expect(etiquetaDeLaBurbuja('Holbox', -54200, t)).toBe('Holbox, debes $542');
    expect(etiquetaDeLaBurbuja('Holbox', 0, t)).toBe('Holbox, estás al día');
    expect(etiquetaDeLaBurbuja('Holbox', -54200, en)).toBe('Holbox, you owe $542');
  });
});

describe('🔴 D275 · la burbuja del viaje: sólo la foto, el nombre y el monto', () => {
  it('una por viaje, en el orden del dueño; sin «Tu viaje abierto», «Te deben» ni «Ver viaje →»', () => {
    const html = vista([enLista({}), enLista({ id: 'v-2', nombre: 'Monterrey', mi_balance_cents: 105000 })]);
    expect(burbujas(html)).toEqual([
      { aria: 'Cancún 2026, debes $542', texto: `C Cancún 2026 ${MENOS}$542` },
      { aria: 'Monterrey, te deben $1,050', texto: 'M Monterrey $1,050' },
    ]);
    // Lo que se VE (el `aria-label` sí dice «debes»: es lo que oye el lector de pantalla).
    expect(texto(html)).not.toMatch(/Tu viaje abierto|Te deben|Debes|Ver viaje|Estás a mano|saldo/i);
    expect(html).toMatch(/^<section class="home-viajes" aria-label="Tus viajes abiertos">/);
  });

  it('🔴 un viaje que espera pagos se ve igual que uno abierto, con su monto (D275, «Igual que abierto»)', () => {
    const html = vista([enLista({ estado: 'esperando_pagos', mi_balance_cents: -54200, transferencias_pendientes: 2 })]);
    expect(burbujas(html)).toEqual([{ aria: 'Cancún 2026, debes $542', texto: `C Cancún 2026 ${MENOS}$542` }]);
    expect(html).not.toContain('Esperando pagos');
  });

  it('🔴 el color va en el monto, por tono', () => {
    const html = vista([enLista({}), enLista({ id: 'v-2', mi_balance_cents: 1 }), enLista({ id: 'v-3', mi_balance_cents: 0 })]);
    expect([...html.matchAll(/class="viaje-burbuja-monto viaje-burbuja-monto--([a-z-]+)"/g)].map((m) => m[1]))
      .toEqual(['deuda', 'a-favor', 'cero']);
    const css = readFileSync(new URL('./inicio.css', import.meta.url), 'utf8');
    expect(css).toContain('.viaje-burbuja-monto--a-favor { color: var(--success); }');
    expect(css).toContain('.viaje-burbuja-monto--cero { color: var(--text); }');
    expect(css).toContain('.viaje-burbuja-monto--deuda { color: var(--danger); }');
  });

  it('🔴 la foto, cuadrada redondeada, sobre el color del viaje; sin foto, la inicial; sin color, el teal de la app', () => {
    const html = vista([
      enLista({ color: 'violeta', has_photo: true }),
      enLista({ id: 'v-2', nombre: 'Monterrey', color: 'verde' }),
      enLista({ id: 'v-3', nombre: 'Oaxaca' }),
    ], { fotoDe: (id) => (id === 'v-1' ? 'blob:foto-cancun' : 'blob:no') });
    expect(html).toContain('<span class="vj-insignia vj-insignia--burbuja vj-insignia--color" style="background:#6D28D9" aria-hidden="true"><img class="vj-insignia-foto" src="blob:foto-cancun" alt=""/></span>');
    expect(html).toContain('<span class="vj-insignia vj-insignia--burbuja vj-insignia--color" style="background:#15803D" aria-hidden="true">M</span>');
    expect(html).toContain('<span class="vj-insignia vj-insignia--burbuja" aria-hidden="true">O</span>');
    expect(html).not.toContain('blob:no');
    // El color del viaje no tiñe la burbuja: sólo el `style` de la insignia.
    expect(html.match(/style="/g)).toHaveLength(2);
    const css = readFileSync(new URL('./viajes.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.vj-insignia--burbuja \{\s*width: 64px;\s*height: 64px;\s*border-radius: 18px;\s*font-size: 28px;/);
  });

  it('🔴 el nombre largo: dos líneas como mucho, después «…»', () => {
    const css = readFileSync(new URL('./inicio.css', import.meta.url), 'utf8');
    const regla = css.slice(css.indexOf('.viaje-burbuja-nombre {'), css.indexOf('}', css.indexOf('.viaje-burbuja-nombre {')));
    expect(regla).toContain('-webkit-line-clamp: 2;');
    expect(regla).toContain('overflow: hidden;');
    expect(regla).toContain('font-size: 18px;');
  });

  it('🔴 las medidas de la especificación', () => {
    const css = readFileSync(new URL('./inicio.css', import.meta.url), 'utf8');
    const de = (selector: string) => css.slice(css.indexOf(`${selector} {`), css.indexOf('}', css.indexOf(`${selector} {`)));
    expect(de('.home-viajes')).toMatch(/gap: 20px;[\s\S]*margin: 28px var\(--sp-4\) 0;/);
    expect(de('.viaje-grupo')).toContain('gap: 8px;');
    for (const m of ['min-height: 96px;', 'padding: 16px;', 'gap: 14px;', 'border: 1px solid var(--border);', 'border-radius: 22px;', 'box-shadow: var(--sh-1), var(--sh-3);']) {
      expect(de('.viaje-burbuja'), m).toContain(m);
    }
    for (const m of ['margin-left: 24px;', 'width: calc(100% - 24px);', 'min-height: 60px;', 'padding: 10px 12px 10px 10px;', 'gap: 12px;', 'border-radius: 16px;']) {
      expect(de('.viaje-pendiente'), m).toContain(m);
    }
  });

  it('sin viajes abiertos, o mientras carga: nada; sin poder preguntar, el error con «Reintentar»', () => {
    expect(vista([])).toBe('');
    expect(vista(null)).toBe('');
    const html = vista(null, { fallo: true });
    expect(html).toContain('No pudimos cargar tus viajes');
    expect(html).toContain('Reintentar');
    expect(burbujas(html)).toEqual([]);
  });
});

// ─── D271 · el restaurante con gente por elegir ─────────────────────────────

function ticket(extra: Partial<TicketEnViaje>): TicketEnViaje {
  return {
    id: 'tk-1', lugar: 'La Parolaccia', tipo_lugar: 'restaurante', fecha_ticket: '2026-10-08', hora_ticket: '21:40',
    cargado_en: '2026-10-09T03:40:00.000Z', forma: 'consumo', pagado_por: 'm-luis', pagaste_tu: false,
    te_toca_cents: 53000, falta_que_elija: 2, sin_repartir_cents: 56500, monto_cents: 159000, origen: 'escaneo',
    puede_eliminar: false, pagadores: [{ miembro_id: 'm-luis', monto_cents: 159000 }], presentes: [], personal: false, ...extra,
  };
}

function detalle(tickets: TicketEnViaje[], extra: Partial<DetalleViaje> = {}): DetalleViaje {
  return {
    id: 'v-1', nombre: 'Cancún 2026', fecha_desde: null, fecha_hasta: null, estado: 'abierto', creado_en: null,
    mi_miembro_id: 'm-ana', miembros: [], invitados: [], mi_balance_cents: 0, gasto_del_grupo_cents: 0, tickets,
    sin_repartir: [], transferencias: [], transferencias_pendientes: 0, color: null, has_photo: false, ...extra,
  };
}

describe('🔴 D271 · qué ticket es un restaurante pendiente', () => {
  it('los escaneados por lo que pidió cada uno, con alguien sin elegir; en el orden del dueño (el más reciente primero)', () => {
    const d = detalle([
      ticket({ id: 'tk-3', lugar: 'Tacos El Güero', falta_que_elija: 1 }),
      ticket({ id: 'tk-2', lugar: 'Café Tacuba', falta_que_elija: 0 }),
      ticket({ id: 'tk-1' }),
    ]);
    expect(restaurantesPendientes(d)).toEqual([
      { ticket_id: 'tk-3', lugar: 'Tacos El Güero', tipo_lugar: 'restaurante', faltan: 1 },
      { ticket_id: 'tk-1', lugar: 'La Parolaccia', tipo_lugar: 'restaurante', faltan: 2 },
    ]);
  });

  it('🔴 un gasto a mano, «en partes iguales» o «pagar el total», no esperan a nadie: no aparecen', () => {
    const d = detalle([
      ticket({ id: 'g-1', origen: 'manual', falta_que_elija: 3 }),
      ticket({ id: 'tk-i', forma: 'iguales', falta_que_elija: 3 }),
      ticket({ id: 'tk-t', forma: 'total', falta_que_elija: 3 }),
    ]);
    expect(restaurantesPendientes(d)).toEqual([]);
  });

  it('🔴 con todos los platos asignados y alguien sin «Listo», sigue pendiente (no está en `sin_repartir`, D271)', () => {
    const d = detalle([ticket({ falta_que_elija: 1, sin_repartir_cents: 0 })], { sin_repartir: [] });
    expect(restaurantesPendientes(d)).toHaveLength(1);
  });

  it('sólo de un viaje abierto: esperando pagos o cerrado, nada', () => {
    expect(restaurantesPendientes(detalle([ticket({})], { estado: 'esperando_pagos' }))).toEqual([]);
    expect(restaurantesPendientes(detalle([ticket({})], { estado: 'cerrado' }))).toEqual([]);
  });

  it('«Faltan N por elegir»; con uno, «Falta 1 por elegir»; y su `aria-label`', () => {
    expect(textoDeFaltan(2, t)).toBe('Faltan 2 por elegir');
    expect(textoDeFaltan(1, t)).toBe('Falta 1 por elegir');
    expect(textoDeFaltan(2, en)).toBe('2 left to choose');
    expect(etiquetaDelPendiente('La Parolaccia', 2, t)).toBe('La Parolaccia, faltan 2 por elegir');
    expect(etiquetaDelPendiente('Tacos El Güero', 1, t)).toBe('Tacos El Güero, falta 1 por elegir');
  });
});

describe('🔴 D271 · D275 · el restaurante pendiente, debajo de su viaje y separado', () => {
  const pendientes: PendientesDeViajes = {
    'v-1': [
      { ticket_id: 'tk-3', lugar: 'Tacos El Güero', tipo_lugar: 'restaurante', faltan: 1 },
      { ticket_id: 'tk-1', lugar: null, tipo_lugar: 'bar', faltan: 2 },
    ],
  };

  it('cada uno con su lugar (o el tipo) y cuántos faltan, en su orden; sólo bajo SU viaje', () => {
    const html = vista([enLista({}), enLista({ id: 'v-2', nombre: 'Monterrey', mi_balance_cents: 0 })], { pendientes });
    expect(pendientesEn(html)).toEqual([
      { aria: 'Tacos El Güero, falta 1 por elegir', texto: 'Tacos El Güero Falta 1 por elegir' },
      { aria: 'Bar, faltan 2 por elegir', texto: 'Bar Faltan 2 por elegir' },
    ]);
    // Cada viaje en su grupo: los pendientes de Cancún están en el primero, y el de Monterrey no tiene ninguno.
    const grupos = html.split('<div class="viaje-grupo">').slice(1);
    expect(grupos).toHaveLength(2);
    expect(grupos[0]).toContain('class="viaje-burbuja"');
    expect(pendientesEn(grupos[0]!)).toHaveLength(2);
    expect(grupos[0]!.indexOf('class="viaje-burbuja"')).toBeLessThan(grupos[0]!.indexOf('class="viaje-pendiente"'));
    expect(pendientesEn(grupos[1]!)).toEqual([]);
  });

  it('los cubiertos, en su cuadro, y el chevron; nada del dinero', () => {
    const html = vista([enLista({})], { pendientes });
    expect(html).toContain('<span class="viaje-pendiente-ico" aria-hidden="true"><svg');
    expect(html).toContain('<span class="viaje-pendiente-ir" aria-hidden="true"><svg');
    expect(pendientesEn(html).map((p) => p.texto).join(' ')).not.toMatch(/\$/);
  });

  it('sin pendientes, o sin poder preguntar por ellos: sólo la burbuja del viaje', () => {
    for (const p of [null, {}, { 'v-1': [] }] as Array<PendientesDeViajes | null>) {
      const html = vista([enLista({})], { pendientes: p });
      expect(pendientesEn(html), JSON.stringify(p)).toEqual([]);
      expect(burbujas(html)).toHaveLength(1);
    }
  });

  it('🔴 tocarlo abre la elección de ESE ticket (la misma pantalla que abre Balance)', () => {
    const fuente = readFileSync(new URL('./ViajesEnInicio.tsx', import.meta.url), 'utf8');
    expect(fuente).toContain("onClick={() => navigate('viaje-ticket', parametroDeTicket(v.id, p.ticket_id))}");
    expect(readFileSync(new URL('./BalanceScreen.tsx', import.meta.url), 'utf8'))
      .toContain("navigate('viaje-ticket', parametroDeTicket(viajeId, ticketId))");
  });
});

describe('🔴 D265 · D271 · el cableado en Inicio', () => {
  const home = readFileSync(new URL('../HomeScreen.tsx', import.meta.url), 'utf8');
  const visto = readFileSync(new URL('../../api/ultimoVisto.ts', import.meta.url), 'utf8');

  it('sólo con Viajes encendido, con los abiertos del dueño, y los pendientes con el MISMO turno de la lista', () => {
    expect(home).toMatch(/\{conViajes && \(\s*<ViajesAbiertosEnInicio/);
    expect(home).toContain(".getViajes('abiertos')");
    const f = home.slice(home.indexOf('const cargarViajes = useCallback'), home.indexOf('}, []);', home.indexOf('const cargarViajes = useCallback')));
    expect(f.match(/ultimoVisto\.turno\(\)/g)).toHaveLength(1);
    expect(f).toContain("ultimoVisto.guardar(turno, 'inicio.viajesAbiertos', r)");
    expect(f).toContain("ultimoVisto.guardar(turno, 'inicio.pendientesDeViajes', pendientes)");
    // Sólo se pregunta por los pendientes si la lista se guardó (era de esta cuenta), y sólo de los abiertos.
    expect(f.indexOf('if (!g) return undefined;')).toBeLessThan(f.indexOf('api.getViaje('));
    expect(f).toContain("r.viajes.filter((v) => v.estado === 'abierto')");
    // Un detalle que falla queda afuera, no tira la lista.
    expect(f).toMatch(/api\.getViaje\(v\.id\)\.then\(\s*\(d\) => \[v\.id, restaurantesPendientes\(d\)\] as const,\s*\(\) => null,\s*\)/);
    // El error de la lista olvida los dos, mirando antes el turno (T-01).
    expect(f).toMatch(/\.catch\(\(\) => \{\s*if \(!ultimoVisto\.esDeAhora\(turno\)\) return;\s*ultimoVisto\.olvidar\('inicio\.viajesAbiertos', 'inicio\.pendientesDeViajes'\);/);
  });

  it('🔴 olvidarLoDeViajes() olvida también los pendientes', () => {
    expect(visto).toMatch(/export function olvidarLoDeViajes\(\): void \{\s*ultimoVisto\.olvidar\('inicio\.viajesAbiertos', 'inicio\.pendientesDeViajes'\);/);
  });

  it('debajo de la sección de las mesas (el orden de D265)', () => {
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

describe('🔴 D275 · D277 · «No tienes mesas abiertas», con la cámara y en el medio del espacio libre', () => {
  const home = readFileSync(new URL('../HomeScreen.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');
  const de = (selector: string) => css.slice(css.indexOf(`${selector} {`), css.indexOf('}', css.indexOf(`${selector} {`)));

  it('el texto, con el ícono de la cámara de Nueva en lugar del «+», en su caja', () => {
    const html = renderToStaticMarkup(<AvisoSinMesas />);
    expect(texto(html)).toBe('No tienes mesas abiertas Toca el para abrir una');
    expect(html).toMatch(/^<div class="aviso-sin-mesas"><div class="aviso-sin-mesas-titulo">/);
    expect(html).toContain('<span class="aviso-sin-mesas-camara" role="img" aria-label="ícono de cámara"><svg');
    expect(html).not.toContain('+');
  });

  it('🔴 sólo con la lista de mesas leída y vacía (ni cargando ni con error), y no en la pestaña Viajes (D246)', () => {
    expect(home).toContain("const avisoSinMesas = openMesas !== null && !mesasFallaron && porUrgencia.length === 0 && tab !== 'viajes';");
    expect(home).toContain('{avisoSinMesas && <AvisoSinMesas />}');
    // Ya no vive en la sección de la mesa.
    expect(home).not.toContain('mesa-empty');
    expect(home).not.toContain("t('Toca el + para abrir una')");
  });

  it('🔴 D277 · va al final del contenido de Inicio (en el flujo), y la barra ya no lo cuelga', () => {
    // Lo último del `.scroll`, después de todo lo demás.
    const scroll = home.slice(home.indexOf("<div className={`scroll${avisoSinMesas ? ' con-aviso-sin-mesas' : ''}`}>"));
    const cierre = scroll.indexOf('<AppBottomBar');
    expect(scroll.slice(0, cierre)).toMatch(/\{avisoSinMesas && <AvisoSinMesas \/>\}\s*<\/div>\s*$/);
    expect(home).toContain('<AppBottomBar active="home" />');
    // La barra es la de siempre: sin la franja de D275.
    expect(renderToStaticMarkup(<AppBottomBar active="home" />)).toMatch(/^<div class="appbar-block">/);
    expect(css).not.toContain('.appbar-aviso');
  });

  it('🔴 D277 · la columna: el aviso toma el resto del alto y centra el texto; abajo, la barra y el círculo de Nueva', () => {
    const columna = de('.has-appbar .scroll.con-aviso-sin-mesas');
    for (const m of ['display: flex;', 'flex-direction: column;', 'padding-bottom: calc(var(--appbar-alto) + 26px);']) {
      expect(columna, m).toContain(m);
    }
    // Lo que sobresale el círculo es lo mismo que suma la columna.
    expect(de('.appbar-fab')).toContain('top: -26px;');
    const aviso = de('.aviso-sin-mesas');
    for (const m of ['flex: 1 0 auto;', 'justify-content: center;', 'padding: var(--sp-6) var(--sp-4);']) {
      expect(aviso, m).toContain(m);
    }
    expect(aviso).not.toMatch(/position:\s*(fixed|absolute)/);
    // En columna cada uno conserva su alto, y la sección de la mesa vacía no suma margen (no colapsa).
    expect(de('.has-appbar .scroll.con-aviso-sin-mesas > *')).toContain('flex-shrink: 0;');
    expect(de('.has-appbar .scroll.con-aviso-sin-mesas > .home-mesa:empty')).toContain('display: none;');
    expect(home).toContain("<div className={`scroll${avisoSinMesas ? ' con-aviso-sin-mesas' : ''}`}>");
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
