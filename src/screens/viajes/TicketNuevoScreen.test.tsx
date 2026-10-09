import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { OcrResponse } from '../../api/types';
import type { FormaTicket, MiembroViaje, TicketDelViaje, TipoLugar, YaCargado } from '../../api/viajes';
import { traducir } from '../../i18n/idioma';
import { AvisoDeEscaneoVista, DuplicadoVista, EstadoDeCargaVista, ListaDePresentes, TicketNuevoVista } from './TicketNuevoScreen';
import { candidatosDelViaje } from './ticketView';

const t = (s: string, ...a: unknown[]) => traducir(s, 'es', ...a);
const nada = () => undefined;

const miembro = (id: string, first: string, last: string, extra: Partial<MiembroViaje> = {}): MiembroViaje => ({
  id, first_name: first, last_name: last, username: `${first.toLowerCase()}.${last.toLowerCase()}`, eliminada: false,
  es_yo: false, balance_cents: 0, falta_elegir: 0, has_avatar: false, pagado_cents: 0, ...extra,
});
const MIEMBROS = [
  miembro('m-ana', 'Ana', 'López', { es_yo: true, username: 'ana.lopez' }),
  miembro('m-luis', 'Luis', 'Perez', { username: 'luis.perez' }),
  miembro('m-sofia', 'Sofia', 'Ramirez', { username: 'sofia.ramirez' }),
  miembro('m-diego', 'Diego', 'Torres', { username: 'diego.torres' }),
];
const CANDIDATOS = candidatosDelViaje(MIEMBROS, t);

const OCR: OcrResponse = {
  items: [{ name: 'Tacos', category: 'mexican', price_cents: 100000, quantity: 1 }, { name: 'Agua', category: 'mexican', price_cents: 1000, quantity: 2 }],
  total_cents: 102000,
  warnings: [],
  mock: true,
  receipt: 'or1.x.y',
  ticket_datetime: { date: '2026-10-09', time: '14:20' },
};

function nuevo(forma: FormaTicket = 'consumo', opciones: { tipo?: TipoLugar; ocr?: OcrResponse; ausentes?: Set<string> } = {}) {
  return renderToStaticMarkup(
    <TicketNuevoVista
      viajeNombre="Cancún 2026"
      ocr={opciones.ocr ?? OCR}
      tipo={opciones.tipo ?? 'restaurante'}
      forma={forma}
      candidatos={CANDIDATOS}
      ausentes={opciones.ausentes ?? new Set()}
      enviando={false}
      onTipo={nada}
      onForma={nada}
      onPresente={nada}
      onCompartir={nada}
    />,
  );
}

/** Los `role="radio"`/`checkbox` con su `aria-checked`, en orden. */
const marcas = (html: string, rol: 'radio' | 'checkbox') =>
  [...html.matchAll(new RegExp(`role="${rol}" aria-checked="(true|false)"`, 'g'))].map((m) => m[1] === 'true');

describe('AF-VIAJES · 1h · Ticket nuevo', () => {
  it('título, viaje, el lugar (sin comercio, el tipo), «9 oct · 14:20» y el total del escaneo', () => {
    const html = nuevo();
    expect(html).toContain('Ticket nuevo');
    expect(html).toContain('Cancún 2026');
    expect(html).toContain('>Restaurante<');
    expect(html).toContain('9 oct · 14:20');
    expect(html).toContain('$1,020');
    expect(html).not.toContain('$1,020.00');
    expect(html).toContain('Lo pagaste tú');
    expect(html).toContain('Como lo escaneaste primero, queda a tu nombre el pago completo.');
    expect(html).toContain('Compartir con el viaje');
  });

  it('con el comercio leído, su nombre; sin fecha leída, ninguna fecha', () => {
    const html = nuevo('consumo', { ocr: { ...OCR, merchant: { name: 'Mariscos El Faro' }, ticket_datetime: undefined } });
    expect(html).toContain('Mariscos El Faro');
    expect(html).not.toContain('9 oct');
  });

  it('«Tipo de lugar»: cinco chips, Restaurante elegido, con su semántica de radio', () => {
    const html = nuevo();
    expect(html).toContain('Tipo de lugar');
    for (const x of ['Restaurante', 'Bar', 'Café', 'Súper', 'Otro']) expect(html).toContain(`>${x}</button>`);
    expect(html).toContain('role="radiogroup" aria-labelledby="vjt-tipo-lugar"');
    // Cinco chips + tres formas.
    expect(marcas(html, 'radio')).toEqual([true, false, false, false, false, true, false, false]);
    const bar = nuevo('consumo', { tipo: 'bar' });
    expect(marcas(bar, 'radio').slice(0, 5)).toEqual([false, true, false, false, false]);
  });

  it('«¿Cómo lo dividen?»: las tres formas con su bajada; la elegida marcada', () => {
    const html = nuevo('total');
    for (const s of ['¿Cómo lo dividen?', 'Por lo que pidió cada uno', 'Cada uno elige lo suyo', 'En partes iguales',
      'Entre los que estuvieron', 'Pagar el total', 'Invitas tú, nadie te debe']) expect(html).toContain(s);
    expect(marcas(html, 'radio').slice(5)).toEqual([false, false, true]);
  });

  it('🔴 «¿Quiénes estuvieron?» sólo con «En partes iguales»: todos marcados, «Tú» primero con su @', () => {
    expect(nuevo('consumo')).not.toContain('¿Quiénes estuvieron?');
    expect(nuevo('total')).not.toContain('¿Quiénes estuvieron?');
    const html = nuevo('iguales');
    expect(html).toContain('¿Quiénes estuvieron?');
    expect(html).toContain('Se divide entre los marcados. Desmarca a quien no estuvo.');
    expect(marcas(html, 'checkbox')).toEqual([true, true, true, true]);
    expect(html.indexOf('>Tú<')).toBeLessThan(html.indexOf('Luis Perez'));
    expect(html).toContain('@ana.lopez');
    expect(html).toContain('@diego.torres');
  });

  it('desmarcado Diego: su casilla dice «no»', () => {
    const html = nuevo('iguales', { ausentes: new Set(['m-diego']) });
    expect(marcas(html, 'checkbox')).toEqual([true, true, true, false]);
  });
});

