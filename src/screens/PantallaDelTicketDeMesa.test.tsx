import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TuMesa } from '../api/misMesas';
import { estadoDeMiniatura } from '../api/fotosDeTickets';
import { EN } from '../i18n/en';
import {
  BotonDeMiniatura,
  CLAVE_YA_HIZO_ZOOM,
  FilaDeLaFotoDelTicket,
  FilaDeTicket,
  MiniaturaDelTicket,
  PISTA_DE_ZOOM_MS,
  recordarQueHizoZoom,
  yaHizoZoom,
} from '../components/VisorDelTicket';
import {
  filasDeLoQueElegiste,
  montoDeTuMesa,
  PantallaDelTicketDeMesa,
  textoSinFilas,
} from './PantallaDelTicketDeMesa';
import { filasElegidasDelViaje, vistaElegidaDelViajeCerrado } from './viajes/TicketScreen';
import type { TicketDelViaje } from '../api/viajes';

/**
 * D481 · el paquete de Claude Design de la foto del ticket (D479; Mati aceptó las
 * ocho recomendaciones): la pantalla del ticket de una mesa (3b), la fila de la
 * lista (2a, 2d), las piezas del visor que se pueden mirar sin navegador y la
 * preferencia «ya hizo zoom» (P5). El visor en el navegador (franja, píldora,
 * vencida, carga, error, «Ver consumos» encima y el teclado) lo prueba
 * `e2e/foto-del-ticket-d481.spec.ts`.
 */

const t = (s: string, ...a: unknown[]) => s.replace(/\{(\d+)\}/g, (_, i: string) => String(a[Number(i)]));
const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const mesa = (extra: Partial<TuMesa> = {}): TuMesa => ({
  id: 'm-1', code: 'PA-7310', restaurante: 'Tacos El Güero', categoria: 'mexican', status: 'expired',
  divisionMode: 'consumo', guaranteeMode: false, closureReason: 'all_items_selected', createdAt: '2026-10-11T18:00:00.000Z',
  itemsCount: 3, amountCents: 45000,
  items: [
    { itemId: 'i1', quantity: 2, name: 'Tacos al pastor', fractionBps: 10000, amountCents: 20000 },
    { itemId: 'i2', quantity: 1, name: 'Agua de jamaica', fractionBps: 10000, amountCents: 15000 },
    { itemId: 'i3', quantity: 1, name: 'Quesadilla', fractionBps: 5000, amountCents: 10000 },
  ],
  eleccionInformativa: false,
  ...extra,
});

const pantalla = (m: TuMesa, foto: { url: string | null; estado: 'lista' | 'cargando' | 'error' | 'sin_foto' } | null = null) =>
  renderToStaticMarkup(
    <PantallaDelTicketDeMesa
      mesa={m}
      zona="America/Mexico_City"
      unread={0}
      onBell={() => undefined}
      onVolver={() => undefined}
      foto={foto}
      onVerFoto={() => undefined}
      onVerDetalle={() => undefined}
    />,
  );

