import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccesoGuia } from './AccesoGuia';

const estado = vi.hoisted(() => ({
  enFechasDeViaje: false as boolean | null, aperturaPendiente: false as boolean | null,
  avisoDeFotos: 'resuelto' as 'sin-saber' | 'pendiente' | 'resuelto',
}));
vi.mock('./avisoDeFotos', () => ({ useAvisoDeFotos: () => estado.avisoDeFotos }));
vi.mock('./GuiaProvider', () => ({ useGuia: () => ({ abrir: vi.fn() }) }));
vi.mock('./aperturaPendiente', () => ({ useAperturaPendiente: () => estado.aperturaPendiente }));
vi.mock('./inicioGuia', async (original) => ({
  ...(await original<typeof import('./inicioGuia')>()),
  useEnFechasDeViaje: () => estado.enFechasDeViaje,
}));

beforeEach(() => { estado.enFechasDeViaje = false; estado.aperturaPendiente = false; estado.avisoDeFotos = 'resuelto'; });

const fila = (html: string) => /<button[^>]*class="list-row guia-fila"[^>]*>/.exec(html)![0];

describe('D364 · Q9 · Más → Ayuda → «Cómo usar PayMe»', () => {
  it('con todo sabido, habilitada y sin nota (control)', () => {
    const html = renderToStaticMarkup(<AccesoGuia />);
    expect(fila(html)).not.toContain('disabled');
    expect(html).not.toContain('ayuda-nota');
  });

  it('en fechas de un viaje, deshabilitada con la línea que dice por qué', () => {
    estado.enFechasDeViaje = true;
    const html = renderToStaticMarkup(<AccesoGuia />);
    expect(fila(html)).toContain('disabled');
    expect(html).toContain('>Disponible fuera de las fechas de un viaje<');
  });

  it('revisión de V, punto 3 · mientras no se sabe si hoy cae en un viaje: deshabilitada, pero con su línea', () => {
    for (const cambio of [{ enFechasDeViaje: null }, { enFechasDeViaje: null, aperturaPendiente: null }] as const) {
      Object.assign(estado, { enFechasDeViaje: false, aperturaPendiente: false }, cambio);
      const html = renderToStaticMarkup(<AccesoGuia />);
      expect(fila(html), JSON.stringify(cambio)).toContain('disabled');
      const id = /aria-describedby="([^"]+)"/.exec(fila(html))?.[1];
      expect(id, JSON.stringify(cambio)).toBeTruthy();
      expect(html).toContain(`<p id="${id}" class="ayuda-nota">Disponible cuando sepamos si hoy estás de viaje</p>`);
    }
  });

  it('enmienda 10 · con el aviso «Tu foto entre amigos» pendiente, deshabilitada con su línea; sin saber del aviso, habilitada', () => {
    estado.avisoDeFotos = 'pendiente';
    const html = renderToStaticMarkup(<AccesoGuia />);
    expect(fila(html)).toContain('disabled');
    const id = /aria-describedby="([^"]+)"/.exec(fila(html))?.[1];
    expect(html).toContain(`<p id="${id}" class="ayuda-nota">Primero responde el aviso «Tu foto entre amigos» en Inicio.</p>`);
    estado.avisoDeFotos = 'sin-saber';
    expect(fila(renderToStaticMarkup(<AccesoGuia />))).not.toContain('disabled');
  });

  it('si sólo falta la lectura local de la apertura (un instante), espera sin línea', () => {
    estado.aperturaPendiente = null;
    const html = renderToStaticMarkup(<AccesoGuia />);
    expect(fila(html)).toContain('disabled');
    expect(fila(html)).not.toContain('aria-describedby');
    expect(html).not.toContain('ayuda-nota');
  });
});
