import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DetalleViaje, MiembroViaje, TicketEnViaje, TransferenciaViaje, VistaPreviaCierre } from '../../api/viajes';
import { BalanceVista, PestanasDeBalance } from './BalanceScreen';
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
  return { id, first_name: first, last_name: last, username: null, eliminada: false, es_yo: false, balance_cents: 0, falta_elegir: 0, has_avatar: false, pagado_cents: 0, ...extra };
}

const MIEMBROS: MiembroViaje[] = [
  miembro(IDS.yo, 'Ana', 'López', { es_yo: true, balance_cents: -54200, username: 'ana.lopez', pagado_cents: 96000 }),
  miembro(IDS.luis, 'Luis', 'Pérez', { balance_cents: 181900, username: 'luis.perez', pagado_cents: 404000, has_avatar: true }),
  miembro(IDS.sofia, 'Sofía', 'Ramírez', { balance_cents: -23000, username: 'sofia.ramirez', pagado_cents: 128000 }),
  miembro(IDS.diego, 'Diego', 'Torres', { balance_cents: -104700, falta_elegir: 1, username: 'diego.torres', pagado_cents: 38000 }),
];

function ticket(extra: Partial<TicketEnViaje>): TicketEnViaje {
  return {
    id: 'tk-1', lugar: 'Mariscos El Faro', tipo_lugar: 'restaurante', fecha_ticket: '2026-10-08', hora_ticket: '21:40',
    cargado_en: '2026-10-09T03:40:00.000Z', forma: 'consumo', pagado_por: IDS.luis, pagaste_tu: false,
    te_toca_cents: 53000, falta_que_elija: 1, sin_repartir_cents: 56500, monto_cents: 159000, origen: 'escaneo',
    puede_eliminar: false, ...extra,
  };
}

const TICKETS: TicketEnViaje[] = [
  ticket({}),
  ticket({ id: 'tk-2', lugar: 'Café Caribe', tipo_lugar: 'cafe', fecha_ticket: '2026-10-07', pagado_por: IDS.diego, forma: 'total', te_toca_cents: 0, falta_que_elija: 0, sin_repartir_cents: 0, monto_cents: 38000 }),
  ticket({ id: 'tk-3', lugar: null, tipo_lugar: 'bar', fecha_ticket: '2026-10-06', pagado_por: IDS.yo, pagaste_tu: true, forma: 'iguales', te_toca_cents: 24000, falta_que_elija: 0, sin_repartir_cents: 0, monto_cents: 96000, origen: 'manual' }),
];

function viaje(extra: Partial<DetalleViaje> = {}): DetalleViaje {
  return {
    id: 'v-1', nombre: 'Cancún 2026', fecha_desde: '2026-10-05', fecha_hasta: '2026-10-11', estado: 'abierto',
    creado_en: '2026-10-01T15:00:00.000Z', mi_miembro_id: IDS.yo, miembros: MIEMBROS, invitados: [],
    mi_balance_cents: -54200, gasto_del_grupo_cents: 666000, tickets: TICKETS,
    sin_repartir: [{ ticket_id: 'tk-1', lugar: 'Mariscos El Faro', fecha_ticket: '2026-10-08', monto_cents: 56500, faltan: [IDS.diego] }],
    transferencias: [], transferencias_pendientes: 0, color: null, has_photo: false, ...extra,
  };
}

function tr(id: string, de: string, a: string, cents: number, estado: TransferenciaViaje['estado'], mia: TransferenciaViaje['mia']): TransferenciaViaje {
  return { id, de, a, monto_cents: cents, estado, mia };
}

