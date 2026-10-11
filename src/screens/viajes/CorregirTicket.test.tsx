import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ItemDelTicket, MiembroViaje, TicketDelViaje } from '../../api/viajes';
import { CorregirTicketVista } from './CorregirTicket';
import { borradorDe, cambiarRenglon, type BorradorEscaneado, type BorradorGasto } from './corregirTicketView';
import { TicketVista, type TicketVistaProps } from './TicketScreen';
import { ausentesDelTicket, seleccionGuardada } from './ticketView';

/**
 * 🔴 D278-3 · D282-2 · la entrada («Corregir ticket» / «Corregir gasto») y la pantalla de corrección, renderizadas sin
 * red. Los cálculos los prueba `corregirTicketView.test.ts`; acá, que la pantalla los muestra.
 */
const nada = () => undefined;

const miembro = (id: string, first: string, extra: Partial<MiembroViaje> = {}): MiembroViaje => ({
  id, first_name: first, last_name: 'Pérez', username: null, eliminada: false, es_yo: false, balance_cents: 0, falta_elegir: 0,
  has_avatar: false, pagado_cents: 0, ...extra,
});
const MIEMBROS = [miembro('m1', 'Mati', { es_yo: true }), miembro('m2', 'Luis')];
const item = (id: string, name: string, price: number, extra: Partial<ItemDelTicket> = {}): ItemDelTicket => ({
  id, name, price_cents: price, quantity: 1, line_cents: price, remaining_bps: 10000, my_bps: 0, my_amount_cents: 0, ...extra,
});
const NATAMBRE: TicketDelViaje = {
  id: 'tk', lugar: 'NATAMBRE', tipo_lugar: 'restaurante', fecha_ticket: '2026-10-08', hora_ticket: '21:40', cargado_en: null,
  forma: 'consumo', monto_cents: 83500, pagado_por: 'm2', pagaste_tu: false,
  items: [item('i1', 'Pescado a la talla', 52500, { remaining_bps: 0 }), item('i2', 'Aguachile', 31000)],
  personas: [{ miembro_id: 'm1', ya_eligio: false, presente: true }, { miembro_id: 'm2', ya_eligio: true, presente: true }],
  te_toca_cents: 0, sin_repartir_cents: 31000, puedo_elegir: true, puedo_marcar_presentes: true, personal: false,
  pagadores: [{ miembro_id: 'm2', monto_cents: 83500 }], servicio_cents: 0, descuentos_cents: 0, iva_aparte_cents: 0,
  total_cents: 83500, te_toca_platos_cents: 0, puedo_corregir: true,
};
const GASOLINA: TicketDelViaje = {
  ...NATAMBRE, lugar: 'Gasolina', tipo_lugar: 'otro', forma: 'iguales', fecha_ticket: null, hora_ticket: null,
  items: [item('g1', 'Gasolina', 90000, { remaining_bps: 0 })], monto_cents: 90000, total_cents: 90000, pagado_por: 'm1',
  pagaste_tu: true, pagadores: [{ miembro_id: 'm1', monto_cents: 45000 }, { miembro_id: 'm2', monto_cents: 45000 }],
};

function detalle(ticket: TicketDelViaje, extra: Partial<TicketVistaProps> = {}) {
  return renderToStaticMarkup(
    <TicketVista
      ticket={ticket} miembros={MIEMBROS} seleccion={seleccionGuardada(ticket.items)} abierto={null}
      ausentes={ausentesDelTicket(ticket.personas)} guardando={false} onTomar={nada} onSoltar={nada} onAbrir={nada}
      onPorcion={nada} onListo={nada} onPresente={nada} onGuardarPresentes={nada} origen="escaneo" onCorregir={nada}
      {...extra}
    />,
  );
}

function correccion(ticket: TicketDelViaje, origen: 'escaneo' | 'manual', extra: Partial<Parameters<typeof CorregirTicketVista>[0]> = {}) {
  return renderToStaticMarkup(
    <CorregirTicketVista ticket={ticket} origen={origen} miembros={MIEMBROS} enviando={false} onGuardar={nada} {...extra} />,
  );
}

/** El botón con su texto, sin importar el orden de los atributos. */
const boton = (html: string, texto: string) => new RegExp(`<button[^>]*>${texto}</button>`).exec(html)?.[0] ?? null;

