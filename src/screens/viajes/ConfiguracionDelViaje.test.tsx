import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CONTRATO_VIAJES, decodeDetalleViaje } from '../../api/viajes';
import { partirPorViaje } from './BuscadorDeMiembros';
import { ConfiguracionVista } from './ConfiguracionDelViaje';
import { sinResultados, type Candidato, type VistaDeBusqueda } from './crearViajeView';

/**
 * D255-8 · «Configuración» del viaje. Mati: «abajo de "Ver balance del viaje"
 * coloca un botón de configuración. En ese botón tiene que estar la opción de
 * agregar nuevos miembros, de ajustar el color de la burbuja del encabezado (y
 * cómo se ve luego en viajes abiertos), foto, fecha». Tramo 1: agregar miembros;
 * el resto, armado y apagado hasta el dueño (tramo 2).
 */
const nada = () => undefined;
const persona = { first_name: 'Ana', last_name: 'López', username: 'ana.lopez', eliminada: false };
const VIAJE = decodeDetalleViaje({
  contract: CONTRATO_VIAJES,
  viaje: {
    id: '0e000000-0000-4000-8000-000000000001', nombre: 'Cancún 2026', fecha_desde: '2026-10-05', fecha_hasta: '2026-10-11',
    estado: 'abierto', creado_en: null, mi_miembro_id: 'm1',
    miembros: [{ id: 'm1', ...persona, es_yo: true, balance_cents: 0, falta_elegir: 0, has_avatar: false, pagado_cents: 0 }],
    invitados: [{ id: 'm2', first_name: 'Leo', last_name: 'Paz', username: null, eliminada: false }],
    mi_balance_cents: 0, gasto_del_grupo_cents: 0, tickets: [], sin_repartir: [], transferencias: [], transferencias_pendientes: 0,
  },
});
const LEO = { clave: 'm2', nombre: 'Leo Paz', iniciales: 'LP', arroba: null };
const JUAN = { clave: 'u:j', nombre: 'Juan López', iniciales: 'JL', arroba: '@juan.lopez' };
const LUIS = { clave: '@luis.perez', nombre: 'Luis Pérez', iniciales: 'LP', arroba: '@luis.perez' };

const texto = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const busqueda = (extra: Partial<VistaDeBusqueda> = {}): VistaDeBusqueda =>
  ({ texto: 'j', amigos: [], otros: [], yaAgregados: [], fase: 'quieta', arrobaCorta: false, ...extra });
const render = (extra: Partial<Parameters<typeof ConfiguracionVista>[0]> = {}) => renderToStaticMarkup(
  <ConfiguracionVista
    viaje={VIAJE} texto="" busqueda={null} invitados={[LEO]} lleno={false} ocupado={null}
    onVolver={nada} onTexto={nada} onAgregar={nada} {...extra}
  />,
);

