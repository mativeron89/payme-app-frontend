import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DetalleViaje, MiembroViaje, TicketEnViaje, TransferenciaViaje, VistaPreviaCierre } from '../../api/viajes';
import { BalanceVista } from './BalanceScreen';
import {
  HojaCerrarVista,
  HojaNoPuedeSalirVista,
  HojaSalirVista,
  ViajeVista,
  type CargaDeViaje,
  type ViajeVistaProps,
} from './ViajeScreen';

/**
 * AF-VIAJES · D242 · las vistas puras del viaje (1g, 1m, 1n, 1o, 1p, 1q) y del
 * balance (1l), renderizadas en Node sin DOM. Los efectos no corren acá: la
 * red y el estado viven en los contenedores. Se mira el TEXTO que ve la
 * persona (sin etiquetas) y, donde importa, el marcado.
 */

const IDS = { yo: 'm-ana', luis: 'm-luis', sofia: 'm-sofia', diego: 'm-diego' } as const;

function miembro(id: string, first: string, last: string, extra: Partial<MiembroViaje> = {}): MiembroViaje {
  return { id, first_name: first, last_name: last, username: null, eliminada: false, es_yo: false, balance_cents: 0, falta_elegir: 0, ...extra };
}

const MIEMBROS: MiembroViaje[] = [
  miembro(IDS.yo, 'Ana', 'López', { es_yo: true, balance_cents: -54200, username: 'ana.lopez' }),
  miembro(IDS.luis, 'Luis', 'Pérez', { balance_cents: 181900, username: 'luis.perez' }),
  miembro(IDS.sofia, 'Sofía', 'Ramírez', { balance_cents: -23000, username: 'sofia.ramirez' }),
  miembro(IDS.diego, 'Diego', 'Torres', { balance_cents: -104700, falta_elegir: 1, username: 'diego.torres' }),
];

function ticket(extra: Partial<TicketEnViaje>): TicketEnViaje {
  return {
    id: 'tk-1', lugar: 'Mariscos El Faro', tipo_lugar: 'restaurante', fecha_ticket: '2026-10-08', hora_ticket: '21:40',
    cargado_en: '2026-10-09T03:40:00.000Z', forma: 'consumo', pagado_por: IDS.luis, pagaste_tu: false,
    te_toca_cents: 53000, falta_que_elija: 1, sin_repartir_cents: 56500, ...extra,
  };
}

const TICKETS: TicketEnViaje[] = [
  ticket({}),
  ticket({ id: 'tk-2', lugar: 'Café Caribe', tipo_lugar: 'cafe', fecha_ticket: '2026-10-07', pagado_por: IDS.diego, forma: 'total', te_toca_cents: 0, falta_que_elija: 0, sin_repartir_cents: 0 }),
  ticket({ id: 'tk-3', lugar: null, tipo_lugar: 'bar', fecha_ticket: '2026-10-06', pagado_por: IDS.yo, pagaste_tu: true, forma: 'iguales', te_toca_cents: 24000, falta_que_elija: 0, sin_repartir_cents: 0 }),
];

function viaje(extra: Partial<DetalleViaje> = {}): DetalleViaje {
  return {
    id: 'v-1', nombre: 'Cancún 2026', fecha_desde: '2026-10-05', fecha_hasta: '2026-10-11', estado: 'abierto',
    creado_en: '2026-10-01T15:00:00.000Z', mi_miembro_id: IDS.yo, miembros: MIEMBROS, invitados: [],
    mi_balance_cents: -54200, gasto_del_grupo_cents: 666000, tickets: TICKETS,
    sin_repartir: [{ ticket_id: 'tk-1', lugar: 'Mariscos El Faro', fecha_ticket: '2026-10-08', monto_cents: 56500, faltan: [IDS.diego] }],
    transferencias: [], transferencias_pendientes: 0, ...extra,
  };
}

function tr(id: string, de: string, a: string, cents: number, estado: TransferenciaViaje['estado'], mia: TransferenciaViaje['mia']): TransferenciaViaje {
  return { id, de, a, monto_cents: cents, estado, mia };
}

