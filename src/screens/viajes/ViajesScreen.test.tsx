import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ViajeEnLista } from '../../api/viajes';
import { traducir, type Idioma } from '../../i18n/idioma';
import { VistaDeViajes, type CargaDeViajes } from './ViajesScreen';

/**
 * AF-VIAJES · Abiertos (1c) y Cerrados (1r). La vista es pura: se renderiza
 * con cada carga y se mira el HTML. El recorrido entero va en el e2e.
 */

const nada = () => undefined;

function html(estado: 'abiertos' | 'cerrados', carga: CargaDeViajes, idioma: Idioma = 'es'): string {
  const t = (s: string, ...a: unknown[]) => traducir(s, idioma, ...a);
  return renderToStaticMarkup(
    <VistaDeViajes estado={estado} carga={carga} t={t} idioma={idioma} onAbrir={nada} onCrear={nada} onReintentar={nada} />,
  );
}

/** El texto visible, sin etiquetas, con los espacios colapsados. */
const texto = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();

function viaje(extra: Partial<ViajeEnLista>): ViajeEnLista {
  return {
    id: 'v', nombre: 'Viaje', fecha_desde: null, fecha_hasta: null, estado: 'abierto', personas: 2,
    mi_balance_cents: 0, transferencias_pendientes: null, consumiste_cents: null, terminado_en: null,
    color: null, has_photo: false, ...extra,
  };
}

const CANCUN = viaje({ id: 'cancun', nombre: 'Cancún 2026', fecha_desde: '2026-10-05', fecha_hasta: '2026-10-11', personas: 4, mi_balance_cents: -54200 });
const MONTERREY = viaje({
  id: 'mty', nombre: 'Monterrey fin de semana', fecha_desde: '2026-09-19', fecha_hasta: '2026-09-21', personas: 3,
  estado: 'esperando_pagos', mi_balance_cents: 105000, transferencias_pendientes: 2,
});
const TE_DEBEN = viaje({ id: 'td', nombre: 'Tulum', mi_balance_cents: 181900, personas: 1 });
const A_MANO = viaje({ id: 'am', nombre: 'Puebla', mi_balance_cents: 0 });

const cerrado = (extra: Partial<ViajeEnLista>) => viaje({ estado: 'cerrado', mi_balance_cents: null, ...extra });
const OAXACA = cerrado({ id: 'oax', nombre: 'Oaxaca puente', fecha_desde: '2026-08-14', fecha_hasta: '2026-08-17', personas: 5, consumiste_cents: 286000, terminado_en: '2026-08-20T15:00:00.000Z' });
const VALLE = cerrado({ id: 'valle', nombre: 'Valle de Bravo', fecha_desde: '2026-07-04', fecha_hasta: '2026-07-06', personas: 3, consumiste_cents: 143050, terminado_en: '2026-07-08T15:00:00.000Z' });
const VIEJO = cerrado({ id: 'viejo', nombre: 'Mérida', personas: 2, consumiste_cents: 50000, terminado_en: '2025-11-30T15:00:00.000Z' });

