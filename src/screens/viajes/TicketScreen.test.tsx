import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ItemDelTicket, MiembroViaje, PersonaDelTicket, TicketDelViaje } from '../../api/viajes';
import { traducir } from '../../i18n/idioma';
import { avisoDelTicket, textoYaEligio, TicketEstadoVista, TicketVista, type TicketVistaProps } from './TicketScreen';
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
  te_toca_cents: 53000, sin_repartir_cents: 56500, puedo_elegir: true, puedo_marcar_presentes: false, personal: false,
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

describe('🔴 D276 · el detalle de un ticket: quiénes estuvieron en las tres formas, el personal y el no presente', () => {
  const es = (x: string, ...a: unknown[]) => traducir(x, 'es', ...a);
  const PERSONAL = 'Es tu gasto personal: sólo lo ves tú y no suma al total del viaje.';
  const NO_ESTUVE = 'No estuviste en este ticket: no eliges nada.';
  const casillas = (html: string) => [...html.slice(html.indexOf('¿Quiénes estuvieron?')).matchAll(/role="checkbox" aria-checked="(true|false)"/g)]
    .map((m) => m[1] === 'true');

  it('🔴 D276-2 · con `puedo_marcar_presentes`, la lista editable y «Guardar» también en «consumo», con su ayuda', () => {
    const html = render({ ...MARISCOS, puedo_marcar_presentes: true });
    expect(html).toContain('¿Quiénes estuvieron?');
    expect(html).toContain('Sólo eligen los que estuvieron. Desmarca a quien no estuvo.');
    expect(casillas(html)).toEqual([true, true, true, true]);
    expect(html).toMatch(/<button type="button" class="btn btn-navy vjt-guardar" disabled="">Guardar<\/button>/);
    // Y elegir sigue ahí: estuve y puedo elegir.
    expect(html).toContain('¿Qué consumiste?');
  });

  it('🔴 D276-2 · y en «Pagar el total», sin texto de ayuda (el plan)', () => {
    const TOTAL: TicketDelViaje = { ...MARISCOS, forma: 'total', items: [], puedo_elegir: false, puedo_marcar_presentes: true,
      pagado_por: 'm-ana', pagaste_tu: true, pagadores: [{ miembro_id: 'm-ana', monto_cents: 220000 }] };
    const html = render(TOTAL);
    expect(html).toContain('¿Quiénes estuvieron?');
    expect(html).toContain('vjt-guardar');
    expect(html).not.toContain('vjt-texto--ayuda');
  });

  it('control · sin `puedo_marcar_presentes`, en «consumo» no hay lista para editar', () => {
    expect(render(MARISCOS)).not.toContain('¿Quiénes estuvieron?');
  });

  it('🔴 D276-4 · en «consumo», si no estuve: la línea y la lista se ve sin poder elegir', () => {
    const NO: TicketDelViaje = { ...MARISCOS, puedo_elegir: false,
      personas: [persona('m-ana', false, false), persona('m-luis'), persona('m-sofia'), persona('m-diego', false)] };
    const html = render(NO);
    expect(html).toContain(NO_ESTUVE);
    expect(html).toMatch(/<section class="vj-card vjt-aviso-ticket" role="note"><p class="vjt-texto">No estuviste/);
    expect(avisoDelTicket(NO, MIEMBROS, es)).toBe(NO_ESTUVE);
    // Estuve: no hay línea.
    expect(render(MARISCOS)).not.toContain(NO_ESTUVE);
    expect(avisoDelTicket(MARISCOS, MIEMBROS, es)).toBeNull();
  });

  it('🔴 D276-4 · «Quién ya eligió» lista sólo a los que estuvieron: quien no estuvo no «falta elegir»', () => {
    const SIN_DIEGO: TicketDelViaje = { ...MARISCOS,
      personas: [persona('m-ana'), persona('m-luis'), persona('m-sofia'), persona('m-diego', false, false)] };
    const html = render(SIN_DIEGO);
    expect(html).toContain('Quién ya eligió');
    expect(html).not.toContain('Diego');
    // Control: presente y sin elegir, sí.
    expect(render(MARISCOS)).toContain('Diego · falta elegir');
  });

  it('🔴 D276-3 · en un gasto personal en «consumo», no hay «Quién ya eligió», lista para elegir ni «Listo»', () => {
    const P: TicketDelViaje = { ...MARISCOS, personal: true, puedo_elegir: false, pagado_por: 'm-ana', pagaste_tu: true,
      pagadores: [{ miembro_id: 'm-ana', monto_cents: 220000 }],
      personas: [persona('m-ana', false), persona('m-luis', false, false), persona('m-sofia', false, false), persona('m-diego', false, false)] };
    const html = render(P);
    expect(html).not.toContain('Quién ya eligió');
    expect(html).not.toContain('falta elegir');
    expect(html).not.toContain('>Listo<');
    expect(html).not.toContain('¿Qué consumiste?');
    expect(html).not.toContain('qc-lista');
    // Quedan el total y lo que me toca (todo).
    expect(html).toContain('Total del ticket');
    expect(html).toContain('Te toca');
  });

  it('D276-4 · la línea del no presente es sólo de «consumo» (en iguales o total no hay nada que elegir)', () => {
    const fuera = [persona('m-ana', false, false), persona('m-luis')];
    expect(avisoDelTicket({ ...MARISCOS, forma: 'iguales', personas: fuera }, MIEMBROS, es)).toBeNull();
    expect(avisoDelTicket({ ...MARISCOS, forma: 'total', personas: fuera }, MIEMBROS, es)).toBeNull();
  });

  it('🔴 D276-3 · un gasto personal: «Es tu gasto personal…», arriba y en su color, en las tres formas', () => {
    for (const forma of ['consumo', 'iguales', 'total'] as const) {
      const P: TicketDelViaje = { ...MARISCOS, forma, personal: true, puedo_elegir: false, puedo_marcar_presentes: true,
        pagado_por: 'm-ana', pagaste_tu: true, te_toca_cents: 220000, pagadores: [{ miembro_id: 'm-ana', monto_cents: 220000 }],
        personas: [persona('m-ana'), persona('m-luis', false, false), persona('m-sofia', false, false), persona('m-diego', false, false)] };
      const html = render(P);
      expect(html, forma).toContain(PERSONAL);
      expect(html, forma).toContain('vjt-aviso-ticket vjt-personal');
      // Manda el personal: nunca dice además que no estuve.
      expect(html, forma).not.toContain(NO_ESTUVE);
      // Lo cargué yo: puedo cambiar quiénes estuvieron y compartirlo.
      expect(html, forma).toContain('¿Quiénes estuvieron?');
      expect(avisoDelTicket(P, MIEMBROS, es), forma).toBe(PERSONAL);
    }
  });

  it('D276-2 · el 409 de quien ya eligió, dicho con su nombre; si soy yo, en segunda persona; sin nombre, «Alguien»', () => {
    expect(textoYaEligio('m-luis', MIEMBROS, es)).toBe('Luis Perez ya eligió: no se puede desmarcar.');
    expect(textoYaEligio('m-ana', MIEMBROS, es)).toBe('Ya elegiste: no te puedes desmarcar.');
    expect(textoYaEligio(null, MIEMBROS, es)).toBe('Alguien ya eligió: no se puede desmarcar.');
    expect(textoYaEligio('m-otro', MIEMBROS, es)).toBe('Alguien ya eligió: no se puede desmarcar.');
  });
});