const nada = () => undefined;
const ACCIONES: Omit<ViajeVistaProps, 'carga' | 'marcando'> = {
  onReintentar: nada, onVerViajes: nada, onVerBalance: nada, onCargaManual: nada, onConfiguracion: nada, onAbrirTicket: nada,
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

  it('🔴 D255 · con color, la burbuja va en ese color (texto blanco); con foto, la foto junto al nombre', () => {
    const conColor = renderToStaticMarkup(<ViajeVista carga={listo(viaje({ color: 'rojo' }))} marcando={null} {...ACCIONES} />);
    expect(conColor).toMatch(/<div class="title-card vj-titulo-color" style="background:#B91C1C"><h1 class="title-card-title">Cancún 2026<\/h1><\/div>/);
    const conFoto = renderToStaticMarkup(
      <ViajeVista carga={listo(viaje({ color: 'azul', has_photo: true }))} marcando={null} {...ACCIONES} fotoDelViaje="blob:foto-viaje" />,
    );
    expect(conFoto).toContain('<div class="vj-titulo-fila"><span class="vj-insignia vj-insignia--grande vj-insignia--color" style="background:#1D4ED8" aria-hidden="true"><img class="vj-insignia-foto" src="blob:foto-viaje" alt=""/></span><h1 class="title-card-title">Cancún 2026</h1></div>');
    // Esperando pagos, también.
    const esperando = renderToStaticMarkup(
      <ViajeVista carga={listo(viaje({ color: 'naranja', estado: 'esperando_pagos', transferencias_pendientes: 1 }))} marcando={null} {...ACCIONES} />,
    );
    expect(esperando).toContain('<div class="title-card vj-titulo-color" style="background:#C2410C">');
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

  it('🔴 D250 · D255-7 · el orden: monto, Miembros, «Carga manual» a todo el ancho (sin «Escanear ticket»), «Ver balance», «Configuración», cerrar y salir', () => {
    // «Debes $542» es el texto oculto para el lector de pantalla, junto al monto.
    expect(leido).toMatch(/\u2212\$542 Debes \$542 Miembros 4 Carga manual Ver balance del viaje Configuración Cerrar viaje Salir del viaje$/);
    expect(html).toMatch(/<div class="vjv-acciones vjv-acciones-una"><button[^>]*>.*?Carga manual<\/button><\/div>/);
    expect(leido).not.toContain('Escanear ticket');
  });

  it('🔴 D255-7 · «Cerrar viaje» (burbuja rojo clarito) y «Salir del viaje» van juntos en el pie; el scroll lleva su aire', () => {
    expect(html).toMatch(/<div class="vjv-pie-abierto"><button type="button" class="vjv-cerrar">Cerrar viaje<\/button><button type="button" class="vjv-salir">Salir del viaje<\/button><\/div>/);
    expect(html).toContain('class="scroll vj-scroll vjv-scroll-abierto"');
    expect(html).not.toContain('btn btn-ghost');
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

  it('H02 · también acá, con lo mío ya confirmado, «Salir del viaje» al pie', () => {
    expect(leido).toMatch(/Salir del viaje$/);
  });

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
    const razon = { tipo: 'motivo', motivo: 'selection' } as const;
    expect(texto(renderToStaticMarkup(<HojaNoPuedeSalirVista viaje={viaje({ tickets })} razon={razon} onEntendido={nada} />)))
      .toBe('Todavía no puedes salir de Cancún 2026 Ya elegiste consumos en 4 tickets. Podrás salir cuando se cierre el viaje '
        + 'y tus transferencias estén confirmadas. Entendido');
  });

  it('H02 · con transferencias tuyas sin confirmar, la hoja dice cuántas', () => {
    const razon = { tipo: 'pendientes', pendientes: 2 } as const;
    expect(texto(renderToStaticMarkup(<HojaNoPuedeSalirVista viaje={viaje()} razon={razon} onEntendido={nada} />)))
      .toBe('Todavía no puedes salir de Cancún 2026 Tienes 2 transferencias sin confirmar. '
        + 'Podrás salir cuando todas estén confirmadas. Entendido');
  });

  it('🔴 H02 · «Salir del viaje» también con el viaje en esperando pagos, al pie', () => {
    const v = viaje({ estado: 'esperando_pagos', sin_repartir: [], transferencias_pendientes: 1, transferencias: [
      tr('t1', IDS.yo, IDS.luis, 54200, 'pendiente', 'debo'),
    ] });
    const leido = texto(vista(listo(v)));
    expect(leido).toMatch(/Salir del viaje$/);
  });
});

describe('D245 · Balance: «Consumos» y «Miembros»', () => {
  const balance = (carga: CargaDeViaje, opcion: 'consumos' | 'miembros' = 'consumos', fotoDe?: (id: string) => string | null) =>
    renderToStaticMarkup(
      <BalanceVista carga={carga} opcion={opcion} onReintentar={nada} onVerViajes={nada} onAbrirTicket={nada} fotoDe={fotoDe} />,
    );

  it('🔴 D255-3 · sin la burbuja «Balance»: el contenido va en la tarjeta montada, pegada a la pestaña elegida', () => {
    const html = balance(listo(viaje()));
    expect(html).not.toContain('title-card');
    expect(texto(html)).not.toMatch(/^Balance/);
    expect(html).toMatch(/^<div class="scroll"><div class="mounted-card seam-left vjb-tarjeta">/);
    expect(balance(listo(viaje()), 'miembros')).toMatch(/^<div class="scroll"><div class="mounted-card seam-right vjb-tarjeta">/);
    expect(texto(html)).not.toContain('se actualiza con cada ticket');
    expect(texto(html)).not.toContain('Ves cuánto debe');
  });

  it('🔴 D255-3 · las dos opciones son el BubbleTabs de Inicio, a medias: «Consumos» primero y elegida', () => {
    const html = renderToStaticMarkup(<PestanasDeBalance opcion="consumos" onOpcion={nada} />);
    expect(html).toMatch(/^<div class="btabs btabs-2" role="tablist">/);
    expect(texto(html)).toBe('Consumos Miembros');
    expect(html).toMatch(/<button type="button" role="tab" aria-selected="true" class="btab on">Consumos<\/button>/);
  });

  it('🔴 D255-3 · la pantalla lleva las pestañas en la cabecera con «Volver», no en el contenido', () => {
    const fuente = readFileSync(new URL('./BalanceScreen.tsx', import.meta.url), 'utf8');
    expect(fuente).toMatch(/<AppHeaderBack\s+userName=\{[^}]+\}\s+onBack=\{[^}]+\}\s+tabs=\{<PestanasDeBalance opcion=\{opcion\} onOpcion=\{setOpcion\} \/>\}/);
  });

  it('🔴 Consumos: los tickets del dueño, el más nuevo arriba, con lugar, fecha y quién pagó; nunca qué eligió nadie', () => {
    const leido = texto(balance(listo(viaje())));
    // Respuesta A: el total de cada uno (`monto_cents`), no lo que me toca.
    expect(leido).toContain('Mariscos El Faro 8 oct · Pagó Luis Pérez Falta que elija 1 $1,590');
    expect(leido).toContain('Café Caribe 7 oct · Pagó Diego Torres $380');
    expect(leido).toContain('Bar 6 oct · Pagaste tú $960');
    expect(leido).not.toContain('$530');
    expect(leido).not.toContain('$240');
    expect(leido.indexOf('Mariscos')).toBeLessThan(leido.indexOf('Café Caribe'));
    expect(leido.indexOf('Café Caribe')).toBeLessThan(leido.indexOf('Bar 6 oct'));
    // Sin el «Debe / Le deben» de cada uno ni el aviso de «sin repartir» (respuesta C).
    expect(leido).not.toMatch(/Le deben|Debe \$|sin repartir/);
  });

  it('🔴 D256 · deslizar para eliminar sólo donde el dueño dice `puede_eliminar`; las demás filas no se deslizan', () => {
    const v = viaje({ tickets: TICKETS.map((tk) => (tk.id === 'tk-3' ? { ...tk, puede_eliminar: true } : tk)) });
    const deslizar = { abierta: null, onAbrir: nada, onCerrar: nada, onEliminar: nada };
    const html = renderToStaticMarkup(
      <BalanceVista carga={listo(v)} opcion="consumos" onReintentar={nada} onVerViajes={nada} onAbrirTicket={nada} deslizar={deslizar} />,
    );
    // Una sola fila con el gesto, la del bar que pagué, y su «Eliminar» con el nombre del lugar.
    expect(html.match(/class="deslizable[ "]/g)).toHaveLength(1);
    expect(html.match(/aria-label="Eliminar [^"]*"/g)).toEqual(['aria-label="Eliminar Bar"']);
    const filas = html.split('<li>').slice(1);
    expect(filas.map((f) => f.includes('deslizable'))).toEqual([false, false, true]);
    // Abierta, la marca la pantalla (una sola a la vez).
    const abierta = renderToStaticMarkup(
      <BalanceVista carga={listo(v)} opcion="consumos" onReintentar={nada} onVerViajes={nada} onAbrirTicket={nada}
        deslizar={{ ...deslizar, abierta: 'tk-3' }} />,
    );
    expect(abierta).toContain('deslizable deslizable--abierta');
  });

  it('control · sin `puede_eliminar` en ninguno, o sin el gesto, ninguna fila se desliza', () => {
    const deslizar = { abierta: null, onAbrir: nada, onCerrar: nada, onEliminar: nada };
    const sin = renderToStaticMarkup(
      <BalanceVista carga={listo(viaje())} opcion="consumos" onReintentar={nada} onVerViajes={nada} onAbrirTicket={nada} deslizar={deslizar} />,
    );
    expect(sin).not.toContain('deslizable');
    const todos = viaje({ tickets: TICKETS.map((tk) => ({ ...tk, puede_eliminar: true })) });
    expect(balance(listo(todos))).not.toContain('deslizable');
  });

  it('sin consumos: «Todavía no hay consumos.»', () => {
    expect(texto(balance(listo(viaje({ tickets: [], sin_repartir: [] }))))).toContain('Todavía no hay consumos.');
  });

  it('Miembros: cada uno con «Pagó» y el monto del dueño (`pagado_cents`; la app no lo calcula)', () => {
    const leido = texto(balance(listo(viaje()), 'miembros'));
    expect(leido).toContain('AL Tú Pagó $960');
    expect(leido).toContain('LP Luis Pérez Pagó $4,040');
    expect(leido).toContain('SR Sofía Ramírez Pagó $1,280');
    expect(leido).toContain('DT Diego Torres Pagó $380');
    expect(leido).not.toContain('Mariscos');
    // Un `null` (de los demás, sólo en un viaje cerrado) no se inventa: «—».
    const sinDato = viaje({ miembros: MIEMBROS.map((m) => (m.es_yo ? m : { ...m, pagado_cents: null, balance_cents: null })) });
    expect(texto(balance(listo(sinDato), 'miembros'))).toContain('LP Luis Pérez Pagó —');
  });

  it('D245 · Miembros con la foto de quien la tiene; los demás, iniciales', () => {
    const fotoDe = (id: string) => (id === IDS.luis ? 'blob:foto-de-luis' : null);
    const html = balance(listo(viaje()), 'miembros', fotoDe);
    expect(html).toContain('<img class="vj-avatar-foto" src="blob:foto-de-luis" alt=""/>');
    expect(html.match(/<img /g)).toHaveLength(1);
    const leido = texto(html);
    expect(leido).toContain('Luis Pérez Pagó $4,040');
    expect(leido).not.toContain('LP Luis');
    expect(leido).toContain('AL Tú');
  });

  it('404: «Este viaje ya no está disponible.»', () => {
    expect(texto(balance({ tipo: 'no_disponible' }))).toBe('Este viaje ya no está disponible. Ver tus viajes');
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