describe('🔴 1 · la entrada: «Corregir» sólo con `puedo_corregir`', () => {
  it('un escaneado dice «Corregir ticket»; un gasto a mano, «Corregir gasto»', () => {
    expect(boton(detalle(NATAMBRE), 'Corregir ticket')).toContain('btn-ghost');
    expect(boton(detalle(GASOLINA, { origen: 'manual' }), 'Corregir gasto')).not.toBeNull();
    expect(detalle(GASOLINA, { origen: 'manual' })).not.toContain('Corregir ticket');
  });

  it('en las tres formas', () => {
    for (const forma of ['consumo', 'iguales', 'total'] as const) {
      expect(boton(detalle({ ...NATAMBRE, forma }), 'Corregir ticket'), forma).not.toBeNull();
    }
  });

  it('sin `puedo_corregir`, sin origen conocido o con el viaje cerrado: no hay botón', () => {
    expect(detalle({ ...NATAMBRE, puedo_corregir: false, puedo_marcar_presentes: false })).not.toContain('Corregir');
    expect(detalle(NATAMBRE, { origen: null })).not.toContain('Corregir');
    expect(detalle(NATAMBRE, { cerrado: true })).not.toContain('Corregir');
  });
});

describe('🔴 2 · la pantalla de corrección de un escaneado', () => {
  it('el título, el lugar como está y cada campo con su rótulo', () => {
    const html = correccion(NATAMBRE, 'escaneo');
    expect(html).toContain('Corregir ticket');
    expect(html).toContain('NATAMBRE');
    for (const r of ['Nombre del lugar', 'Tipo de lugar', 'Fecha', 'Hora', 'Renglones', 'Servicio', 'Descuento', 'IVA aparte',
      'Total del ticket', 'Agregar renglón']) expect(html, r).toContain(r);
    expect(html).toMatch(/<input[^>]*value="NATAMBRE"[^>]*>/);
    expect(html).toMatch(/<input[^>]*maxLength="120"[^>]*value="NATAMBRE"|<input[^>]*value="NATAMBRE"[^>]*maxLength="120"/);
    expect(html).toMatch(/type="date"[^>]*value="2026-10-08"|value="2026-10-08"[^>]*type="date"/);
    expect(html).toMatch(/type="time"[^>]*value="21:40"|value="21:40"[^>]*type="time"/);
  });

  it('cada renglón: nombre, − cantidad +, precio, lo del renglón y «Sacar», con rótulos para el lector de pantalla', () => {
    const html = correccion(NATAMBRE, 'escaneo');
    for (const a of ['Nombre de Pescado a la talla', 'Uno menos de Pescado a la talla', 'Uno más de Pescado a la talla',
      'Precio de Pescado a la talla', 'Sacar Pescado a la talla']) expect(html, a).toContain(`aria-label="${a}"`);
    expect(html).toMatch(/<input[^>]*value="525"/);
    expect(html).toContain('$525');
    // Con cantidad 1, «Uno menos» está apagado.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Uno menos de Pescado a la talla"|<button[^>]*aria-label="Uno menos de Pescado a la talla"[^>]*disabled=""/);
  });

  it('sin cambios, «Guardar» está apagado y no hay aviso', () => {
    const html = correccion(NATAMBRE, 'escaneo');
    expect(boton(html, 'Guardar')).toContain('disabled');
    expect(html).not.toContain('van a tener que volver a elegir');
  });

  it('un precio con elecciones de otros: el total nuevo, «Antes», el aviso previo y «Guardar» encendido', () => {
    const b = cambiarRenglon(borradorDe(NATAMBRE, 'escaneo') as BorradorEscaneado, 'i1', { precio: '495' });
    const html = correccion(NATAMBRE, 'escaneo', { borradorInicial: b });
    expect(html).toContain('$805');
    expect(html).toContain('Antes $835');
    expect(html).toContain('Cambiaste el precio de Pescado a la talla: quienes lo eligieron van a tener que volver a elegir.');
    expect(boton(html, 'Guardar')).not.toContain('disabled');
  });

  it('un problema manda sobre el aviso y apaga «Guardar»', () => {
    const b = cambiarRenglon(borradorDe(NATAMBRE, 'escaneo') as BorradorEscaneado, 'i1', { precio: '1.250' });
    const html = correccion(NATAMBRE, 'escaneo', { borradorInicial: b });
    expect(html).toContain('No sabemos si es con decimales o con miles.');
    expect(boton(html, 'Guardar')).toContain('disabled');
  });

  it('con servicio, descuentos o IVA aparte, cómo se llega al total', () => {
    const b = { ...(borradorDe(NATAMBRE, 'escaneo') as BorradorEscaneado), servicio: '50' };
    const html = correccion(NATAMBRE, 'escaneo', { borradorInicial: b });
    expect(html).toContain('vjt-ajustes');
    expect(html).toContain('Cargo por servicio');
    expect(html).toContain('$885');
  });

  it('sin fecha, la hora está apagada y vacía (el dueño pide una fecha para la hora)', () => {
    const b = { ...(borradorDe(NATAMBRE, 'escaneo') as BorradorEscaneado), fecha: '' };
    const html = correccion(NATAMBRE, 'escaneo', { borradorInicial: b });
    const hora = /<input[^>]*type="time"[^>]*>/.exec(html)?.[0] ?? '';
    expect(hora).toContain('disabled=""');
    expect(hora).toContain('value=""');
    const conFecha = /<input[^>]*type="time"[^>]*>/.exec(correccion(NATAMBRE, 'escaneo'))?.[0] ?? '';
    expect(conFecha).not.toContain('disabled');
  });

  it('mientras guarda, todo apagado', () => {
    const b = { ...(borradorDe(NATAMBRE, 'escaneo') as BorradorEscaneado), lugar: 'Matambre' };
    const html = correccion(NATAMBRE, 'escaneo', { borradorInicial: b, enviando: true });
    expect(boton(html, 'Guardar')).toContain('disabled');
    expect(boton(html, 'Guardar')).toContain('aria-busy="true"');
  });
});