describe('AF-VIAJES · 1c · Viajes abiertos', () => {
  const h = html('abiertos', { estado: 'lista', viajes: [CANCUN, MONTERREY, TE_DEBEN, A_MANO] });

  it('el título y una tarjeta-botón por viaje', () => {
    expect(h).toContain('<h1 class="title-card-title">Viajes abiertos</h1>');
    expect(h.match(/<button type="button" class="vj-card vjl-fila"/g)).toHaveLength(4);
  });

  it('nombre y «{fechas} · {n} personas»', () => {
    expect(texto(h)).toContain('Cancún 2026 5–11 oct · 4 personas');
    expect(texto(h)).toContain('Monterrey fin de semana 19–21 sep · 3 personas');
  });

  it('sin fechas, sólo las personas; una sola, en singular', () => {
    expect(texto(h)).toContain('Tulum 1 persona');
  });

  it('el balance propio con su frase y su tono (D181: sin «.00»)', () => {
    expect(h).toContain('<span class="vjl-chip vjl-chip--debes">Debes $542</span>');
    expect(h).toContain('<span class="vjl-chip vjl-chip--te-deben">Te deben $1,819</span>');
    expect(h).toContain('<span class="vjl-chip vjl-chip--a-mano">Estás a mano</span>');
  });

  it('esperando pagos: «faltan {n}» y no el balance', () => {
    expect(h).toContain('<span class="vjl-chip vjl-chip--esperando">Esperando pagos · faltan 2</span>');
    expect(h).not.toContain('$1,050');
  });

  it('«Crear viaje» al pie de la lista', () => {
    expect(texto(h).endsWith('Crear viaje')).toBe(true);
    expect(h).toContain('vjl-crear');
  });

  it('nunca «saldo»', () => {
    expect(h).not.toMatch(/saldo/i);
  });

  it('EN · la traducción', () => {
    const e = html('abiertos', { estado: 'lista', viajes: [CANCUN, MONTERREY] }, 'en');
    expect(texto(e)).toContain('Open trips');
    expect(texto(e)).toContain('Cancún 2026 Oct 5–11 · 4 people You owe $542');
    expect(texto(e)).toContain('Waiting for payments · 2 left');
    expect(texto(e)).toContain('Create trip');
  });

  it('vacío: la invitación a crear uno', () => {
    const v = texto(html('abiertos', { estado: 'lista', viajes: [] }));
    expect(v).toContain('Todavía no tienes viajes');
    expect(v).toContain('Crea uno, suma a tus amigos y escaneen los tickets del viaje. PayMe va calculando quién le debe a quién.');
    expect(v).toContain('Crear viaje');
  });
});

describe('AF-VIAJES · 1r · Viajes cerrados', () => {
  const h = html('cerrados', { estado: 'lista', viajes: [OAXACA, VALLE, VIEJO] });

  it('el título, agrupados por año en el orden del dueño', () => {
    expect(h).toContain('<h1 class="title-card-title">Viajes cerrados</h1>');
    const t = texto(h);
    expect(t.indexOf('2026')).toBeLessThan(t.indexOf('Oaxaca puente'));
    expect(t.indexOf('Valle de Bravo')).toBeLessThan(t.indexOf('2025'));
    expect(t.indexOf('2025')).toBeLessThan(t.indexOf('Mérida'));
    expect(h.match(/<h2 class="vj-seccion">/g)).toHaveLength(2);
  });

  it('«Gastaste» sobre lo que consumiste tú', () => {
    expect(texto(h)).toContain('Oaxaca puente 14–17 ago · 5 personas Gastaste $2,860');
    expect(texto(h)).toContain('Valle de Bravo 4–6 jul · 3 personas Gastaste $1,430.50');
  });

  it('sin chips de balance ni «Crear viaje»', () => {
    expect(h).not.toContain('vjl-chip');
    expect(h).not.toContain('Crear viaje');
  });

  it('vacío', () => {
    expect(texto(html('cerrados', { estado: 'lista', viajes: [] }))).toContain('Todavía no tienes viajes cerrados.');
  });

  it('EN · la traducción', () => {
    const e = texto(html('cerrados', { estado: 'lista', viajes: [OAXACA] }, 'en'));
    expect(e).toContain('Closed trips');
    expect(e).toContain('You spent $2,860');
  });
});

describe('AF-VIAJES · listas · cargando y error', () => {
  it('cargando: esqueleto ocupado, sin lista', () => {
    const h = html('abiertos', { estado: 'cargando' });
    expect(h).toContain('aria-busy="true"');
    expect(h).toContain('aria-label="Cargando…"');
    expect(h).not.toContain('Crear viaje');
  });

  it('error de red: el aviso y «Reintentar»', () => {
    const t = texto(html('cerrados', { estado: 'error' }));
    expect(t).toContain('No pudimos cargar tus viajes');
    expect(t).toContain('Revisa la conexión y prueba de nuevo.');
    expect(t).toContain('Reintentar');
  });
});
