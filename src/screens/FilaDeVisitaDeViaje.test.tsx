import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { VisitaDeViaje } from '../api/viajesVisitas';
import { FilaDeVisitaDeViaje } from './FilaDeVisitaDeViaje';

/**
 * 🔴 D293 · el renglón de un restaurante de viaje en Mesas: el lugar y su tipo como un renglón de mesa, la marca del viaje
 * (su foto o su inicial sobre su color) con su nombre, la fecha del instante y lo que me toca con el texto del ticket.
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
  renderToStaticMarkup(<FilaDeVisitaDeViaje visita={v} foto={foto} zona="America/Mexico_City" />);
const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('🔴 D293 · el renglón del viaje', () => {
  it('el lugar, la fecha del instante en la zona elegida y el tipo; la marca con el nombre del viaje; «Te toca» y el monto', () => {
    const html = fila(visita());
    // 03:40 UTC del 9 es el 8 a la noche en México.
    expect(texto(html)).toBe('Mariscos El Faro 8 oct · Restaurante H Holbox Te toca $530');
    expect(html).toContain('class="hist-item vj-visita"');
    expect(html).toContain('<div class="hist-rest">Mariscos El Faro</div>');
    expect(html).toMatch(/<span class="vj-visita-rotulo">Te toca<\/span><span class="hist-amt">\$530<\/span>/);
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

  it('el ícono del tipo de lugar: restaurante, bar y café', () => {
    const icono = (tipo: VisitaDeViaje['tipo_lugar']) =>
      fila(visita({ tipo_lugar: tipo })).match(/<span aria-hidden="true">(<svg[\s\S]*?<\/svg>)<\/span>/)![1];
    const iconos = new Set([icono('restaurante'), icono('bar'), icono('cafe')]);
    expect(iconos.size).toBe(3);
    expect(texto(fila(visita({ tipo_lugar: 'bar' })))).toContain('8 oct · Bar');
    expect(texto(fila(visita({ tipo_lugar: 'cafe' })))).toContain('8 oct · Café');
  });

  it('sin el nombre del lugar, el tipo es el título y no se repite en la fecha', () => {
    expect(texto(fila(visita({ lugar: null, tipo_lugar: 'bar' })))).toBe('Bar 8 oct H Holbox Te toca $530');
  });

  it('🔴 es un botón que lleva al ticket dentro del viaje, sin el gesto de «Eliminar» (el dueño no oculta tickets)', () => {
    const html = fila(visita());
    expect(html).toMatch(/^<div class="hist-item vj-visita"><button type="button" class="hist-row">/);
    expect(html).not.toContain('Eliminar');
    const fuente = readFileSync(new URL('./FilaDeVisitaDeViaje.tsx', import.meta.url), 'utf8');
    expect(fuente).toContain("onClick={() => navigate('viaje-ticket', parametroDeTicket(visita.viaje.id, visita.ticket_id))}");
    expect(fuente).not.toContain('FilaDeslizable');
  });
});
