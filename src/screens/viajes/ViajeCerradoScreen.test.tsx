import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MockApiError } from '../../api/mock/mockApi';
import type { ResumenDeViaje } from '../../api/viajes';
import { traducir, type Idioma } from '../../i18n/idioma';
import { VistaDelViajeCerrado, destinoDelError, type CargaDeResumen } from './ViajeCerradoScreen';

/**
 * AF-VIAJES · 1s · el detalle de un viaje cerrado. Sólo lo propio (D240-17).
 * La vista es pura: se renderiza con cada carga y se mira el HTML.
 */

const nada = () => undefined;

function html(carga: CargaDeResumen, abiertos: string[] = [], idioma: Idioma = 'es', onSalir?: () => void): string {
  const t = (s: string, ...a: unknown[]) => traducir(s, idioma, ...a);
  return renderToStaticMarkup(
    <VistaDelViajeCerrado
      carga={carga}
      t={t}
      idioma={idioma}
      abiertos={new Set(abiertos)}
      onAlternar={nada}
      onReintentar={nada}
      onVerViajes={nada}
      onSalir={onSalir}
    />,
  );
}

const texto = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();

/** Los números del diseño (1s), con D181: sin «.00». */
const OAXACA: ResumenDeViaje = {
  viaje_id: 'oax', nombre: 'Oaxaca puente', fecha_desde: '2026-08-14', fecha_hasta: '2026-08-17', personas: 5,
  consumiste_cents: 286000, pagaste_en_tickets_cents: 340000, te_transfirieron_cents: 54000, transferiste_cents: 0,
  por_tipo_de_lugar: [
    { tipo_lugar: 'restaurante', monto_cents: 172000 },
    { tipo_lugar: 'bar', monto_cents: 64000 },
    { tipo_lugar: 'super', monto_cents: 50000 },
  ],
  lugares: [
    { ticket_id: 't1', lugar: null, tipo_lugar: 'restaurante', fecha_ticket: '2026-08-14', forma: 'iguales',
      pagaste_tu: false, mi_monto_cents: 48000, asignado_al_cierre_cents: 0, items: [] },
    { ticket_id: 't2', lugar: 'Tlayudas Libres', tipo_lugar: 'restaurante', fecha_ticket: '2026-08-15', forma: 'consumo',
      pagaste_tu: true, mi_monto_cents: 61000, asignado_al_cierre_cents: 0, items: [
        { name: 'Tlayuda', fraction_bps: 10000, amount_cents: 21000 },
        { name: 'Mezcal', fraction_bps: 10000, amount_cents: 26000 },
        { name: 'Chapulines', fraction_bps: 5000, amount_cents: 14000 },
      ] },
    { ticket_id: 't3', lugar: 'Mariscos', tipo_lugar: 'bar', fecha_ticket: null, forma: 'consumo',
      pagaste_tu: false, mi_monto_cents: 56500, asignado_al_cierre_cents: 56500, items: [] },
  ],
};

describe('AF-VIAJES · 1s · qué hace la pantalla con un error', () => {
  it('409 viaje_not_closed: el viaje todavía vive en su pantalla de abierto', () => {
    expect(destinoDelError(new MockApiError(409, 'viaje_not_closed', { estado: 'abierto' }))).toBe('abrir_viaje');
  });

  it('404: «ya no está disponible» (no existe o no soy miembro, n325)', () => {
    expect(destinoDelError(new MockApiError(404, 'viaje_not_found'))).toBe('no_disponible');
  });

  it('otro 409, un 5xx o la red caída: reintentar', () => {
    expect(destinoDelError(new MockApiError(409, 'viaje_closed'))).toBe('reintentar');
    expect(destinoDelError(new MockApiError(500, 'internal'))).toBe('reintentar');
    expect(destinoDelError(new Error('Failed to fetch'))).toBe('reintentar');
  });
});

