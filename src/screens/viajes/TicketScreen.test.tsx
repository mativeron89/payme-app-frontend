import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ItemDelTicket, MiembroViaje, PersonaDelTicket, TicketDelViaje } from '../../api/viajes';
import { TicketEstadoVista, TicketVista, type TicketVistaProps } from './TicketScreen';
import { ausentesDelTicket, seleccionGuardada } from './ticketView';

const nada = () => undefined;

const miembro = (id: string, first: string, last: string, extra: Partial<MiembroViaje> = {}): MiembroViaje => ({
  id, first_name: first, last_name: last, username: `${first.toLowerCase()}.${last.toLowerCase()}`, eliminada: false,
  es_yo: false, balance_cents: 0, falta_elegir: 0, has_avatar: false, pagado_cents: 0, ...extra,
});
const MIEMBROS = [
  miembro('m-ana', 'Ana', 'Lopez', { es_yo: true }),
  miembro('m-luis', 'Luis', 'Perez'),
  miembro('m-sofia', 'Sofia', 'Ramirez'),
  miembro('m-diego', 'Diego', 'Torres'),
];
const persona = (miembro_id: string, ya_eligio = true, presente = true): PersonaDelTicket => ({ miembro_id, ya_eligio, presente });
const item = (id: string, name: string, line: number, extra: Partial<ItemDelTicket> = {}): ItemDelTicket => ({
  id, name, price_cents: line, quantity: 1, line_cents: line, remaining_bps: 10000, my_bps: 0, my_amount_cents: 0, ...extra,
});

/** El ticket del 8 oct del diseño (1i), con lo que publica el dueño. */
const MARISCOS: TicketDelViaje = {
  id: 'tk', lugar: 'Mariscos El Faro', tipo_lugar: 'restaurante', fecha_ticket: '2026-10-08', hora_ticket: '21:40',
  cargado_en: null, forma: 'consumo', monto_cents: 220000, pagado_por: 'm-luis', pagaste_tu: false,
  items: [
    item('i1', 'Ceviche de camarón', 32000, { remaining_bps: 0 }),
    item('i2', 'Tacos de pescado (3)', 28500),
    item('i3', 'Aguachile', 31000, { remaining_bps: 0, my_bps: 10000, my_amount_cents: 31000 }),
    item('i5', 'Guacamole', 16000, { remaining_bps: 0, my_bps: 5000, my_amount_cents: 8000 }),
    item('i6', 'Margarita', 56000, { price_cents: 14000, quantity: 4, remaining_bps: 5000, my_bps: 2500, my_amount_cents: 14000 }),
  ],
  personas: [persona('m-ana'), persona('m-luis'), persona('m-sofia'), persona('m-diego', false)],
  te_toca_cents: 53000, sin_repartir_cents: 56500, puedo_elegir: true, puedo_marcar_presentes: false,
  pagadores: [{ miembro_id: 'm-luis', monto_cents: 220000 }],
};

function render(ticket: TicketDelViaje, extra: Partial<TicketVistaProps> = {}) {
  return renderToStaticMarkup(
    <TicketVista
      ticket={ticket}
      miembros={MIEMBROS}
      seleccion={seleccionGuardada(ticket.items)}
      abierto={null}
      ausentes={ausentesDelTicket(ticket.personas)}
      guardando={false}
      onTomar={nada}
      onSoltar={nada}
      onAbrir={nada}
      onPorcion={nada}
      onListo={nada}
      onPresente={nada}
      onGuardarPresentes={nada}
      {...extra}
    />,
  );
}