describe('D481 · 3b · «Lo que elegiste» de una mesa cerrada', () => {
  it('por consumo: la cantidad y la porción antes del nombre, de sólo lectura y sin píldora', () => {
    expect(filasDeLoQueElegiste(mesa())).toEqual([
      { clave: 'i1', cantidad: '2 ×', porcion: null, nombre: 'Tacos al pastor', montoCents: 20000 },
      { clave: 'i2', cantidad: null, porcion: null, nombre: 'Agua de jamaica', montoCents: 15000 },
      { clave: 'i3', cantidad: null, porcion: '½', nombre: 'Quesadilla', montoCents: 10000 },
    ]);
    const html = pantalla(mesa());
    expect(texto(html)).toContain('Lo que elegiste 2 × Tacos al pastor $200 Agua de jamaica $150 ½ Quesadilla $100');
    expect(html).not.toContain('qc-pildora');
    expect(html).not.toContain('<button type="button" class="qc');
  });

  it('en partes iguales, sin filas: el texto de siempre', () => {
    const m = mesa({ divisionMode: 'igual', items: [], itemsCount: 1, amountCents: 18000 });
    expect(filasDeLoQueElegiste(m)).toBeNull();
    expect(textoSinFilas(m, t)).toBe('Elegiste 1 parte · $180');
    expect(texto(pantalla(m))).toContain('Lo que elegiste Elegiste 1 parte · $180');
  });

  it('sin ítems elegidos: «No elegiste ítems» y, en el pie, «—» (D481 · 2), nunca «$0»', () => {
    const m = mesa({ items: [], itemsCount: 0, amountCents: 0 });
    expect(filasDeLoQueElegiste(m)).toBeNull();
    expect(textoSinFilas(m, t)).toBe('No elegiste ítems');
    expect(montoDeTuMesa(m)).toBeNull();
    const html = pantalla(m);
    expect(html).toContain('pantalla-ticket-pie-monto--sin');
    expect(html).not.toContain('$0');
  });

  it('con el conteo en null (el dueño no lo mandó): ni filas ni texto, y «—» en el pie', () => {
    const m = mesa({ items: null, itemsCount: null, amountCents: null });
    expect(filasDeLoQueElegiste(m)).toBeNull();
    expect(textoSinFilas(m, t)).toBeNull();
    expect(montoDeTuMesa(m)).toBeNull();
    expect(pantalla(m)).toContain('<section class="pantalla-ticket-eleccion"');
  });

  it('el pie: «Elegiste» y el monto (sin el total del ticket) y «Ver detalle digital» (D481 · 1); sin «Quién eligió» (D481 · 6)', () => {
    const html = pantalla(mesa());
    expect(texto(html)).toMatch(/Elegiste \$450 Ver detalle digital$/);
    expect(html).not.toContain('Total del ticket');
    expect(html).not.toContain('Quién eligió');
    expect(html).not.toContain('Ver ticket completo');
    expect(EN['Ver detalle digital']).toBe('See digital details');
    expect(EN['Elegiste']).toBe('You chose');
  });

  it('el título y su subtítulo «fecha · estado»; sin la capacidad, sin la fila de la foto', () => {
    const html = pantalla(mesa());
    expect(html).toContain('<h1 class="title-card-title">Tacos El Güero</h1>');
    expect(html).toMatch(/<div class="title-card-sub">[^<]+ · Cerró sin cobro<\/div>/);
    expect(html).not.toContain('fila-de-la-foto');
  });

  it('con la foto: la fila dentro de la tarjeta de título, con la miniatura y «Ver la foto del ticket»', () => {
    const html = pantalla(mesa(), { url: 'blob:t', estado: 'lista' });
    expect(html).toContain('<div class="pantalla-ticket-foto"><button type="button" class="fila-de-la-foto" aria-haspopup="dialog">');
    expect(html).toContain('<img src="blob:t" alt="" draggable="false"/>');
    expect(texto(html)).toContain('Ver la foto del ticket');
  });
});

describe('D481 · 2 · el monto de la fila', () => {
  it('lo que eligió la cuenta; sin consumos o sin monto, `null` («—» en gris)', () => {
    expect(montoDeTuMesa(mesa())).toBe('$450');
    expect(montoDeTuMesa(mesa({ itemsCount: 0, amountCents: 0 }))).toBeNull();
    expect(montoDeTuMesa(mesa({ amountCents: null }))).toBeNull();
  });
});

