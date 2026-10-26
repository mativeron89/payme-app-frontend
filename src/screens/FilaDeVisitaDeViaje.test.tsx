import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { VisitaDeViaje } from '../api/viajesVisitas';
import { FilaDeVisitaDeViaje } from './FilaDeVisitaDeViaje';

/**
 * 🔴 D293 · el renglón de un restaurante de viaje en Mesas: la marca del viaje (su foto o su inicial sobre su color) con su
 * nombre y lo que me toca con el texto del ticket.
 * D481 · 8 · la misma fila que una mesa: la columna de 44 (la miniatura si hay, o el ícono del tipo de lugar), el lugar
 * y, debajo, la insignia; sin la fecha, como la fila de mesa.
 */

const visita = (extra: Partial<VisitaDeViaje> = {}): VisitaDeViaje => ({
  ticket_id: 'd2000000-0000-4000-8000-000000000105',
  viaje: { id: 'd1000000-0000-4000-8000-000000000001', nombre: 'Holbox', color: 'violeta', has_photo: false },
  lugar: 'Mariscos El Faro',
  tipo_lugar: 'restaurante',
  instante: '2026-10-09T03:40:00.000Z',
  te_toca_cents: 53000,
  ...extra,
});

const fila = (v: VisitaDeViaje, foto: string | null = null) =>
  renderToStaticMarkup(<FilaDeVisitaDeViaje visita={v} foto={foto} />);
const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('🔴 D293 · el renglón del viaje', () => {
  it('el lugar; la marca con el nombre del viaje; «Te toca» y el monto (D481 · 8: sin la fecha, como la fila de mesa)', () => {
    const html = fila(visita());
    expect(texto(html)).toBe('Mariscos El Faro H Holbox Te toca $530');
    expect(html).toContain('class="hist-item vj-visita fila-ticket-item"');
    expect(html).toContain('<span class="fila-ticket-nombre">Mariscos El Faro</span>');
    expect(html).toMatch(/<span class="fila-ticket-rotulo">Te toca<\/span><span class="fila-ticket-monto">\$530<\/span>/);
  });

  it('🔴 la marca: la inicial sobre el color del viaje, cuadrada y chica (el círculo es de las personas), y oculta al lector', () => {
    const html = fila(visita());
    expect(html).toMatch(/<span class="vj-insignia vj-insignia--marca vj-insignia--color" style="background:#6D28D9" aria-hidden="true">H<\/span><span class="vj-visita-viaje-nombre">Holbox<\/span>/);
    // Sin color, el de la app (sin estilo propio).
    expect(fila(visita({ viaje: { id: 'v', nombre: 'Oaxaca', color: null, has_photo: false } })))
      .toContain('<span class="vj-insignia vj-insignia--marca" aria-hidden="true">O</span>');
  });

  it('con foto, la foto en la marca (sin la inicial)', () => {
    const html = fila(visita({ viaje: { id: 'v', nombre: 'Holbox', color: 'azul', has_photo: true } }), 'blob:foto-holbox');
    expect(html).toMatch(/<span class="vj-insignia vj-insignia--marca vj-insignia--color"[^>]*><img class="vj-insignia-foto" src="blob:foto-holbox" alt=""\/><\/span>/);
  });

  it('el ícono del tipo de lugar en la columna de 44: restaurante, bar y café', () => {
    const icono = (tipo: VisitaDeViaje['tipo_lugar']) =>
      fila(visita({ tipo_lugar: tipo })).match(/<span class="fila-ticket-columna" aria-hidden="true">(<svg[\s\S]*?<\/svg>)<\/span>/)![1];
    const iconos = new Set([icono('restaurante'), icono('bar'), icono('cafe')]);
    expect(iconos.size).toBe(3);
  });

  it('sin el nombre del lugar, el tipo es el título', () => {
    expect(texto(fila(visita({ lugar: null, tipo_lugar: 'bar' })))).toBe('Bar H Holbox Te toca $530');
  });

  it('D481 · 8 · con foto, la miniatura es otro botón sobre la columna (con su nombre), y la columna queda sin ícono', () => {
    const html = renderToStaticMarkup(
      <FilaDeVisitaDeViaje visita={visita()} foto={null} miniatura={{ url: 'blob:ticket', estado: 'lista' }} onVerFoto={() => undefined} />,
    );
    expect(html).toContain('<span class="fila-ticket-columna" aria-hidden="true"></span>');
    expect(html).toMatch(/<button type="button" class="fila-ticket-foto" aria-haspopup="dialog" aria-label="Ver la foto del ticket de Mariscos El Faro"><span class="miniatura-ticket" aria-hidden="true"><img src="blob:ticket" alt="" draggable="false"\/><\/span><\/button><\/div><\/div>$/);
    // Sin la capacidad (sin miniatura), ningún botón de foto.
    expect(fila(visita())).not.toContain('fila-ticket-foto');
  });

  it('🔴 es un botón que lleva al ticket dentro del viaje, sin el gesto de «Eliminar» (el dueño no oculta tickets)', () => {
    const html = fila(visita());
    expect(html).toMatch(/^<div class="hist-item vj-visita fila-ticket-item"><div class="fila-ticket-cuerpo"><button type="button" class="fila-ticket">/);
    expect(html).not.toContain('Eliminar');
    const fuente = readFileSync(new URL('./FilaDeVisitaDeViaje.tsx', import.meta.url), 'utf8');
    expect(fuente).toContain("onAbrir={() => navigate('viaje-ticket', parametroDeTicket(visita.viaje.id, visita.ticket_id))}");
    expect(fuente).not.toContain('FilaDeslizable');
  });
});
