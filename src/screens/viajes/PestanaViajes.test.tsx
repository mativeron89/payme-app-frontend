import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ViajeEnLista } from '../../api/viajes';
import { ListaDeCerradosVista, ListaDeProximosVista, PanelViajes, inicialDelViaje, type ConteoDeViajes } from './PestanaViajes';

/** AF-VIAJES · D242 · la pestaña «Viajes» de Inicio; D266 · «Crear viaje» y «Cerrados», con los cerrados debajo. */
const nada = () => undefined;

function enLista(extra: Partial<ViajeEnLista>): ViajeEnLista {
  return {
    id: 'v-1', nombre: 'Cancún 2026', fecha_desde: '2026-10-05', fecha_hasta: '2026-10-11', estado: 'abierto', personas: 4,
    mi_balance_cents: -54200, transferencias_pendientes: null, consumiste_cents: null, terminado_en: null,
    color: null, has_photo: false, hora_cierre: '23:59', ...extra,
  };
}

const listo = (abiertos: number, cerrados: number, viajes: ViajeEnLista[] = []): ConteoDeViajes =>
  ({ estado: 'listo', counts: { abiertos, cerrados }, viajes });

const panel = (conteo: ConteoDeViajes, cerradosAbierta = false, proximosAbierta = false) =>
  renderToStaticMarkup(<PanelViajes conteo={conteo} proximosAbierta={proximosAbierta} onProximos={nada}
    cerradosAbierta={cerradosAbierta} onCerrados={nada} onReintentar={nada} />);

/** Lo que se lee de cada lanzador: su rótulo y, si tiene, su bajada. */
const lanzadores = (html: string) => [...html.matchAll(/<button type="button" class="launch vj-lanzador[^"]*"[^>]*>([\s\S]*?)<\/button>/g)]
  .map((m) => m[1]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());

describe('🔴 D266 · D302 · la pestaña Viajes: «Crear viaje», «Próximos» y «Cerrados»', () => {
  it('🔴 D302 · las tres burbujas, lado a lado, cada una con su ícono y su palabra: «Próximos» entre las otras dos', () => {
    const html = panel(listo(2, 1));
    expect(lanzadores(html)).toEqual(['Crear viaje', 'Próximos', 'Cerrados']);
    expect(html).toContain('launch-pair');
    expect(html.match(/<span class="launch-ico" aria-hidden="true"><svg/g)).toHaveLength(3);
  });

  it('🔴 D274 · «Cerrados» sin la cantidad: ni «N viajes» ni la línea de abajo, haya los que haya', () => {
    // Mati: «Quitar la cantidad de viajes cerrados, dejar únicamente Cerrados».
    for (const conteo of [listo(0, 0), listo(2, 1), listo(1, 3)]) {
      const html = panel(conteo);
      expect(lanzadores(html)).toEqual(['Crear viaje', 'Próximos', 'Cerrados']);
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
    expect(lanzadores(panel(listo(0, 0)))).toEqual(['Crear viaje', 'Próximos', 'Cerrados']);
  });

  it('🔴 «Crear viaje» es un botón común; «Cerrados» se elige con `aria-pressed` y el borde (no sólo color)', () => {
    const cerrada = panel(listo(2, 1));
    expect(cerrada).toMatch(/<button type="button" class="launch vj-lanzador "><span class="launch-ico" aria-hidden="true">.*?<\/span><span class="launch-label">Crear viaje<\/span><\/button>/);
    expect(cerrada).toMatch(/aria-pressed="false"><span class="launch-ico" aria-hidden="true">.*?<\/span><span class="launch-label">Cerrados/);
    expect(cerrada).not.toContain('aria-pressed="true"');
    const abierta = panel(listo(2, 1), true);
    expect(abierta).toMatch(/class="launch vj-lanzador vj-lanzador--elegido" aria-pressed="true"><span class="launch-ico" aria-hidden="true">.*?<\/span><span class="launch-label">Cerrados/);
    expect(abierta.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it('🔴 D302 · «Próximos» se elige igual que «Cerrados»: `aria-pressed` y el borde', () => {
    const cerrada = panel(listo(2, 1));
    expect(cerrada).toMatch(/class="launch vj-lanzador " aria-pressed="false"><span class="launch-ico" aria-hidden="true">.*?<\/span><span class="launch-label">Próximos/);
    const abierta = panel(listo(2, 1), false, true);
    expect(abierta).toMatch(/class="launch vj-lanzador vj-lanzador--elegido" aria-pressed="true"><span class="launch-ico" aria-hidden="true">.*?<\/span><span class="launch-label">Próximos/);
    expect(abierta).toMatch(/aria-pressed="false"><span class="launch-ico" aria-hidden="true">.*?<\/span><span class="launch-label">Cerrados/);
    expect(abierta.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it('cargando: las tres burbujas en esqueleto', () => {
    const html = panel({ estado: 'cargando' });
    expect(html.match(/class="launch sk"/g)).toHaveLength(3);
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

describe('🔴 D302 · los próximos, debajo de la tarjeta', () => {
  const filas = (html: string) => [...html.matchAll(/<button type="button" class="vj-inicio-fila">([\s\S]*?)<\/button>/g)]
    .map((m) => m[1]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());

  it('cada fila, como los cerrados: la inicial (o la foto) y el nombre, en el orden recibido', () => {
    const html = renderToStaticMarkup(<ListaDeProximosVista viajes={[
      enLista({ id: 'v-7', nombre: 'Puebla', fecha_desde: '2026-10-20' }),
      enLista({ id: 'v-8', nombre: 'mérida', fecha_desde: '2026-11-02', color: 'verde', has_photo: true }),
    ]} fotoDe={(id) => (id === 'v-8' ? 'blob:foto-merida' : null)} />);
    expect(filas(html)).toEqual(['P Puebla', 'mérida']);
    expect(html).toContain('<img class="vj-insignia-foto" src="blob:foto-merida" alt=""/>');
    expect(html).toContain('aria-label="Viajes próximos"');
    // Ni montos ni personas: el detalle está adentro.
    for (const fuera of ['$', 'personas', 'Debes', 'Te deben']) expect(html).not.toContain(fuera);
  });

  it('sin próximos: «No tienes viajes próximos»; sin la lista todavía (o con error), nada', () => {
    expect(renderToStaticMarkup(<ListaDeProximosVista viajes={[]} />)).toContain('No tienes viajes próximos');
    expect(renderToStaticMarkup(<ListaDeProximosVista viajes={null} />)).toBe('');
  });

  it('🔴 tocar uno entra al viaje (abierto), no a la vista de cerrado', () => {
    const pestana = readFileSync(new URL('./PestanaViajes.tsx', import.meta.url), 'utf8');
    const lista = pestana.slice(pestana.indexOf('export function ListaDeProximosVista'));
    expect(lista).toContain("onClick={() => navigate('viaje', v.id)}");
    expect(lista).not.toContain('viaje-cerrado');
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

  it('🔴 D246 · con la pestaña Viajes no se ve «No tienes mesas abiertas» (D277: al final del contenido)', () => {
    expect(home).toContain("const avisoSinMesas = openMesas !== null && !mesasFallaron && porUrgencia.length === 0 && tab !== 'viajes'\n    && sinPendientesDeViajes;");
    expect(home).toContain('{avisoSinMesas && <AvisoSinMesas />}');
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