describe('D481 · 2a · 2d · la fila y la miniatura', () => {
  it('🔴 con foto y sin foto, la misma anatomía: la columna de 44, el nombre, el monto y la flecha a la derecha', () => {
    const sin = renderToStaticMarkup(<FilaDeTicket icono="dining" nombre="La Parolaccia" monto="$224.25" onAbrir={() => undefined} />);
    const con = renderToStaticMarkup(
      <FilaDeTicket
        icono="dining"
        nombre="Café Tacuba"
        monto="$180"
        onAbrir={() => undefined}
        miniatura={<BotonDeMiniatura nombre="Café Tacuba" url="blob:x" estado="lista" icono="coffee" onAbrir={() => undefined} />}
      />,
    );
    for (const html of [sin, con]) {
      expect(html).toMatch(/^<div class="fila-ticket-cuerpo"><button type="button" class="fila-ticket"><span class="fila-ticket-columna" aria-hidden="true">/);
      expect(html).toContain('class="fila-ticket-monto"');
      expect(html).not.toContain('aria-expanded');
    }
    expect(sin).toMatch(/<span class="fila-ticket-columna" aria-hidden="true"><svg/);
    expect(con).toContain('<span class="fila-ticket-columna" aria-hidden="true"></span>');
    // La miniatura es un botón HERMANO de la fila, no uno adentro del otro.
    expect(con).toMatch(/<\/button><button type="button" class="fila-ticket-foto"/);
  });

  it('sin monto, «—» en gris y un texto para el lector', () => {
    const html = renderToStaticMarkup(<FilaDeTicket icono="dining" nombre="X" monto={null} onAbrir={() => undefined} />);
    expect(html).toContain('<span class="fila-ticket-monto fila-ticket-monto--sin" aria-hidden="true">—</span>');
    expect(html).toContain('<span class="visor-ticket-oculto">Sin consumos elegidos</span>');
    expect(EN['Sin consumos elegidos']).toBe('No items chosen');
  });

  it('cargando: el recuadro vacío, `aria-busy` y su nombre propio; error: el ícono adentro; lista: la foto', () => {
    const cargando = renderToStaticMarkup(<BotonDeMiniatura nombre="Tacos El Güero" url={null} estado="cargando" icono="taco" onAbrir={() => undefined} />);
    expect(cargando).toBe('<button type="button" class="fila-ticket-foto" aria-haspopup="dialog" aria-busy="true" aria-label="Cargando la foto del ticket de Tacos El Güero"><span class="miniatura-ticket miniatura-ticket--cargando" aria-hidden="true"></span></button>');
    const error = renderToStaticMarkup(<BotonDeMiniatura nombre="Café Tacuba" url={null} estado="error" icono="coffee" onAbrir={() => undefined} />);
    expect(error).toContain('aria-label="Ver la foto del ticket de Café Tacuba"');
    expect(error).not.toContain('aria-busy');
    expect(error).toMatch(/<span class="miniatura-ticket" aria-hidden="true"><svg/);
    expect(renderToStaticMarkup(<MiniaturaDelTicket url="blob:y" estado="lista" icono="taco" />))
      .toBe('<span class="miniatura-ticket" aria-hidden="true"><img src="blob:y" alt="" draggable="false"/></span>');
    expect(EN['Cargando la foto del ticket de {0}']).toBe('Loading the receipt photo from {0}');
  });

  it('la fila de la foto de la pantalla del ticket, mientras carga, avisa que está ocupada', () => {
    const html = renderToStaticMarkup(<FilaDeLaFotoDelTicket url={null} estado="cargando" botonRef={{ current: null }} onAbrir={() => undefined} />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('miniatura-ticket--cargando');
  });

  it('el estado de cada miniatura de la lista: lista, sin foto (404), error o cargando', () => {
    expect(estadoDeMiniatura(true, false, false)).toBe('lista');
    expect(estadoDeMiniatura(true, true, true)).toBe('lista');
    expect(estadoDeMiniatura(false, true, false)).toBe('sin_foto');
    expect(estadoDeMiniatura(false, false, true)).toBe('error');
    expect(estadoDeMiniatura(false, false, false)).toBe('cargando');
  });
});

describe('D481 · P5 · «ya hizo zoom», en el teléfono', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('guarda un `1` y nada más; sin almacenamiento, la píldora vuelve a salir', () => {
    const valores = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => valores.get(k) ?? null,
      setItem: (k: string, v: string) => { valores.set(k, v); },
    });
    expect(yaHizoZoom()).toBe(false);
    recordarQueHizoZoom();
    expect([...valores.entries()]).toEqual([[CLAVE_YA_HIZO_ZOOM, '1']]);
    expect(yaHizoZoom()).toBe(true);
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('privado'); }, setItem: () => { throw new Error('privado'); } });
    expect(yaHizoZoom()).toBe(false);
    expect(() => recordarQueHizoZoom()).not.toThrow();
    expect(PISTA_DE_ZOOM_MS).toBe(4000);
  });

  it('🔴 el visor nunca guarda la foto ni la URL: lo único persistido es esa preferencia', () => {
    const fuente = readFileSync(new URL('../components/VisorDelTicket.tsx', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(fuente.match(/localStorage\.\w+\(/g)).toEqual(['localStorage.getItem(', 'localStorage.setItem(']);
    expect(fuente).toContain("localStorage.setItem(CLAVE_YA_HIZO_ZOOM, '1')");
    for (const prohibido of ['sessionStorage', 'indexedDB', 'caches.']) expect(fuente).not.toContain(prohibido);
  });
});

describe('D481 · 1c–1f · el visor, en la fuente', () => {
  const fuente = readFileSync(new URL('../components/VisorDelTicket.tsx', import.meta.url), 'utf8');

  it('la descripción accesible del zoom sigue aunque la píldora se vaya; la píldora es decorativa', () => {
    expect(fuente).toContain("aria-describedby={conZoom ? 'visor-ticket-ayuda' : undefined}");
    expect(fuente).toContain('<span id="visor-ticket-ayuda" className="visor-ticket-oculto">');
    expect(fuente).toContain('<div className="visor-ticket-pista" aria-hidden="true">');
  });

  it('🔴 el aviso de los 90 días va sólo con la foto vencida A LA VISTA: nunca cargando ni con error', () => {
    const vencida = fuente.indexOf("estado === 'lista' && completaVencida ? (");
    const aviso = fuente.indexOf('<p className="visor-ticket-aviso" role="note">');
    const cargando = fuente.indexOf('<div className="visor-ticket-esqueleto" role="status">');
    expect(vencida).toBeGreaterThan(0);
    expect(aviso).toBeGreaterThan(vencida);
    expect(cargando).toBeGreaterThan(aviso);
    expect(fuente.match(/visor-ticket-aviso/g)).toHaveLength(1);
  });

  it('las flechas van en la franja, no en el escenario; la que no corresponde deja su hueco', () => {
    const escenario = fuente.slice(fuente.indexOf('className="visor-ticket-escenario"'), fuente.indexOf('className="visor-ticket-franja"'));
    expect(escenario).not.toContain('visor-ticket-flecha');
    expect(fuente.match(/visor-ticket-flecha-hueco/g)).toHaveLength(2);
  });

  it('la vencida no se acerca: ni el gesto, ni el doble toque, ni el teclado', () => {
    expect(fuente).toContain("const conZoom = estado === 'lista' && !completaVencida;");
    expect(fuente).toContain("(e.key === '+' || e.key === '=') && conZoom");
    expect(fuente).toContain("e.key === '-' && conZoom");
  });
});

describe('D481 · el ticket de un viaje cerrado se ve como 3b', () => {
  const ticket = (extra: Partial<TicketDelViaje> = {}) => ({
    forma: 'consumo', personal: false,
    items: [
      { id: 'a', name: 'Ceviche', price_cents: 32000, quantity: 1, line_cents: 32000, remaining_bps: 0, my_bps: 10000, my_amount_cents: 32000 },
      { id: 'b', name: 'Tacos de pescado', price_cents: 9500, quantity: 3, line_cents: 28500, remaining_bps: 0, my_bps: 5000, my_amount_cents: 14250 },
      { id: 'c', name: 'Aguachile', price_cents: 31000, quantity: 1, line_cents: 31000, remaining_bps: 0, my_bps: 0, my_amount_cents: 0 },
    ],
    ...extra,
  }) as unknown as TicketDelViaje;

  it('sólo el ticket por consumo, con el viaje cerrado y que no es un gasto personal', () => {
    expect(vistaElegidaDelViajeCerrado(ticket(), true)).toBe(true);
    expect(vistaElegidaDelViajeCerrado(ticket(), false)).toBe(false);
    expect(vistaElegidaDelViajeCerrado(ticket({ forma: 'iguales' }), true)).toBe(false);
    expect(vistaElegidaDelViajeCerrado(ticket({ forma: 'total' }), true)).toBe(false);
    expect(vistaElegidaDelViajeCerrado(ticket({ personal: true }), true)).toBe(false);
  });

  it('las filas: lo mío, con la cantidad y la porción antes del nombre', () => {
    expect(filasElegidasDelViaje(ticket())).toEqual([
      { id: 'a', cantidad: null, porcion: null, nombre: 'Ceviche', montoCents: 32000 },
      { id: 'b', cantidad: '3 ×', porcion: '½', nombre: 'Tacos de pescado', montoCents: 14250 },
    ]);
  });
});
