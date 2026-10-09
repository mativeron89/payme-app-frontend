import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CrearViajeView, type CrearViajeVistaProps } from './CrearViajeScreen';
import { sinResultados, type VistaDeBusqueda } from './crearViajeView';

const nada = () => undefined;
const LUIS = { clave: 'u:1', nombre: 'Luis Pérez', iniciales: 'LP', arroba: '@luis.perez' };
const SOFIA = { clave: 'u:2', nombre: 'Sofía Ramírez', iniciales: 'SR', arroba: null };

function props(extra: Partial<CrearViajeVistaProps> = {}): CrearViajeVistaProps {
  return {
    userName: 'Ana López',
    nombre: 'Cancún 2026',
    desde: '',
    hasta: '',
    texto: '',
    yo: { iniciales: 'AL', arroba: '@ana.lopez' },
    agregados: [LUIS, SOFIA],
    busqueda: null,
    lleno: false,
    error: null,
    enviando: false,
    puedeCrear: true,
    onVolver: nada, onNombre: nada, onDesde: nada, onHasta: nada, onTexto: nada,
    onAgregar: nada, onQuitar: nada, onCrear: nada,
    ...extra,
  };
}

const render = (p: CrearViajeVistaProps) => renderToStaticMarkup(<CrearViajeView {...p} />);
const contar = (html: string, s: string) => html.split(s).length - 1;

function busqueda(extra: Partial<VistaDeBusqueda> = {}): VistaDeBusqueda {
  return { texto: '@diego', amigos: [], otros: [], yaAgregados: [], fase: 'lista', arrobaCorta: false, ...extra };
}

describe('AF-VIAJES · 1d · Crear viaje', () => {
  it('las tres tarjetas con sus textos literales, yo arriba y cada agregado con «Quitar»', () => {
    const html = render(props());
    expect(html).toContain('class="screen vj-con-pie vjc"');
    expect(html).toContain('<h1 class="title-card-title">Crear viaje</h1>');
    expect(html).toContain('Nombre del viaje');
    expect(html).toContain('maxLength="80"');
    expect(html).toContain('Fechas');
    expect(html).toContain('>Opcional<');
    expect(html).not.toContain('propuesta');
    expect(contar(html, 'type="date"')).toBe(2);
    expect(html).toContain('>Del<');
    expect(html).toContain('>Al<');
    expect(html).toContain('Miembros');
    expect(html).toContain('placeholder="Busca en Amigos o escribe @usuario"');
    // Yo: «Tú», mi @ y el chip; sin botón para quitarme.
    expect(html).toMatch(/>AL<\/span><div class="vjc-quien"><div class="vjc-nombre">Tú<\/div><div class="vjc-arroba">@ana\.lopez<\/div><\/div><span class="vjc-creas">Creas el viaje<\/span>/);
    expect(html).toContain('Luis Pérez');
    expect(html).toContain('@luis.perez');
    expect(html).toContain('Sofía Ramírez');
    expect(contar(html, 'aria-label="Quitar"')).toBe(2);
    expect(html).toContain('Les llega una invitación. Entran al viaje cuando la aceptan.');
    // Sin barra de cinco: el botón fijo al pie.
    expect(html).not.toContain('appbar-item');
    expect(html).toMatch(/<div class="vj-pie"><button type="button" class="btn btn-navy">Crear viaje<\/button><\/div>/);
  });

  it('el botón queda apagado si no se puede crear (o mientras se envía)', () => {
    expect(render(props({ puedeCrear: false }))).toMatch(/class="btn btn-navy" disabled=""/);
    expect(render(props({ puedeCrear: false, enviando: true }))).toMatch(/class="btn btn-navy" disabled="" aria-busy="true"/);
  });

  it('sin mi @, la fila «Tú» va sin la línea del @', () => {
    const html = render(props({ yo: { iniciales: 'AL', arroba: null } }));
    expect(html).toMatch(/<div class="vjc-nombre">Tú<\/div><\/div><span class="vjc-creas">/);
  });

  it('🔴 «Al» antes que «Del»: error en línea junto a las fechas', () => {
    const html = render(props({ desde: '2026-10-11', hasta: '2026-10-05', puedeCrear: false }));
    expect(html).toContain('role="alert">La fecha «Al» no puede ser antes de «Del».</p>');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('min="2026-10-11"');
    expect(render(props({ desde: '2026-10-05', hasta: '2026-10-11' }))).not.toContain('role="alert"');
  });

  it('el error al crear va arriba del botón, siempre a la vista', () => {
    const html = render(props({ error: 'No encontramos a @mariana. Revísalo.' }));
    expect(html).toMatch(/<div class="vj-pie"><p class="vjc-error-pie" role="alert">No encontramos a @mariana\. Revísalo\.<\/p><button/);
  });

  it('con 19 agregados avisa el tope', () => {
    expect(render(props({ lleno: true }))).toContain('Un viaje admite hasta 20 personas.');
    expect(render(props())).not.toContain('Un viaje admite hasta 20 personas.');
  });

  it('🔴 nunca «saldo», nunca un correo', () => {
    const html = render(props({ busqueda: busqueda({ amigos: [LUIS], otros: [SOFIA], yaAgregados: [LUIS] }) }));
    expect(`${render(props())}${html}`).not.toMatch(/saldo|@[a-z0-9.]+\.(?:com|mx)\b/i);
  });
});