describe('AF-VIAJES · «¿Quiénes estuvieron?» · el último no se desmarca', () => {
  it('con uno solo marcado, su fila queda `aria-disabled`', () => {
    const html = renderToStaticMarkup(
      <ListaDePresentes candidatos={CANDIDATOS} ausentes={new Set(['m-luis', 'm-sofia', 'm-diego'])} onAlternar={nada} />,
    );
    expect(marcas(html, 'checkbox')).toEqual([true, false, false, false]);
    expect((html.match(/aria-disabled="true"/g) ?? []).length).toBe(1);
  });
});

describe('AF-VIAJES · 1k · el ticket ya estaba en el viaje', () => {
  const instante = new Date(2026, 9, 8, 21, 40).toISOString();
  const dup: YaCargado = { por: 'm-luis', first_name: 'Luis', last_name: 'Perez', username: 'luis.perez', eliminada: false, en: instante };
  const tk = {
    id: 'tk', lugar: null, tipo_lugar: 'restaurante', fecha_ticket: '2026-10-08', hora_ticket: '21:40', cargado_en: instante,
    forma: 'consumo', monto_cents: 220000, pagado_por: 'm-luis', pagaste_tu: false, items: [], personas: [],
    te_toca_cents: 0, sin_repartir_cents: 0, puedo_elegir: true, puedo_marcar_presentes: false,
  } satisfies TicketDelViaje;

  const render = (d: YaCargado, ticket: TicketDelViaje | null = tk) => renderToStaticMarkup(
    <DuplicadoVista viajeNombre="Cancún 2026" miMiembroId="m-ana" miembros={MIEMBROS} dup={d} ticket={ticket}
      onElegir={nada} onEscanearOtro={nada} />,
  );

  it('quién lo cargó, cuándo (hora del teléfono), el resumen y los dos botones', () => {
    const html = render(dup);
    expect(html).toContain('Escanear ticket');
    expect(html).toContain('Este ticket ya está en el viaje');
    expect(html).toContain('Luis Perez lo cargó el 8 oct a las 21:40 y quedó como quien lo pagó. No se carga dos veces.');
    expect(html).toContain('8 oct · Pagó Luis Perez');
    expect(html).toContain('$2,200');
    expect(html).toContain('Elegir lo que consumí');
    expect(html).toContain('Escanear otro ticket');
  });

  it('si quien lo cargó soy yo, la variante en primera persona', () => {
    const html = render({ ...dup, por: 'm-ana', first_name: 'Ana', last_name: 'López' });
    expect(html).toContain('Ya cargaste este ticket el 8 oct a las 21:40. No se carga dos veces.');
    expect(html).not.toContain('Ana López lo cargó');
  });

  it('sin el resumen todavía, igual ofrece elegir', () => {
    const html = render(dup, null);
    expect(html).not.toContain('$2,200');
    expect(html).toContain('Elegir lo que consumí');
  });
});

describe('AF-VIAJES · Ticket nuevo · lo que no deja cargarlo', () => {
  const aviso = (a: 'sin_escaneo' | 'recibo_usado' | 'recibo_invalido' | 'cerrado') => renderToStaticMarkup(
    <AvisoDeEscaneoVista viajeNombre="Cancún 2026" aviso={a} onEscanear={nada} onVolver={nada} />,
  );

  it('sin escaneo: «Escanear ticket» y «Volver al viaje»', () => {
    const html = aviso('sin_escaneo');
    expect(html).toContain('No encontramos el ticket escaneado.');
    expect(html).toContain('>Escanear ticket</button>');
    expect(html).toContain('Volver al viaje');
  });

  it('recibo usado en otro viaje e inválido: «Escanear otro ticket»', () => {
    expect(aviso('recibo_usado')).toContain('Este ticket ya se cargó en otro viaje.');
    expect(aviso('recibo_invalido')).toContain('No pudimos validar el ticket. Escanéalo de nuevo.');
    expect(aviso('recibo_usado')).toContain('Escanear otro ticket');
  });

  it('viaje cerrado: sólo volver', () => {
    const html = aviso('cerrado');
    expect(html).toContain('Este viaje ya se cerró.');
    expect(html).not.toMatch(/>Escanear (otro )?ticket<\/button>/);
    expect(html).toContain('>Volver al viaje</button>');
  });

  it('el 404 y la falla de red', () => {
    const no = renderToStaticMarkup(<EstadoDeCargaVista estado="no_disponible" viajeNombre={null} onReintentar={nada} />);
    expect(no).toContain('Este viaje ya no está disponible.');
    expect(no).toContain('Ver tus viajes');
    const err = renderToStaticMarkup(<EstadoDeCargaVista estado="error" viajeNombre={null} onReintentar={nada} />);
    expect(err).toContain('No pudimos cargar el viaje');
    expect(err).toContain('Reintentar');
  });
});