describe('🔴 2 y 4 · un gasto a mano y los pagadores', () => {
  it('descripción y monto; ni tipo, ni fecha, ni renglones', () => {
    const html = correccion(GASOLINA, 'manual');
    expect(html).toContain('Corregir gasto');
    expect(html).toMatch(/<input[^>]*value="Gasolina"/);
    expect(html).toMatch(/<input[^>]*value="900"/);
    for (const fuera of ['Tipo de lugar', 'Renglones', 'IVA aparte']) expect(html, fuera).not.toContain(fuera);
    expect(html).not.toContain('¿Cuánto pagó cada uno?');
  });

  it('otro total con dos pagadores: los montos de antes, «Suman $X de $Y», «Partes iguales» y «Guardar» esperando', () => {
    const b: BorradorGasto = { ...(borradorDe(GASOLINA, 'manual') as BorradorGasto), monto: '950' };
    const html = correccion(GASOLINA, 'manual', { borradorInicial: b });
    expect(html).toContain('¿Cuánto pagó cada uno?');
    expect(html).toContain('Antes $900');
    expect(html).toContain('aria-label="Cuánto pagaste tú"');
    expect(html).toContain('aria-label="Cuánto pagó Luis Pérez"');
    expect(html.match(/<input[^>]*value="450"/g)).toHaveLength(2);
    expect(html).toContain('Suman $900 de $950');
    expect(boton(html, 'Partes iguales')).not.toBeNull();
    expect(html).toContain('Los montos tienen que sumar $950. Ahora suman $900.');
    expect(boton(html, 'Guardar')).toContain('disabled');
  });

  it('con los montos que suman, «Guardar» se enciende', () => {
    const b: BorradorGasto = { ...(borradorDe(GASOLINA, 'manual') as BorradorGasto), monto: '950' };
    const html = correccion(GASOLINA, 'manual', { borradorInicial: b, montosInicialesDePagadores: ['500', '450'] });
    expect(boton(html, 'Guardar')).not.toContain('disabled');
  });
});

describe('🔴 5 · después de guardar, Estadísticas se pide de nuevo', () => {
  /**
   * El dueño calcula Estadísticas al leer (`estadisticas.que_cuenta` y `.restaurante` del contrato: cambiar el ticket
   * cambia la estadística, y el restaurante sale del nombre del ticket). Lo que le toca al front es no mostrar algo
   * guardado: cada pantalla que pide `getStats*` lo pide al abrirse, sin caché. El censo sale del código, no de una lista.
   */
  const pantallas = import.meta.glob('/src/screens/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const deEstadisticas = Object.entries(pantallas).filter(([ruta, src]) => !ruta.includes('.test.') && /\bapi\s*\.\s*getStats\w*\(/.test(src));

  it('las pantallas que piden Estadísticas no guardan lo que trajeron', () => {
    expect(deEstadisticas.map(([r]) => r.split('/').pop()).sort())
      .toEqual(['EstadisticasScreen.tsx', 'EvolucionScreen.tsx', 'QueComesScreen.tsx', 'TusRestaurantesScreen.tsx']);
    for (const [ruta, src] of deEstadisticas) {
      expect(src, ruta).not.toMatch(/ultimoVisto|MemoriaDeCuenta|useUltimoVisto|sessionStorage|localStorage/);
    }
  });

  it('la pantalla del ticket olvida lo de Viajes de Inicio al corregir', () => {
    const src = readFileSync(new URL('./TicketScreen.tsx', import.meta.url), 'utf8');
    const guardar = src.match(/async function guardarCorreccion[\s\S]*?\n  }\n/)?.[0] ?? '';
    // El camino feliz: desde la respuesta del dueño hasta el `catch` (el 404 también olvida, pero en otra rama).
    const exito = guardar.match(/await api\.corregirTicketDeViaje\([\s\S]*?\} catch \(err\) \{/)?.[0] ?? '';
    expect(exito).not.toBe('');
    expect(exito).toContain('olvidarLoDeViajes();');
  });
});