describe('AF-VIAJES · 1e · buscar en Amigos y por @usuario', () => {
  const DIEGO_T = { clave: 'u:9', nombre: 'Diego Torres', iniciales: 'DT', arroba: '@diego.torres' };
  const DIEGO_M = { clave: '@diegomrls', nombre: 'Diego Morales', iniciales: 'DM', arroba: '@diegomrls' };
  const DIEGO_R = { clave: '@d.rivas', nombre: 'Diego Rivas', iniciales: 'DR', arroba: '@d.rivas' };

  it('las secciones en orden, con «Agregar» en amigos y en otros; «Ya agregaste» sin botón', () => {
    const html = render(props({
      texto: '@diego',
      busqueda: busqueda({ amigos: [DIEGO_T], otros: [DIEGO_M, DIEGO_R], yaAgregados: [{ ...LUIS, nombre: 'Diego Luis' }] }),
    }));
    const i = ['En tus amigos', 'Diego Torres', 'Otros usuarios de PayMe', 'Diego Morales', 'Diego Rivas', 'Ya agregaste', 'Diego Luis']
      .map((s) => html.indexOf(s));
    expect(i.every((x) => x >= 0)).toBe(true);
    expect([...i].sort((a, b) => a - b)).toEqual(i);
    expect(contar(html, '>Agregar</button>')).toBe(3);
    expect(html.slice(html.indexOf('Ya agregaste'), html.indexOf('</section>'))).not.toContain('<button');
    // Mientras se busca no se ve la lista de 1d.
    expect(html).not.toContain('Creas el viaje');
    expect(html).not.toContain('aria-label="Quitar"');
    expect(html).not.toContain('No encontramos');
  });

  it('con 19 agregados, «Agregar» queda apagado', () => {
    const html = render(props({ lleno: true, busqueda: busqueda({ amigos: [DIEGO_T] }) }));
    expect(html).toMatch(/class="btn btn-teal btn-sm btn-fit vjc-agregar" disabled="">Agregar/);
  });

  it('mientras busca por @ lo dice; si falla, también', () => {
    expect(render(props({ busqueda: busqueda({ fase: 'buscando' }) }))).toMatch(/Otros usuarios de PayMe<\/h3><p class="vjc-ayuda">Buscando…/);
    expect(render(props({ busqueda: busqueda({ fase: 'limite' }) }))).toContain('Hiciste muchas búsquedas seguidas. Espera un momento.');
    expect(render(props({ busqueda: busqueda({ fase: 'error' }) }))).toContain('No pudimos buscar. Prueba de nuevo.');
  });

  it('sin resultados: «No encontramos a {lo escrito}. Revísalo.»', () => {
    expect(render(props({ busqueda: busqueda({ texto: '@zzzz' }) }))).toContain('No encontramos a @zzzz. Revísalo.');
    expect(render(props({ busqueda: busqueda({ texto: '@ma', fase: 'quieta', arrobaCorta: true }) })))
      .toContain('Escribe al menos 3 letras de su @.');
  });

  it('«sin resultados» no se dice mientras busca, si falló o si hay algo que mostrar', () => {
    expect(sinResultados(busqueda())).toBe(true);
    expect(sinResultados(busqueda({ fase: 'quieta' }))).toBe(true);
    expect(sinResultados(busqueda({ fase: 'buscando' }))).toBe(false);
    expect(sinResultados(busqueda({ fase: 'error' }))).toBe(false);
    expect(sinResultados(busqueda({ fase: 'limite' }))).toBe(false);
    expect(sinResultados(busqueda({ arrobaCorta: true, fase: 'quieta' }))).toBe(false);
    expect(sinResultados(busqueda({ amigos: [DIEGO_T] }))).toBe(false);
    expect(sinResultados(busqueda({ yaAgregados: [LUIS] }))).toBe(false);
  });
});