const nada = () => undefined;
const ACCIONES: Omit<ViajeVistaProps, 'carga' | 'marcando'> = {
  onReintentar: nada, onVerViajes: nada, onVerBalance: nada, onEscanear: nada, onCargaManual: nada, onAbrirTicket: nada,
  onCerrar: nada, onSalir: nada, onMarcar: nada,
};

const listo = (v: DetalleViaje): CargaDeViaje => ({ tipo: 'listo', viaje: v });

/** Lo que se lee: sin etiquetas ni los separadores que mete el SSR entre textos. */
function texto(html: string): string {
  return html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const vista = (carga: CargaDeViaje, marcando: string | null = null) =>
  renderToStaticMarkup(<ViajeVista carga={carga} marcando={marcando} {...ACCIONES} />);

describe('D245 · el viaje abierto, más simple', () => {
  const html = vista(listo(viaje()));
  const leido = texto(html);

  it('la burbuja dice sólo el nombre: sin fechas, sin avatares, sin «Tú, Luis…»', () => {
    expect(html).toMatch(/<div class="title-card"><h1 class="title-card-title">Cancún 2026<\/h1><\/div>/);
    expect(leido).not.toContain('5–11 oct');
    expect(leido).not.toContain('Tú, Luis');
  });

  it('🔴 enseguida el balance como monto: la deuda en rojo con «−», sin «Debes» a la vista', () => {
    expect(html).toContain('<p class="vjv-monto vjv-monto-deuda"><span aria-hidden="true">\u2212$542</span><span class="vj-oculto">Debes $542</span></p>');
    expect(leido.indexOf('\u2212$542')).toBeLessThan(leido.indexOf('Miembros'));
  });

  it('🔴 a favor en verde y cero en negro; el lector de pantalla oye «a favor»', () => {
    expect(vista(listo(viaje({ mi_balance_cents: 120000 }))))
      .toContain('<p class="vjv-monto vjv-monto-a-favor"><span aria-hidden="true">$1,200</span><span class="vj-oculto">A favor: $1,200</span></p>');
    expect(vista(listo(viaje({ mi_balance_cents: 0 }))))
      .toContain('<p class="vjv-monto vjv-monto-cero"><span aria-hidden="true">$0</span><span class="vj-oculto">$0</span></p>');
  });

  it('se van «Tu balance», «Gasto del grupo», «Tickets · N» y la lista de tickets', () => {
    for (const fuera of ['Tu balance', 'Gasto del grupo', 'Tickets ·', 'Todavía no hay tickets', 'Mariscos El Faro', 'Te toca', 'Estás a mano', 'Te deben']) {
      expect(leido, fuera).not.toContain(fuera);
    }
  });

  it('«Miembros» cerrado: el título y cuántos, sin la lista', () => {
    expect(html).toContain('aria-expanded="false"');
    expect(leido).toContain('Miembros 4');
    expect(leido).not.toContain('Sofía Ramírez');
  });

  it('el orden: monto, Miembros, «Escanear ticket» y «Carga manual» lado a lado, «Ver balance», cerrar y salir', () => {
    // «Debes $542» es el texto oculto para el lector de pantalla, junto al monto.
    expect(leido).toMatch(/\u2212\$542 Debes \$542 Miembros 4 Escanear ticket Carga manual Ver balance del viaje Cerrar viaje Salir del viaje$/);
    expect(html).toMatch(/<div class="vjv-acciones"><button[^>]*>.*?Escanear ticket<\/button><button[^>]*>.*?Carga manual<\/button><\/div>/);
  });
});

describe('estados sin viaje', () => {
  it('cargando: esqueleto, sin datos inventados', () => {
    const html = vista({ tipo: 'cargando' });
    expect(html).toContain('aria-busy="true"');
    expect(texto(html)).toBe('Viajes');
  });
  it('sin red: «No pudimos cargar el viaje» con «Reintentar»', () => {
    expect(texto(vista({ tipo: 'error' }))).toContain('No pudimos cargar el viaje Revisa la conexión y prueba de nuevo. Reintentar');
  });
  it('404 uniforme: «Este viaje ya no está disponible.» con «Ver tus viajes»', () => {
    expect(texto(vista({ tipo: 'no_disponible' }))).toContain('Este viaje ya no está disponible. Ver tus viajes');
  });
});

describe('1n · debo: transferencias sugeridas', () => {
  const esperando = (mia: TransferenciaViaje) => viaje({
    estado: 'esperando_pagos', sin_repartir: [], transferencias_pendientes: 3,
    transferencias: [
      mia,
      tr('t2', IDS.sofia, IDS.luis, 23000, 'pendiente', null),
      tr('t3', IDS.diego, IDS.luis, 161200, 'marcada', null),
    ],
  });

  it('título con el gasto del grupo y «Esperando pagos · faltan 3»; la mía primero, con «Ya pagué»', () => {
    const html = vista(listo(esperando(tr('t1', IDS.yo, IDS.luis, 54200, 'pendiente', 'debo'))));
    const leido = texto(html);
    expect(leido).toContain('Cancún 2026 Gasto del grupo $6,660 Esperando pagos · faltan 3');
    expect(leido).toContain('Transferencias sugeridas · 3 AL Tú le transfieres $542 a Luis Pérez Hazla desde tu banco y márcala aquí. Ya pagué');
    expect(html).toContain('<strong>$542</strong>');
    expect(leido).toContain('Sofía Ramírez le transfiere $230 a Luis Pérez Pendiente');
    // La marcada ajena sigue «Pendiente» hasta que confirma quien recibe.
    expect(leido).toContain('Diego Torres le transfiere $1,612 a Luis Pérez Pendiente');
    expect(leido).toContain('PayMe no mueve dinero. Cada uno transfiere desde su banco y lo marca aquí.');
    // En esperando pagos no se cargan tickets ni se cierra.
    expect(leido).not.toContain('Escanear ticket');
    expect(leido).not.toContain('Cerrar viaje');
  });

  it('marcada: «Esperando que Luis confirme» y «Deshacer»', () => {
    const leido = texto(vista(listo(esperando(tr('t1', IDS.yo, IDS.luis, 54200, 'marcada', 'debo')))));
    expect(leido).toContain('Tú le transfieres $542 a Luis Pérez Esperando que Luis confirme Deshacer');
    expect(leido).not.toContain('Ya pagué');
  });

  it('mientras se manda una marca, los botones quedan apagados', () => {
    const html = vista(listo(esperando(tr('t1', IDS.yo, IDS.luis, 54200, 'pendiente', 'debo'))), 't1');
    expect(html).toMatch(/<button type="button" class="btn btn-navy" disabled="">Ya pagué<\/button>/);
  });

  it('anulada por una baja: lo dice con palabras', () => {
    const v = viaje({ estado: 'esperando_pagos', sin_repartir: [], transferencias_pendientes: 1, transferencias: [
      tr('t1', IDS.yo, IDS.luis, 54200, 'pendiente', 'debo'),
      tr('t2', IDS.sofia, 'm-baja', 100, 'anulada_por_baja', null),
    ] });
    expect(texto(vista(listo(v)))).toContain('Sofía Ramírez le transfiere $1 a Cuenta eliminada Anulada: una de las cuentas se dio de baja.');
  });
});

describe('1o · me deben', () => {
  const v = viaje({
    estado: 'esperando_pagos', mi_miembro_id: IDS.luis, sin_repartir: [], transferencias_pendientes: 3,
    miembros: MIEMBROS.map((m) => ({ ...m, es_yo: m.id === IDS.luis })),
    transferencias: [
      tr('t1', IDS.yo, IDS.luis, 54200, 'marcada', 'me_deben'),
      tr('t2', IDS.sofia, IDS.luis, 23000, 'pendiente', 'me_deben'),
      tr('t3', IDS.diego, IDS.luis, 161200, 'pagada', 'me_deben'),
    ],
  });
  const html = vista(listo(v));
  const leido = texto(html);

  it('«Te transfieren»: quien marcó trae la nota, «No me llegó» y «Recibí»', () => {
    expect(leido).toContain('Te transfieren AL Ana López @ana.lopez $542 Ana marcó que te pagó. Revisa tu banco y confírmalo. No me llegó Recibí');
    expect(leido).not.toContain('Transferencias sugeridas');
  });

  it('pendiente: «Pendiente» y un «Recibí» chico (D242-1 deja confirmar sin marca); pagada: «Pagado»', () => {
    expect(leido).toContain('Sofía Ramírez @sofia.ramirez $230 Pendiente Recibí');
    expect(leido).toContain('Diego Torres @diego.torres $1,612 Pagado');
  });

  it('la marcada va destacada sola; las demás comparten tarjeta', () => {
    expect(html.match(/vjv-tr vjv-tr-destacada/g)).toHaveLength(1);
    expect(html.match(/vjv-tr-grupo/g)).toHaveLength(1);
  });
});

describe('1p · lo mío ya está', () => {
  const v = viaje({
    estado: 'esperando_pagos', sin_repartir: [], transferencias_pendientes: 2,
    transferencias: [
      tr('t1', IDS.yo, IDS.luis, 54200, 'pagada', 'debo'),
      tr('t2', IDS.sofia, IDS.luis, 23000, 'pendiente', null),
      tr('t3', IDS.diego, IDS.luis, 161200, 'marcada', null),
    ],
  });
  const html = vista(listo(v));
  const leido = texto(html);

  it('«Faltan 2 de 3 transferencias» con la barra partida y sin chip repetido en el título', () => {
    expect(leido).toContain('Cancún 2026 Gasto del grupo $6,660 Faltan 2 de 3 transferencias');
    expect(leido).not.toContain('Esperando pagos · faltan');
    expect(html.match(/class="vjv-parte vjv-parte-llena"/g)).toHaveLength(1);
    expect(html.match(/class="vjv-parte"/g)).toHaveLength(2);
  });

  it('«Tú → Luis Pérez $542 Pagado», los demás por su nombre de pila', () => {
    expect(leido).toContain('AL Tú → Luis Pérez $542 Pagado');
    expect(leido).toContain('SR Sofía → Luis Pérez $230 Pendiente');
    expect(leido).toContain('DT Diego → Luis Pérez $1,612 Pendiente');
    expect(leido).toContain('Cuando todas estén pagadas, el viaje pasa a Cerrados. PayMe no mueve dinero.');
  });
});

describe('1m · la hoja de cierre', () => {
  const preview: VistaPreviaCierre = {
    todos_eligieron: false, tickets: 3,
    asignaciones: [{ ticket_id: 'tk-1', lugar: 'Mariscos El Faro', fecha_ticket: '2026-10-08', miembro_id: IDS.diego, monto_cents: 56500 }],
    balances: [], transferencias: [],
  };
  const hoja = (p: VistaPreviaCierre | null, fallo = false, enviando = false) => renderToStaticMarkup(
    <HojaCerrarVista viaje={viaje()} preview={p} fallo={fallo} enviando={enviando} onConfirmar={nada} onRevisar={nada} onReintentar={nada} />);

  it('el texto del diseño, con quién no eligió y a quién se le asigna', () => {
    expect(texto(hoja(preview))).toBe(
      '¿Cerrar Cancún 2026? Ya no se pueden cargar tickets. PayMe calcula lo que debe cada uno y sugiere quién le transfiere a quién. '
      + 'Diego Torres todavía no eligió en Mariscos El Faro del 8 oct. Si cierras ahora, los $565 que faltan se le asignan a Diego. '
      + 'Les avisamos a todos que cerraste el viaje. Cerrar viaje Revisar tickets');
  });

  it('todos eligieron: la frase en positivo', () => {
    expect(texto(hoja({ ...preview, todos_eligieron: true, asignaciones: [] }))).toContain('Todos eligieron lo suyo en los 3 tickets.');
  });

  it('mientras carga no se puede cerrar a ciegas; si falla, «Reintentar»', () => {
    expect(hoja(null)).toMatch(/<button type="button" class="btn btn-navy" disabled="">Cerrar viaje<\/button>/);
    expect(texto(hoja(null, true))).toContain('Revisa la conexión y prueba de nuevo. Reintentar');
  });
});

describe('salir y 1q', () => {
  it('la confirmación: «¿Salir de Cancún 2026?»', () => {
    expect(texto(renderToStaticMarkup(<HojaSalirVista nombre="Cancún 2026" enviando={false} onConfirmar={nada} onCancelar={nada} />)))
      .toBe('¿Salir de Cancún 2026? Ya no vas a ver los tickets de este viaje. Salir del viaje Cancelar');
  });

  it('1q: «Todavía no puedes salir de Cancún 2026» con el motivo del dueño', () => {
    const tickets = [ticket({ id: 'a' }), ticket({ id: 'b' }), ticket({ id: 'c' }), ticket({ id: 'd' })];
    expect(texto(renderToStaticMarkup(<HojaNoPuedeSalirVista viaje={viaje({ tickets })} motivo="selection" onEntendido={nada} />)))
      .toBe('Todavía no puedes salir de Cancún 2026 Ya elegiste consumos en 4 tickets. Podrás salir cuando se cierre el viaje '
        + 'y marques tu transferencia como pagada. Entendido');
  });
});

describe('D245 · Balance: «Consumos» y «Miembros»', () => {
  const balance = (carga: CargaDeViaje, opcion: 'consumos' | 'miembros' = 'consumos') => renderToStaticMarkup(
    <BalanceVista carga={carga} opcion={opcion} onOpcion={nada} onReintentar={nada} onVerViajes={nada} onAbrirTicket={nada} />,
  );

  it('la burbuja dice sólo «Balance»; sin la descripción ni la nota del pie', () => {
    const html = balance(listo(viaje()));
    expect(html).toMatch(/<div class="title-card"><h1 class="title-card-title">Balance<\/h1><\/div>/);
    expect(texto(html)).not.toContain('se actualiza con cada ticket');
    expect(texto(html)).not.toContain('Ves cuánto debe');
  });

  it('las dos opciones con el BubbleTabs de Inicio: «Consumos» primero y elegida', () => {
    const html = balance(listo(viaje()));
    expect(html).toContain('role="tablist"');
    expect(texto(html)).toMatch(/^Balance Consumos Miembros/);
    expect(html).toMatch(/<button type="button" role="tab" aria-selected="true" class="btab on">Consumos<\/button>/);
  });

  it('🔴 Consumos: los tickets del dueño, el más nuevo arriba, con lugar, fecha y quién pagó; nunca qué eligió nadie', () => {
    const leido = texto(balance(listo(viaje())));
    expect(leido).toContain('Mariscos El Faro 8 oct · Pagó Luis Pérez Falta que elija 1');
    expect(leido).toContain('Café Caribe 7 oct · Pagó Diego Torres');
    expect(leido).toContain('Bar 6 oct · Pagaste tú');
    expect(leido.indexOf('Mariscos')).toBeLessThan(leido.indexOf('Café Caribe'));
    expect(leido.indexOf('Café Caribe')).toBeLessThan(leido.indexOf('Bar 6 oct'));
    // Sin el «Debe / Le deben» de cada uno ni el aviso de «sin repartir» (respuesta C).
    expect(leido).not.toMatch(/Le deben|Debe \$|sin repartir/);
  });

  it('sin consumos: «Todavía no hay consumos.»', () => {
    expect(texto(balance(listo(viaje({ tickets: [], sin_repartir: [] }))))).toContain('Todavía no hay consumos.');
  });

  it('Miembros: cada uno con «Pagó» (el monto lo publica el dueño; la app no lo calcula)', () => {
    const leido = texto(balance(listo(viaje()), 'miembros'));
    expect(leido).toContain('AL Tú Pagó');
    expect(leido).toContain('LP Luis Pérez Pagó');
    expect(leido).not.toContain('Mariscos');
  });

  it('404: «Este viaje ya no está disponible.»', () => {
    expect(texto(balance({ tipo: 'no_disponible' }))).toBe('Balance Este viaje ya no está disponible. Ver tus viajes');
  });
});

describe('los textos de estas pantallas', () => {
  const fuentes = ['./ViajeScreen.tsx', './BalanceScreen.tsx', './CargaManualScreen.tsx', './viajeView.ts', '../../i18n/viajes/viaje.ts']
    .map((f) => readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n');

  it('nunca «saldo» (D242: PayMe no guarda ni mueve dinero)', () => {
    expect(fuentes).not.toMatch(/saldo/i);
  });

  it('montos de centavos enteros: nada de «.00»', () => {
    expect(texto(vista(listo(viaje())))).not.toMatch(/\.00\b/);
  });
});