describe('AF-VIAJES · 1i · elegir lo que consumí', () => {
  it('título y subtítulo: lugar · fecha · quién pagó · cómo se divide', () => {
    const html = render(MARISCOS);
    expect(html).toContain('Mariscos El Faro');
    expect(html).toContain('8 oct · Pagó Luis Perez · Por lo que pidió cada uno');
  });

  it('«Quién ya eligió»: tilde para quien eligió y «Diego · falta elegir»; nunca qué eligió cada uno', () => {
    const html = render(MARISCOS);
    expect(html).toContain('Quién ya eligió');
    expect(html).toContain('Diego · falta elegir');
    expect(html).toMatch(/vjt-eligio"><svg[^]*?<\/svg>Tú</);
    expect(html).not.toContain('Luis · falta elegir');
  });

  it('🔴 la lista se ve como la de la mesa: lo mío con píldora y mi parte; libre con precio; lo de otros con candado', () => {
    const html = render(MARISCOS);
    expect(html).toContain('¿Qué consumiste?');
    expect(html).toContain('qc-lista');
    // Aguachile entero, Guacamole ½ y Margarita ¼: lo mío, con mi parte en pesos.
    expect((html.match(/qc-fila qc-mia"/g) ?? []).length).toBe(3);
    expect(html).toContain('aria-label="Cambiar la porción de Aguachile: Entero"');
    expect(html).toMatch(/Guacamole[^]*?½[^]*?\$80</);
    expect(html).toMatch(/4 ×<\/span><span class="qc-nombre qc-nombre--mio">Margarita/);
    // Tacos: libre, botón con su precio.
    expect(html).toMatch(/class="qc-fila qc-libre"[^>]*aria-label="Tacos de pescado \(3\)"/);
    // Ceviche: lo eligió otro, sin nombre de quién.
    expect(html).toMatch(/qc-fila qc-otro[^]*?Ceviche de camarón[^]*?Lo eligió otro/);
  });

  it('el pie: «Te toca» con «Total del ticket $2,200» y «Listo»', () => {
    const html = render(MARISCOS);
    expect(html).toContain('vj-pie');
    expect(html).toContain('Te toca');
    expect(html).toContain('Total del ticket $2,200');
    expect(html).toContain('$530');
    expect(html).toContain('>Listo</button>');
  });

  it('🔴 eligiendo, «Te toca» es la vista previa (½ de los tacos suma $142.50)', () => {
    const seleccion = seleccionGuardada(MARISCOS.items);
    seleccion.set('i2', 5000);
    const html = render(MARISCOS, { seleccion });
    expect(html).toContain('$672.50');
  });

  it('con la píldora abierta, el selector Entero · ½ · ⅓ · ¼ y «Soltar» en el mismo renglón', () => {
    const seleccion = seleccionGuardada(MARISCOS.items);
    seleccion.set('i2', 10000);
    const html = render(MARISCOS, { seleccion, abierto: 'i2' });
    expect(html).toContain('qc-mia--abierta');
    expect(html).toMatch(/role="radiogroup" aria-label="Porción de Tacos de pescado \(3\)"/);
    expect([...html.matchAll(/class="qc-opcion[^"]*">([^<]+)</g)].map((m) => m[1])).toEqual(['Entero', '½', '⅓', '¼']);
    expect(html).toContain('>Soltar</button>');
  });

  it('🔴 sin poder elegir: sólo se ve (sin «Listo» ni botones en la lista) y con la barra de abajo', () => {
    const html = render({ ...MARISCOS, puedo_elegir: false });
    expect(html).not.toContain('vj-pie');
    expect(html).not.toContain('>Listo<');
    expect(html).not.toContain('qc-libre');
    expect(html).not.toContain('Soltar');
    expect(html).toContain('Total del ticket');
  });
});

describe('AF-VIAJES · 1j · «Pagar el total»', () => {
  const CAFE: TicketDelViaje = {
    ...MARISCOS, lugar: 'Café Caribe', tipo_lugar: 'cafe', fecha_ticket: '2026-10-07', forma: 'total', monto_cents: 38000,
    pagado_por: 'm-diego', items: [], te_toca_cents: 0, puedo_elegir: false, pagadores: [{ miembro_id: 'm-diego', monto_cents: 38000 }],
  };

  it('invita quien pagó: su nombre de pila, el total y «Te toca» $0', () => {
    const html = render(CAFE);
    expect(html).toContain('7 oct · Pagó Diego Torres · Pagar el total');
    expect(html).toContain('Invita Diego');
    expect(html).toContain('Diego Torres pagó el total de este ticket. No te toca nada.');
    expect(html).toContain('Total del ticket');
    expect(html).toContain('$380');
    expect(html).toContain('$0');
    expect(html).not.toContain('vj-pie');
  });

  it('si lo pagué yo: «Invitas tú»', () => {
    const html = render({ ...CAFE, pagado_por: 'm-ana', pagaste_tu: true, te_toca_cents: 38000 });
    expect(html).toContain('Invitas tú');
    expect(html).toContain('Pagaste el total de este ticket. Nadie te debe nada.');
    expect(html).not.toContain('Invita Diego');
  });
});

describe('AF-VIAJES · «En partes iguales»', () => {
  const BAR: TicketDelViaje = {
    ...MARISCOS, lugar: 'Bar La Ola', tipo_lugar: 'bar', forma: 'iguales', monto_cents: 96000, pagado_por: 'm-ana',
    pagaste_tu: true, items: [], te_toca_cents: 24000, puedo_elegir: false,
    personas: [persona('m-ana'), persona('m-luis'), persona('m-sofia'), persona('m-diego', true, false)],
    pagadores: [{ miembro_id: 'm-ana', monto_cents: 96000 }],
  };

  it('entre quiénes se divide, el total y lo que te toca', () => {
    const html = render(BAR);
    expect(html).toContain('Se divide entre los que estuvieron');
    expect(html).toContain('Tú, Luis y Sofia');
    expect(html).toContain('$960');
    expect(html).toContain('$240');
    expect(html).not.toContain('¿Quiénes estuvieron?');
  });

  it('🔴 si lo pagué y el viaje sigue abierto: la lista editable y «Guardar» (apagado sin cambios)', () => {
    const html = render({ ...BAR, puedo_marcar_presentes: true });
    expect(html).toContain('¿Quiénes estuvieron?');
    expect([...html.matchAll(/role="checkbox" aria-checked="(true|false)"/g)].map((m) => m[1])).toEqual(['true', 'true', 'true', 'false']);
    expect(html).toMatch(/<button type="button" class="btn btn-navy vjt-guardar" disabled="">Guardar<\/button>/);
    const cambiado = render({ ...BAR, puedo_marcar_presentes: true }, { ausentes: new Set() });
    expect(cambiado).toMatch(/<button type="button" class="btn btn-navy vjt-guardar">Guardar<\/button>/);
  });
});

describe('🔴 D263 · al entrar a un ticket que pagaron varios', () => {
  const leer = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const tarjeta = (html: string) => (html.includes('Quiénes pagaron')
    ? leer(html.slice(html.indexOf('Quiénes pagaron'), html.indexOf('</section>', html.indexOf('Quiénes pagaron')))) : null);
  const VARIOS: TicketDelViaje = {
    ...MARISCOS, pagado_por: 'm-luis', pagaste_tu: true,
    pagadores: [{ miembro_id: 'm-luis', monto_cents: 120000 }, { miembro_id: 'm-ana', monto_cents: 70000 }, { miembro_id: null, monto_cents: 30000 }],
  };

  it('la línea de arriba dice cuántos pagaron, no «Pagaste tú» ni «Pagó Luis»', () => {
    const html = render(VARIOS);
    expect(html).toContain('8 oct · Pagaron 3 personas · Por lo que pidió cada uno');
    expect(html).not.toContain('Pagaste tú');
    expect(html).not.toContain('Pagó Luis');
  });

  it('«Quiénes pagaron»: cada uno con lo que pagó, en el orden del dueño; yo como «Tú» y una cuenta que ya no está', () => {
    expect(tarjeta(render(VARIOS))).toBe('Quiénes pagaron Luis Perez $1,200 Tú $700 Cuenta eliminada $300');
  });

  it('también en partes iguales y en «Pagar el total»', () => {
    const iguales = render({ ...VARIOS, forma: 'iguales', items: [], puedo_elegir: false });
    expect(tarjeta(iguales)).toBe('Quiénes pagaron Luis Perez $1,200 Tú $700 Cuenta eliminada $300');
    const total = render({ ...VARIOS, forma: 'total', items: [], puedo_elegir: false, te_toca_cents: 70000 });
    expect(tarjeta(total)).toBe('Quiénes pagaron Luis Perez $1,200 Tú $700 Cuenta eliminada $300');
    expect(total).toContain('Invitan quienes pagaron');
    expect(total).toContain('Cada uno pone lo que pagó. Nadie les debe nada.');
    expect(total).not.toContain('Invita Luis');
    const sinMi = render({ ...VARIOS, forma: 'total', items: [], puedo_elegir: false, pagaste_tu: false, te_toca_cents: 0,
      pagadores: [{ miembro_id: 'm-luis', monto_cents: 120000 }, { miembro_id: 'm-sofia', monto_cents: 100000 }] });
    expect(sinMi).toContain('Cada uno pone lo que pagó. No te toca nada.');
  });

  it('control · uno solo: sin la tarjeta, la línea de siempre', () => {
    const html = render(MARISCOS);
    expect(tarjeta(html)).toBeNull();
    expect(html).toContain('Pagó Luis Perez');
  });
});

describe('AF-VIAJES · el ticket · cargando, 404 y red', () => {
  it('los tres estados', () => {
    expect(renderToStaticMarkup(<TicketEstadoVista estado="cargando" onReintentar={nada} />)).toContain('aria-busy="true"');
    const no = renderToStaticMarkup(<TicketEstadoVista estado="no_disponible" onReintentar={nada} />);
    expect(no).toContain('Este viaje ya no está disponible.');
    expect(no).toContain('Ver tus viajes');
    expect(renderToStaticMarkup(<TicketEstadoVista estado="error" onReintentar={nada} />)).toContain('Reintentar');
  });
});