describe('🔴 D255-8 · Configuración del viaje', () => {
  it('el encabezado dice sólo «Configuración» (un solo título, plan OK)', () => {
    const html = render();
    expect(html).toMatch(/<div class="title-card"><h1 class="title-card-title">Configuración<\/h1><\/div>/);
  });

  it('«Agregar miembros» con el buscador del alta; sin buscar, la ayuda y los invitados que faltan aceptar', () => {
    const leido = texto(render());
    expect(leido).toContain('Agregar miembros');
    expect(render()).toContain('placeholder="Busca en Amigos o escribe @usuario"');
    expect(leido).toContain('Les llega una invitación. Entran al viaje cuando la aceptan.');
    expect(leido).toContain('Invitados LP Leo Paz Falta que acepte');
  });

  it('buscando: «Agregar» para los que se pueden sumar; quien ya está, en «Ya están en el viaje» sin botón', () => {
    const html = render({ texto: 'l', busqueda: busqueda({ amigos: [JUAN], enElViaje: [LUIS], fase: 'quieta' }) });
    const leido = texto(html);
    expect(leido).toContain('En tus amigos JL Juan López @juan.lopez Agregar');
    expect(leido).toContain('Ya están en el viaje LP Luis Pérez @luis.perez');
    expect(leido).not.toContain('Luis Pérez @luis.perez Agregar');
    expect(html.match(/vjc-agregar/g)).toHaveLength(1);
    // Mientras busca, los invitados no se mezclan con los resultados.
    expect(leido).not.toContain('Falta que acepte');
  });

  it('mientras se manda una invitación, todos los «Agregar» esperan y el de esa persona se marca ocupado', () => {
    const html = render({ busqueda: busqueda({ amigos: [JUAN, { ...JUAN, clave: 'u:k', nombre: 'Kim' }] }), ocupado: 'u:j' });
    expect(html.match(/<button type="button" class="btn btn-teal btn-sm btn-fit vjc-agregar" disabled=""/g)).toHaveLength(2);
    expect(html.match(/aria-busy="true"/g)).toHaveLength(1);
  });

  it('con el viaje lleno, «Agregar» apagado y el aviso de 20 personas', () => {
    const html = render({ lleno: true, busqueda: busqueda({ amigos: [JUAN] }) });
    expect(texto(html)).toContain('Un viaje admite hasta 20 personas.');
    expect(html).toContain('vjc-agregar" disabled=""');
  });

  it('tramo 2 · «El viaje»: nombre y fechas, color y foto, armados y apagados', () => {
    const html = render();
    expect(texto(html)).toContain('El viaje Nombre y fechas Cancún 2026 · 5–11 oct Color Foto C');
    expect(html.match(/<button type="button" class="vjcfg-fila" disabled="">/g)).toHaveLength(3);
  });

  it('«Ya están en el viaje» cuenta como resultado: no dice «No encontramos»', () => {
    expect(sinResultados(busqueda({ enElViaje: [LUIS], fase: 'lista' }))).toBe(false);
    expect(sinResultados(busqueda({ fase: 'lista' }))).toBe(true);
  });
});

describe('D255-8 · quién ya está en el viaje (por su @)', () => {
  const c = (clave: string, username: string | null): Candidato =>
    ({ tipo: 'amigo', clave, user_id: clave, first_name: 'X', last_name: 'Y', username });

  it('con el conjunto, quien tiene un @ del viaje no se ofrece; sin @, se ofrece (el dueño lo ignora)', () => {
    const r = partirPorViaje([c('a', 'luis.perez'), c('b', 'juan.lopez'), c('d', null)], new Set(['luis.perez']));
    expect(r.ofrecer.map((x) => x.clave)).toEqual(['b', 'd']);
    expect(r.yaEstan.map((x) => x.clave)).toEqual(['a']);
  });

  it('sin conjunto (Crear viaje), todos se ofrecen', () => {
    const todos = [c('a', 'luis.perez'), c('d', null)];
    expect(partirPorViaje(todos, undefined)).toEqual({ ofrecer: todos, yaEstan: [] });
  });
});

describe('D255-8 · el cableado', () => {
  const config = readFileSync(new URL('./ConfiguracionDelViaje.tsx', import.meta.url), 'utf8');
  const viaje = readFileSync(new URL('./ViajeScreen.tsx', import.meta.url), 'utf8');

  it('cada «Agregar» manda UNA persona a la ruta existente, y con la respuesta se actualiza el viaje y se avisa', () => {
    expect(config).toMatch(/const v = await api\.invitarAlViaje\(viaje\.id, miembrosDelPedido\(\[c\]\)\);/);
    expect(config).toMatch(/onActualizado\(v\);\s*toast\(t\('Le mandamos la invitación a \{0\}\.', /);
    expect(config).toMatch(/const buscador = useBuscadorDeMiembros\(invitadosAhora, enElViaje\);/);
  });

  it('si el viaje ya se cerró o ya no está, se sale de Configuración; los demás errores, los mensajes del alta', () => {
    expect(config).toMatch(/if \(e\.tipo === 'no_abierto' \|\| e\.tipo === 'no_disponible'\) onYaSeCerro\(\);\s*else toast\(mensajeAlCrear\(e, t\)\);/);
  });

  it('Configuración es una vista dentro del viaje abierto (plan OK, respuesta A): sin ruta nueva', () => {
    expect(viaje).toMatch(/if \(configuracion && viaje\?\.estado === 'abierto'\) \{/);
    expect(viaje).toMatch(/onConfiguracion=\{\(\) => setConfiguracion\(true\)\}/);
    expect(viaje).toMatch(/onVolver=\{\(\) => setConfiguracion\(false\)\}/);
  });
});