describe('AF-VIAJES · 1s · el detalle', () => {
  const h = html({ estado: 'listo', resumen: OAXACA });
  const t = texto(h);

  it('título y «{fechas} · {n} personas · Cerrado»', () => {
    expect(h).toContain('<h1 class="title-card-title">Oaxaca puente</h1>');
    expect(t).toContain('14–17 ago · 5 personas · Cerrado');
  });

  it('el resumen: consumiste, pagaste y lo que te transfirieron', () => {
    expect(t).toContain('Consumiste $2,860 Pagaste en tickets $3,400 Te transfirieron $540');
  });

  it('«Transferiste» sólo si transferiste; «Te transfirieron» sólo si te transfirieron', () => {
    expect(t).not.toContain('Transferiste');
    const otro = texto(html({ estado: 'listo', resumen: { ...OAXACA, te_transfirieron_cents: 0, transferiste_cents: 12345 } }));
    expect(otro).toContain('Transferiste $123.45');
    expect(otro).not.toContain('Te transfirieron');
  });

  it('por tipo de lugar, en plural y con su barra', () => {
    expect(t).toContain('Por tipo de lugar Restaurantes $1,720 Bares $640 Súper $500');
    expect(h).toContain('style="width:60%"');
    expect(h).toContain('style="width:22%"');
    expect(h).toContain('style="width:17%"');
  });

  it('lugares visitados: cuántos, fecha corta, «Pagaste tú» y mi monto', () => {
    expect(t).toContain('Lugares visitados · 3');
    expect(t).toContain('Restaurante 14 ago $480');
    expect(t).toContain('Tlayudas Libres 15 ago · Pagaste tú $610');
  });

  it('un renglón con platos se despliega: cerrado, los platos quedan ocultos', () => {
    expect(h).toMatch(/<button type="button" class="vjd-lugar-cabeza" aria-expanded="false" aria-controls="vjd-items-t2">/);
    expect(h).toMatch(/<ul id="vjd-items-t2" class="vjd-items" hidden="">/);
  });

  it('desplegado: cada plato con su monto y la porción cuando no es entero', () => {
    const abierto = html({ estado: 'listo', resumen: OAXACA }, ['t2']);
    expect(abierto).toContain('aria-expanded="true"');
    expect(abierto).toMatch(/<ul id="vjd-items-t2" class="vjd-items">/);
    const a = texto(abierto);
    expect(a).toContain('Tlayuda $210 Mezcal $260 Chapulines · ½ $140');
    expect(a).not.toContain('Tlayuda · ');
  });

  it('un renglón sin platos no es un botón', () => {
    expect(h).not.toContain('aria-controls="vjd-items-t1"');
    expect(h).not.toContain('vjd-items-t1');
  });

  it('lo asignado al cerrar se dice', () => {
    expect(t).toContain('Mariscos $565 Incluye $565 que se te asignó al cerrar.');
    expect(t.match(/que se te asignó/g)).toHaveLength(1);
  });

  it('sin tipos ni lugares, esas secciones no aparecen', () => {
    const vacio = texto(html({ estado: 'listo', resumen: { ...OAXACA, por_tipo_de_lugar: [], lugares: [] } }));
    expect(vacio).not.toContain('Por tipo de lugar');
    expect(vacio).not.toContain('Lugares visitados');
  });

  it('nunca «saldo»', () => {
    expect(h).not.toMatch(/saldo/i);
  });

  it('EN · la traducción', () => {
    const e = texto(html({ estado: 'listo', resumen: OAXACA }, ['t2'], 'en'));
    expect(e).toContain('Aug 14–17 · 5 people · Closed');
    expect(e).toContain('You consumed $2,860 You paid on receipts $3,400 Transferred to you $540');
    expect(e).toContain('By type of place Restaurants $1,720 Bars $640 Grocery $500');
    expect(e).toContain('Places visited · 3');
    expect(e).toContain('Aug 15 · You paid $610');
    expect(e).toContain('Includes $565 assigned to you at closing.');
  });
});

describe('AF-VIAJES · 1s · cargando, 404 y error', () => {
  it('cargando: esqueleto ocupado', () => {
    const h = html({ estado: 'cargando' });
    expect(h).toContain('aria-busy="true"');
    expect(h).not.toContain('Consumiste');
  });

  it('404: «Este viaje ya no está disponible.» y «Ver tus viajes»', () => {
    const t = texto(html({ estado: 'no_disponible' }));
    expect(t).toContain('Este viaje ya no está disponible.');
    expect(t).toContain('Ver tus viajes');
    expect(t).not.toContain('Reintentar');
  });

  it('error de red: el aviso y «Reintentar»', () => {
    const t = texto(html({ estado: 'error' }));
    expect(t).toContain('No pudimos cargar el viaje');
    expect(t).toContain('Reintentar');
  });
});

describe('H02 · salir de un viaje cerrado', () => {
  it('🔴 «Salir del viaje» al pie del resumen', () => {
    const leido = texto(html({ estado: 'listo', resumen: OAXACA }, [], 'es', nada));
    expect(leido).toMatch(/Salir del viaje$/);
  });

  it('sin el resumen no hay de qué salir', () => {
    expect(texto(html({ estado: 'cargando' }, [], 'es', nada))).not.toContain('Salir del viaje');
    expect(texto(html({ estado: 'no_disponible' }, [], 'es', nada))).not.toContain('Salir del viaje');
  });
});
