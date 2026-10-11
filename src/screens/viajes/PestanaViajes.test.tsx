import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ViajeEnLista } from '../../api/viajes';
import { ListaDeCerradosVista, PanelViajes, inicialDelViaje, type ConteoDeViajes } from './PestanaViajes';

/** AF-VIAJES · D242 · la pestaña «Viajes» de Inicio; D266 · «Crear viaje» y «Cerrados», con los cerrados debajo. */
const nada = () => undefined;

function enLista(extra: Partial<ViajeEnLista>): ViajeEnLista {
  return {
    id: 'v-1', nombre: 'Cancún 2026', fecha_desde: '2026-10-05', fecha_hasta: '2026-10-11', estado: 'abierto', personas: 4,
    mi_balance_cents: -54200, transferencias_pendientes: null, consumiste_cents: null, terminado_en: null,
    color: null, has_photo: false, ...extra,
  };
}

const listo = (abiertos: number, cerrados: number, viajes: ViajeEnLista[] = []): ConteoDeViajes =>
  ({ estado: 'listo', counts: { abiertos, cerrados }, viajes });

const panel = (conteo: ConteoDeViajes, cerradosAbierta = false) =>
  renderToStaticMarkup(<PanelViajes conteo={conteo} cerradosAbierta={cerradosAbierta} onCerrados={nada} onReintentar={nada} />);

