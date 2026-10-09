import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DetalleViaje, MiembroViaje } from '../../api/viajes';
import { CargaManualVista, montoTipeado } from './CargaManualScreen';
import { DesplegableMiembros } from './ViajeScreen';

/** D244 · D245 · la carga manual de un gasto del viaje y el desplegable «Miembros». */
function miembro(id: string, first: string, last: string, extra: Partial<MiembroViaje> = {}): MiembroViaje {
  return { id, first_name: first, last_name: last, username: null, eliminada: false, es_yo: false, balance_cents: 0, falta_elegir: 0, has_avatar: false, pagado_cents: 0, ...extra };
}
const MIEMBROS = [
  miembro('m-yo', 'Ana', 'López', { es_yo: true, username: 'ana.lopez' }),
  miembro('m-luis', 'Luis', 'Pérez', { username: 'luis.perez' }),
  miembro('m-sofia', 'Sofía', 'Ramírez'),
];
const VIAJE = {
  id: 'v-1', nombre: 'Cancún 2026', fecha_desde: null, fecha_hasta: null, estado: 'abierto', creado_en: null,
  mi_miembro_id: 'm-yo', miembros: MIEMBROS, invitados: [], mi_balance_cents: 0, gasto_del_grupo_cents: 0,
  tickets: [], sin_repartir: [], transferencias: [], transferencias_pendientes: 0,
} as const satisfies DetalleViaje;

const texto = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('el monto tipeado, en centavos enteros', () => {
  it.each([
    ['1200', 120000], ['1,200', 120000], ['$1,200.50', 120050], ['  85.5 ', 8550], ['0.01', 1],
  ])('«%s» → %i', (entrada, cents) => {
    expect(montoTipeado(entrada)).toBe(cents);
  });

  it.each(['', '0', '0.00', 'abc', '12.345', '1.2.3', '-5', '99999999'])('«%s» no es un monto', (entrada) => {
    expect(montoTipeado(entrada)).toBeNull();
  });

  it('el tope del dueño para un gasto a mano: $1,000,000 sí, un centavo más no', () => {
    expect(montoTipeado('1,000,000')).toBe(100_000_000);
    expect(montoTipeado('1000000.01')).toBeNull();
  });
});

describe('D244 · la pantalla de la carga manual', () => {
  const html = renderToStaticMarkup(<CargaManualVista viaje={VIAJE} />);
  const leido = texto(html);

  it('la burbuja dice sólo «Carga manual» (respuesta D)', () => {
    expect(html).toMatch(/<div class="title-card"><h1 class="title-card-title">Carga manual<\/h1><\/div>/);
    expect(leido).not.toContain('Cancún 2026');
  });

  it('tres datos: descripción, monto y entre quiénes; quien carga pagó', () => {
    expect(leido).toContain('Descripción');
    expect(html).toContain('placeholder="Por ejemplo: gasolina"');
    expect(leido).toContain('Monto');
    expect(leido).toContain('Lo pagaste tú');
    expect(leido).toContain('¿Entre quiénes? Se divide entre los marcados. Desmarca a quien no va.');
  });

  it('todos marcados al empezar, «Tú» primero', () => {
    expect(html.match(/aria-checked="true"/g)).toHaveLength(3);
    expect(leido.indexOf('Tú')).toBeLessThan(leido.indexOf('Luis Pérez'));
  });

  it('«Listo» apagado hasta tener descripción y monto', () => {
    expect(html).toMatch(/<button type="button" class="btn btn-navy" disabled="">Listo<\/button>/);
  });
});

describe('D245-4 · el desplegable «Miembros»', () => {
  it('abierto: cada persona con sus iniciales, su nombre y su @', () => {
    const leido = texto(renderToStaticMarkup(<DesplegableMiembros miembros={MIEMBROS} abiertoInicial />));
    expect(leido).toBe('Miembros 3 AL Tú @ana.lopez LP Luis Pérez @luis.perez SR Sofía Ramírez');
  });

  it('cerrado: sólo el título y cuántos', () => {
    const html = renderToStaticMarkup(<DesplegableMiembros miembros={MIEMBROS} />);
    expect(html).toContain('aria-expanded="false"');
    expect(texto(html)).toBe('Miembros 3');
  });

  it('D245 · con la foto de quien la tiene, en lugar de sus iniciales', () => {
    const fotoDe = (id: string) => (id === MIEMBROS[1]!.id ? 'blob:foto-de-luis' : null);
    const html = renderToStaticMarkup(<DesplegableMiembros miembros={MIEMBROS} abiertoInicial fotoDe={fotoDe} />);
    expect(html).toContain('<img class="vj-avatar-foto" src="blob:foto-de-luis" alt=""/>');
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(texto(html)).toBe('Miembros 3 AL Tú @ana.lopez Luis Pérez @luis.perez SR Sofía Ramírez');
  });
});