/** Lo que se lee de cada lanzador: su rótulo y, si tiene, su bajada. */
const lanzadores = (html: string) => [...html.matchAll(/<button type="button" class="launch vj-lanzador[^"]*"[^>]*>([\s\S]*?)<\/button>/g)]
  .map((m) => m[1]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());

describe('🔴 D266 · la pestaña Viajes: «Crear viaje» y «Cerrados»', () => {
  it('las dos burbujas, lado a lado: «Crear viaje» y «Cerrados», cada una con su ícono y su palabra', () => {
    const html = panel(listo(2, 1));
    expect(lanzadores(html)).toEqual(['Crear viaje', 'Cerrados']);
    expect(html).toContain('launch-pair');
  });

  it('🔴 D274 · «Cerrados» sin la cantidad: ni «N viajes» ni la línea de abajo, haya los que haya', () => {
    // Mati: «Quitar la cantidad de viajes cerrados, dejar únicamente Cerrados».
    for (const conteo of [listo(0, 0), listo(2, 1), listo(1, 3)]) {
      const html = panel(conteo);
      expect(lanzadores(html)).toEqual(['Crear viaje', 'Cerrados']);
      expect(html).not.toMatch(/\d+ viajes?\b/);
      expect(html).not.toContain('launch-sub');
    }
  });

  it('🔴 sin «Abiertos», ni un segundo «Crear viaje», ni el vacío con su botón; aunque no haya ningún viaje', () => {
    for (const conteo of [listo(2, 1), listo(0, 0)]) {
      const html = panel(conteo);
      expect(html).not.toContain('Abiertos');
      expect(html.match(/Crear viaje/g)).toHaveLength(1);
      expect(html).not.toContain('Todavía no tienes viajes');
      expect(html).not.toContain('btn btn-navy');
    }
    expect(lanzadores(panel(listo(0, 0)))).toEqual(['Crear viaje', 'Cerrados']);
  });

  it('🔴 «Crear viaje» es un botón común; «Cerrados» se elige con `aria-pressed` y el borde (no sólo color)', () => {
    const cerrada = panel(listo(2, 1));
    expect(cerrada).toMatch(/<button type="button" class="launch vj-lanzador "><span class="launch-ico" aria-hidden="true">.*?<\/span><span class="launch-label">Crear viaje<\/span><\/button>/);
    expect(cerrada).toMatch(/aria-pressed="false"><span class="launch-ico" aria-hidden="true">.*?<\/span><span class="launch-label">Cerrados/);
    expect(cerrada).not.toContain('aria-pressed="true"');
    const abierta = panel(listo(2, 1), true);
    expect(abierta).toMatch(/class="launch vj-lanzador vj-lanzador--elegido" aria-pressed="true"><span class="launch-ico" aria-hidden="true">.*?<\/span><span class="launch-label">Cerrados/);
    expect(abierta.match(/aria-pressed/g)).toHaveLength(1);
  });

  it('un error de red no se muestra como vacío: dice que no pudo y ofrece reintentar', () => {
    const html = panel({ estado: 'error' });
    expect(html).toContain('No pudimos cargar tus viajes');
    expect(html).toContain('Reintentar');
    expect(html).not.toContain('Crear viaje');
  });
});

describe('D246 · D266 · los cerrados, debajo de la tarjeta', () => {
  /** Lo que se lee de una fila, sin etiquetas: el texto del botón. */
  const filas = (html: string) => [...html.matchAll(/<button type="button" class="vj-inicio-fila">([\s\S]*?)<\/button>/g)]
    .map((m) => m[1]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  const cerrado = (extra: Partial<ViajeEnLista>) => enLista({ estado: 'cerrado', mi_balance_cents: null, consumiste_cents: 223000,
    terminado_en: '2026-08-20T15:00:00.000Z', ...extra });

  it('🔴 D255-6 · cada fila es sólo la inicial y el nombre, en orden, sin «Gastaste»', () => {
    const html = renderToStaticMarkup(<ListaDeCerradosVista conteo={listo(1, 2, [
      cerrado({ id: 'v-3', nombre: 'oaxaca puente' }), cerrado({ id: 'v-4', nombre: 'Valle de Bravo' }),
    ])} />);
    expect(filas(html)).toEqual(['O oaxaca puente', 'V Valle de Bravo']);
    for (const fuera of ['Gastaste', '$2,230', '4 personas']) expect(html).not.toContain(fuera);
  });

  it('🔴 D255 · la insignia con el color del viaje (texto blanco) y, si tiene, su foto en vez de la inicial', () => {
    const html = renderToStaticMarkup(<ListaDeCerradosVista conteo={listo(0, 2, [
      cerrado({ color: 'violeta', has_photo: true }),
      cerrado({ id: 'v-2', nombre: 'Monterrey', color: 'verde' }),
    ])} fotoDe={(id) => (id === 'v-1' ? 'blob:foto-cancun' : null)} />);
    expect(html).toContain('<span class="vj-insignia vj-insignia--color" style="background:#6D28D9" aria-hidden="true"><img class="vj-insignia-foto" src="blob:foto-cancun" alt=""/></span>');
    expect(html).toContain('<span class="vj-insignia vj-insignia--color" style="background:#15803D" aria-hidden="true">M</span>');
    // Sin foto (`has_photo: false`) no se pide ni se muestra, aunque hubiera una guardada.
    const sinFoto = renderToStaticMarkup(<ListaDeCerradosVista conteo={listo(0, 1, [cerrado({})])} fotoDe={() => 'blob:vieja'} />);
    expect(sinFoto).not.toContain('<img');
    expect(sinFoto).toContain('<span class="vj-insignia" aria-hidden="true">C</span>');
  });

  it('la inicial: la primera letra en mayúscula, también con acento o emoji; sin nombre, un punto', () => {
    expect(inicialDelViaje('  ébano')).toBe('É');
    expect(inicialDelViaje('🏖️ Playa')).toBe('🏖');
    expect(inicialDelViaje('   ')).toBe('·');
  });

  it('sin cerrados: «No tienes viajes cerrados»; cargando o con error, nada', () => {
    expect(renderToStaticMarkup(<ListaDeCerradosVista conteo={listo(2, 0)} />)).toContain('No tienes viajes cerrados');
    expect(renderToStaticMarkup(<ListaDeCerradosVista conteo={{ estado: 'cargando' }} />)).toBe('');
    expect(renderToStaticMarkup(<ListaDeCerradosVista conteo={{ estado: 'error' }} />)).toBe('');
  });
});

describe('Inicio · la tercera pestaña depende de la capacidad', () => {
  const home = readFileSync(new URL('../HomeScreen.tsx', import.meta.url), 'utf8');

  it('con Viajes, «Viajes» reemplaza a «Asociadas»; sin Viajes, «Asociadas» como siempre', () => {
    expect(home).toMatch(/const conViajes = useViajesHabilitado\(\);/);
    expect(home).toMatch(/const pestanas = conViajes \? TABS\.filter\(\(x\) => x\.id !== 'asociadas'\) : TABS;/);
    expect(home).toMatch(/\.\.\.\(conViajes \? \[\{ id: 'viajes', label: t\('Viajes'\) \}\] : \[\]\)/);
    expect(home).toMatch(/\{tab === 'viajes' && \(\s*<PanelViajes/);
  });

  it('🔴 D266 · la pestaña pide sólo los cerrados, y la fila aparte «Crear viaje» ya no existe', () => {
    const pestana = readFileSync(new URL('./PestanaViajes.tsx', import.meta.url), 'utf8');
    expect(pestana).toContain("new ConsultaDeViajes(() => api.getViajes('cerrados'), setConteo)");
    expect(pestana).not.toMatch(/getViajes\('abiertos'\)/);
    for (const viejo of ['FilaCrearViaje', 'vj-crear-fila', 'vj-inicio-vacio']) {
      expect(pestana, viejo).not.toContain(viejo);
      expect(home, viejo).not.toContain(viejo);
    }
  });

  it('🔴 D246 · con la pestaña Viajes no se ve «No tienes mesas abiertas» (D275: ahora al pie, sobre la barra)', () => {
    expect(home).toContain("const avisoSinMesas = openMesas !== null && !mesasFallaron && porUrgencia.length === 0 && tab !== 'viajes';");
    expect(home).toContain('<AppBottomBar active="home" aviso={avisoSinMesas ? <AvisoSinMesas /> : undefined} />');
  });
});

describe('H02 · después de salir, Inicio con la pestaña Viajes', () => {
  it('el pedido se lee mientras dure y se olvida al consumirlo', async () => {
    const m = await import('./inicioEnViajes');
    expect(m.inicioPideViajes()).toBe(false);
    m.pedirInicioEnViajes();
    expect(m.inicioPideViajes()).toBe(true);
    expect(m.inicioPideViajes()).toBe(true);
    m.olvidarInicioEnViajes();
    expect(m.inicioPideViajes()).toBe(false);
  });

  it('Inicio arranca en la pestaña pedida y olvida el pedido en un efecto (StrictMode no lo pierde)', () => {
    const fuente = readFileSync(new URL('../HomeScreen.tsx', import.meta.url), 'utf8');
    expect(fuente).toMatch(/useState<TabId>\(\(\) => \(inicioPideViajes\(\) \? 'viajes' : 'cuenta'\)\)/);
    expect(fuente).toMatch(/useEffect\(\(\) => \{ olvidarInicioEnViajes\(\); \}, \[\]\);/);
  });
});
