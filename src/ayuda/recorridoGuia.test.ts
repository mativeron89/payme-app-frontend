import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { traducir } from '../i18n/idioma';
import type { PageId } from '../router';
import { PanelViajes } from '../screens/viajes/PestanaViajes';
import {
  capituloDe, CREAR_VIAJE, ESTADO_INICIAL, pasosPresentes, primarioDe, siguienteEstado, vecino, VIAJE_ABIERTO,
  type Capitulo, type ContextoDeGuia, type Paso,
} from './recorridoGuia';
import { avisarALaGuia, escucharSenalesDeGuia, type SenalDeGuia } from './senalesGuia';

const t = (s: string, ...args: unknown[]) => traducir(s, 'es', ...args);
const en = (s: string, ...args: unknown[]) => traducir(s, 'en', ...args);
const g = (id: string) => `[data-guia="${id}"]`;
const centro = (id: string) => `.appbar-center[data-guia="${id}"]`;

function ctx(pagina: PageId, hay: readonly string[], extra: Partial<Omit<ContextoDeGuia, 'hay'>> = {}): ContextoDeGuia {
  const visibles = new Set(hay);
  return {
    pagina, etapa: null, rol: null, modo: null, destino: null, viajeDeHoy: null, pagos: 'no', parametro: null, final: null,
    ...extra, hay: (s) => visibles.has(s),
  };
}
/** El capítulo, que en estas pantallas nunca es el momento de paso (`null`). */
function capitulo(c: ContextoDeGuia, tt = t): Capitulo {
  const r = capituloDe(c, tt);
  if (!r) throw new Error(`capítulo nulo en ${c.pagina}`);
  return r;
}
const ids = (cap: Capitulo) => pasosPresentes(cap).map((p) => p.id);
const paso = (cap: Capitulo, id: string): Paso => {
  const p = cap.pasos.find((x) => x.id === id);
  if (!p) throw new Error(`no existe el paso ${id} en ${cap.id}`);
  return p;
};

describe('D341-M2 · la bienvenida en Inicio', () => {
  it('cuenta la historia completa y termina con «Tu turno» sobre Escanear', () => {
    const cap = capitulo(ctx('home', [centro('camara')]), t);
    expect(cap.id).toBe('bienvenida');
    expect(cap.etapa).toBe('foto');
    expect(ids(cap)).toEqual(['apertura', 'escanear']);
    expect(paso(cap, 'apertura').titulo).toBe('Así se divide la cuenta en PayMe');
    expect(paso(cap, 'escanear')).toMatchObject({ tipo: 'tu-turno', chip: 'Tu turno: toca Escanear' });
  });

  it('suma Viajes y la mesa abierta sólo si se ven', () => {
    const cap = capitulo(ctx('home', [centro('camara'), g('tab-viajes'), g('mesa-abierta')]), t);
    expect(ids(cap)).toEqual(['apertura', 'viajes', 'mesa-abierta', 'escanear']);
  });

  it('sin pagos (o sin dato) no menciona tarjeta; con pagos, sí', () => {
    for (const pagos of ['no', 'pendiente'] as const) {
      expect(paso(capitulo(ctx('home', [centro('camara')], { pagos }), t), 'apertura').texto).not.toMatch(/tarjeta|pag/i);
    }
    expect(paso(capitulo(ctx('home', [centro('camara')], { pagos: 'si' }), t), 'apertura').texto).toContain('paga su parte con tarjeta');
  });

  it('D276 · el paso de Escanear dice a dónde va el ticket por las fechas de los viajes', () => {
    const uno = capitulo(ctx('home', [centro('camara')], { destino: 'viaje', viajeDeHoy: 'Cancún 2026' }), t);
    expect(paso(uno, 'escanear').texto).toBe('Ahora: toca Escanear y saca la foto. Hoy estás en las fechas de Cancún 2026: el ticket va a ese viaje.');
    const varios = capitulo(ctx('home', [centro('camara')], { destino: 'elegir-viaje' }), t);
    expect(paso(varios, 'escanear').texto).toContain('más de un viaje en fechas');
    expect(paso(capitulo(ctx('home', [centro('camara')]), t), 'escanear').texto).toContain('Después: revisas los platos');
  });

  it('con la pestaña Viajes abierta, el capítulo es el de los viajes y termina en Crear viaje', () => {
    const cap = capitulo(ctx('home', [centro('camara'), VIAJE_ABIERTO, CREAR_VIAJE]), t);
    expect(cap.id).toBe('viajes-inicio');
    expect(cap.etapa).toBeNull();
    expect(ids(cap)).toEqual(['viaje', 'crear']);
  });

  it('«Crear viaje» es el primer lanzador de la pestaña: el selector por posición apunta a él', () => {
    const html = renderToStaticMarkup(createElement(PanelViajes, {
      conteo: { estado: 'listo', counts: { abiertos: 0, cerrados: 0 }, viajes: [] },
      proximosAbierta: false, onProximos: () => undefined, cerradosAbierta: false, onCerrados: () => undefined, onReintentar: () => undefined,
    }));
    expect(CREAR_VIAJE).toBe('.vj-lanzadores > .vj-lanzador:first-child');
    expect(html).toMatch(/^<div class="[^"]*\bvj-lanzadores\b[^"]*"><button type="button" class="launch vj-lanzador[^"]*"[^>]*><span class="launch-ico"[^>]*>[\s\S]*?<\/span><span class="launch-label">Crear viaje<\/span>/);
  });
});

describe('D341-M2 · el recorrido del restaurante', () => {
  it('la foto y el recorte son «tu turno», con el mapa en Foto; en un viaje, sin mapa', () => {
    const foto = capitulo(ctx('scan', [g('camara-controles')], { etapa: 'foto' }), t);
    expect([foto.id, foto.etapa, ids(foto)]).toEqual(['foto', 'foto', ['sacar-foto']]);
    expect(paso(foto, 'sacar-foto').tipo).toBe('tu-turno');
    const recorte = capitulo(ctx('scan', [g('usar-foto')], { etapa: 'recorte' }), t);
    expect([recorte.id, ids(recorte)]).toEqual(['recorte', ['usar-foto']]);
    expect(capitulo(ctx('scan', [g('camara-controles')], { etapa: 'viaje-foto' }), t).etapa).toBeNull();
  });

  it('dividir: «Ver el ticket» se salta si está deshabilitado; el número de personas cambia según el reparto', () => {
    const base = [g('reparto'), g('personas'), centro('continuar')];
    const sinTicket = capitulo(ctx('scan', base, { etapa: 'ticket', modo: 'consumo' }), t);
    expect(ids(sinTicket)).toEqual(['reparto', 'personas', 'continuar']);
    const conTicket = capitulo(ctx('scan', [`${g('revisar-ticket')}:not(:disabled)`, ...base], { etapa: 'ticket', modo: 'consumo' }), t);
    expect(ids(conTicket)[0]).toBe('revisar');
    expect(paso(conTicket, 'personas').titulo).toBe('¿Cuántos son?');
    expect(paso(conTicket, 'personas').texto).toContain('base de propina por persona');
    const iguales = capitulo(ctx('scan', base, { etapa: 'ticket', modo: 'igual' }), t);
    expect(paso(iguales, 'personas').titulo).toBe('¿Cuántos pagan?');
  });

  it('dividir: lo que sigue a Continuar depende del riel; pendiente no promete nada', () => {
    const texto = (pagos: 'si' | 'no' | 'pendiente') =>
      paso(capitulo(ctx('scan', [centro('continuar')], { etapa: 'ticket', pagos }), t), 'continuar').texto;
    expect(texto('si')).toContain('garantía');
    expect(texto('no')).toContain('el link para invitar');
    expect(texto('pendiente')).toBe('Ahora: toca Continuar.');
  });

  it('garantía, banco e invitar siguen a la etapa que la app muestra', () => {
    expect(ids(capitulo(ctx('scan', [g('garantia-tarjeta'), centro('garantizar')], { etapa: 'garantia' }), t))).toEqual(['tarjetas', 'garantizar']);
    expect(ids(capitulo(ctx('scan', [centro('confirmar-banco')], { etapa: 'banco' }), t))).toEqual(['confirmar']);
    const invitar = capitulo(ctx('scan', [g('compartir'), centro('continuar-compartir')], { etapa: 'compartir' }), t);
    expect([invitar.etapa, ids(invitar)]).toEqual(['invitar', ['compartir', 'seguir']]);
  });

  it('«Tu mesa» del organizador: solicitudes, invitar, consumos cerrados, platos, cerrar y Listo', () => {
    const hay = ['.desplegable.solicitudes', g('invitar'), `${g('consumos')}[aria-expanded="false"]`, g('plato'), g('mi-parte'), g('cerrar-mesa'), centro('listo-mesa')];
    const cap = capitulo(ctx('mesa', hay, { etapa: 'mesa', rol: 'organizador', modo: 'consumo' }), t);
    expect(ids(cap)).toEqual(['solicitudes', 'invitar', 'consumos', 'plato', 'mi-parte', 'cerrar', 'listo']);
    expect(paso(cap, 'plato').texto).not.toContain('Cada quien elige lo suyo');
    expect(paso(cap, 'listo')).toMatchObject({ titulo: 'Confirma lo tuyo', chip: 'Tu turno: toca Listo' });
  });

  it('el invitado no ve los pasos del organizador y su plato empieza con «Cada quien elige lo suyo»', () => {
    const hay = ['.desplegable.solicitudes', g('invitar'), `${g('consumos')}[aria-expanded="false"]`, g('plato'), g('cerrar-mesa'), centro('listo-mesa')];
    const cap = capitulo(ctx('mesa', hay, { etapa: 'mesa', rol: 'invitado', modo: 'consumo' }), t);
    expect(ids(cap)).toEqual(['plato', 'listo']);
    expect(paso(cap, 'plato').texto.startsWith('Cada quien elige lo suyo desde su teléfono. ')).toBe(true);
  });

  it('en partes iguales los platos son opcionales; con candados, se dice', () => {
    const cap = capitulo(ctx('mesa', [g('plato'), g('plato-tomado'), g('mi-parte'), centro('listo-mesa')], { etapa: 'mesa', rol: 'organizador', modo: 'igual' }), t);
    expect(paso(cap, 'plato').titulo).toBe('Marca lo que comiste');
    expect(paso(cap, 'plato').texto).toMatch(/opcional.*Los platos con candado ya los eligió otra persona\.$/);
    expect(paso(cap, 'mi-parte').texto).toBe('Es tu parte igual de la cuenta.');
  });

  it('con la invitación sin aceptar, la guía sólo apunta a «Ver avisos»', () => {
    const cap = capitulo(ctx('mesa', [g('ver-avisos'), g('plato'), centro('listo-mesa')], { etapa: 'mesa', rol: 'invitado' }), t);
    expect([cap.id, ids(cap)]).toEqual(['mesa-invitacion', ['aceptar']]);
  });

  it('con pagos, Listo sigue a la propina; la vista de pago se reconoce por sus clases, sin anclas nuevas', () => {
    const listo = capitulo(ctx('mesa', [centro('listo-mesa')], { etapa: 'mesa', pagos: 'si' }), t);
    expect(paso(listo, 'listo').titulo).toBe('Confirma y paga');
    const pago = capitulo(ctx('mesa', ['.tip-block', '.tip-recipient-card', centro('continuar')], { pagos: 'si' }), t);
    expect([pago.id, pago.etapa, ids(pago)]).toEqual(['pagar', 'pagar', ['propina', 'mesero', 'pagar']]);
    const congelado = `.appbar-center[aria-label="Reintentar el pago sin confirmar"]`;
    const reintento = capitulo(ctx('mesa', ['.tip-block', centro('continuar'), congelado], { pagos: 'si' }), t);
    expect(paso(reintento, 'pagar').texto).toContain('se manda el mismo pago, no uno nuevo');
  });

  it('el comprobante es un final: «¡Pagaste tu parte!» sobre Ir a Inicio', () => {
    const cap = capitulo(ctx('mesa', [centro('ir-inicio')]), t);
    expect([cap.id, paso(cap, 'pagado').tipo]).toEqual(['pagado', 'final']);
  });
});

describe('D341-M2 · los finales sólo después de un guardado avisado', () => {
  const mesaGuardada = (cerrada: boolean): SenalDeGuia => ({ tipo: 'mesa-guardada', mesa: 'PA-2847', cerrada });
  const tarjeta = `${g('mesa-abierta')}[data-guia-mesa="PA-2847"]`;

  it('sin aviso, volver a Inicio es la bienvenida; con aviso, la tarjeta de ESA mesa', () => {
    expect(capitulo(ctx('home', [centro('camara'), tarjeta]), t).id).toBe('bienvenida');
    const cap = capitulo(ctx('home', [centro('camara'), tarjeta, g('nav-mesas')], { final: mesaGuardada(false) }), t);
    expect([cap.id, ids(cap)]).toEqual(['final-mesa', ['tarjeta']]);
    expect(paso(cap, 'tarjeta')).toMatchObject({ ancla: tarjeta, tipo: 'final' });
    expect(paso(cap, 'tarjeta').nota).toContain('No volver a mostrar');
  });

  it('mientras la tarjeta no llega, apunta a Mesas', () => {
    const cap = capitulo(ctx('home', [centro('camara'), g('nav-mesas')], { final: mesaGuardada(false) }), t);
    expect(ids(cap)).toEqual(['mesas']);
  });

  it('si el guardado cerró la mesa, el final lo dice en la mesa', () => {
    const cap = capitulo(ctx('mesa', [g('nav-home')], { final: mesaGuardada(true) }), t);
    expect([cap.id, paso(cap, 'cerrada').titulo]).toEqual(['mesa-cerrada', 'La mesa se cerró']);
  });

  it('una mesa que ya no se puede modificar muestra el final de mesa cerrada, no los platos ni Listo', () => {
    const cap = capitulo(ctx('mesa', [g('plato'), centro('listo-mesa'), g('nav-home')], { etapa: 'mesa-cerrada', rol: 'invitado', modo: 'igual' }), t);
    expect([cap.id, ids(cap), paso(cap, 'cerrada').ancla]).toEqual(['mesa-cerrada', ['cerrada'], g('nav-home')]);
    // Sin la barra (la vista de cierre), apunta a su botón Inicio.
    expect(paso(capitulo(ctx('mesa', ['.action-bar .btn-navy'], { final: mesaGuardada(true) }), t), 'cerrada').ancla).toBe('.action-bar .btn-navy');
  });

  it('en un viaje, el final va sobre el balance', () => {
    const final = { tipo: 'viaje-guardado', viaje: 'v-1' } as const;
    const cap = capitulo(ctx('viaje', [g('mi-balance'), centro('camara')], { final, parametro: 'v-1' }), t);
    expect([cap.id, ids(cap)]).toEqual(['final-viaje', ['balance']]);
    // El final es de ESE viaje: en otro viaje se ve su recorrido.
    expect(capitulo(ctx('viaje', [g('mi-balance'), g('agregar-gasto'), centro('camara')], { final, parametro: 'v-2' }), t).id).toBe('viaje');
  });

  it('con pagos encendidos el final es el comprobante: Inicio no muestra «Así queda tu mesa»', () => {
    const cap = capitulo(ctx('home', [centro('camara'), tarjeta], { final: mesaGuardada(false), pagos: 'si' }), t);
    expect(cap.id).toBe('bienvenida');
  });

  it('un código con comillas no rompe el selector', () => {
    const cap = capitulo(ctx('home', [g('nav-mesas')], { final: { tipo: 'mesa-guardada', mesa: 'A"B', cerrada: false } }), t);
    expect(paso(cap, 'tarjeta').ancla).toBe(`${g('mesa-abierta')}[data-guia-mesa="A\\"B"]`);
  });

  it('el aviso llega a quien escucha, un oyente que falla no corta a los demás, y sin oyentes no pasa nada', () => {
    expect(() => avisarALaGuia(mesaGuardada(false))).not.toThrow();
    const recibidas: SenalDeGuia[] = [];
    const quitarMalo = escucharSenalesDeGuia(() => { throw new Error('falla'); });
    const quitar = escucharSenalesDeGuia((s) => recibidas.push(s));
    expect(() => avisarALaGuia(mesaGuardada(false))).not.toThrow();
    expect(recibidas).toEqual([mesaGuardada(false)]);
    quitar(); quitarMalo();
    avisarALaGuia(mesaGuardada(true));
    expect(recibidas).toHaveLength(1);
  });
});

describe('D341-M2 · el recorrido del viaje', () => {
  it('el viaje abierto termina en Escanear; esperando pagos, en Ya pagué y Recibí', () => {
    const abierto = capitulo(ctx('viaje', [g('mi-balance'), g('balance'), g('agregar-gasto'), '.vjv-titulo-engranaje', centro('camara')]), t);
    expect(ids(abierto)).toEqual(['balance-propio', 'balance', 'gasto', 'configuracion', 'escanear']);
    // El DOM real de «esperando pagos»: sin balance ni «Agregar gasto», con la cámara de siempre en la barra.
    const esperando = capitulo(ctx('viaje', [centro('camara'), '.vjv-tr-destacada > .btn-navy', '.vjv-tr-botones > .btn-navy, .vjv-tr-pie > .btn']), t);
    expect(ids(esperando)).toEqual(['ya-pague', 'recibi']);
    expect(paso(esperando, 'ya-pague').texto).toContain('PayMe no mueve el dinero');
    expect(primarioDe(paso(esperando, 'ya-pague'), true)).toBe('siguiente');
    expect(primarioDe(paso(esperando, 'recibi'), false)).toBe('terminar');
  });

  it('«Tu viaje abierto» apunta sólo a un viaje con «+ Gasto», nunca a uno esperando pagos', () => {
    expect(VIAJE_ABIERTO).toBe('.viaje-tarjeta:has(> .viaje-gasto) > .viaje-burbuja');
    expect(ids(capitulo(ctx('home', ['.viaje-burbuja', CREAR_VIAJE]), t))).toEqual(['crear']);
  });

  it('crear, ticket nuevo, consumos y gasto tienen su capítulo; el balance no es parte del recorrido', () => {
    expect(ids(capitulo(ctx('viaje-nuevo', ['#vjc-nombre', 'section[aria-labelledby="vjc-miembros"]', '.vjc .vj-pie > .btn-navy']), t))).toEqual(['nombre', 'miembros', 'crear']);
    expect(ids(capitulo(ctx('viaje-ticket-nuevo', [g('quien-pago'), g('reparto'), 'section[aria-labelledby="vjt-quienes"]', '.vj-pie > .btn-navy']), t))).toEqual(['quien-pago', 'reparto', 'presentes', 'compartir']);
    expect(ids(capitulo(ctx('viaje-ticket', [g('elegir-consumo'), g('mi-parte'), g('listo-consumos')]), t))).toEqual(['plato', 'mi-parte', 'listo']);
    expect(ids(capitulo(ctx('viaje-gasto', [g('descripcion-gasto'), g('monto-gasto'), g('quien-pago'), g('entre-quienes'), g('guardar-gasto')]), t))).toEqual(['que', 'cuanto', 'quien-pago', 'entre', 'guardar']);
    expect(capitulo(ctx('viaje-balance', [g('tab-consumos'), g('tab-miembros'), g('nav-home')]), t).id).toBe('espera');
  });
});

describe('D341-M2 · fuera del recorrido', () => {
  it('pantallas ajenas y pantallas sin pasos visibles esperan apuntando a Inicio, o sin control', () => {
    for (const pagina of ['amigos', 'mas', 'avisos', 'mesas'] as const) {
      const cap = capitulo(ctx(pagina, [g('nav-home')]), t);
      expect([cap.id, paso(cap, 'espera').ancla, paso(cap, 'espera').tipo]).toEqual(['espera', g('nav-home'), 'espera']);
    }
    expect(paso(capitulo(ctx('mesa', [], { etapa: 'mesa' }), t), 'espera').ancla).toBeNull();
    expect(capitulo(ctx('scan', []), t).id).toBe('espera');
  });

  it('mientras se prepara y se lee la foto, no hay capítulo: la guía se oculta y conserva su lugar', () => {
    for (const etapa of ['leyendo', 'viaje-leyendo']) expect(capituloDe(ctx('scan', [g('camara-controles')], { etapa }), t)).toBeNull();
  });

  it('un invitado sin nada por elegir en consumo no recibe «toca Listo», que sólo frenaría', () => {
    expect(capitulo(ctx('mesa', [centro('listo-mesa'), g('nav-home')], { etapa: 'mesa', rol: 'invitado', modo: 'consumo' }), t).id).toBe('espera');
    expect(ids(capitulo(ctx('mesa', [centro('listo-mesa'), g('mi-parte')], { etapa: 'mesa', rol: 'invitado', modo: 'consumo' }), t))).toEqual(['mi-parte', 'listo']);
  });
});

describe('D341-M2 · el paso vigente', () => {
  const cap = capitulo(ctx('mesa', [g('invitar'), `${g('consumos')}[aria-expanded="false"]`, g('plato'), g('mi-parte'), centro('listo-mesa')], { etapa: 'mesa', rol: 'organizador', modo: 'consumo' }), t);

  it('otro capítulo empieza por su primer paso y desplegado', () => {
    expect(siguienteEstado(cap, ESTADO_INICIAL)).toEqual({ capitulo: 'mesa', paso: 'invitar', plegado: false, tocado: false });
    expect(siguienteEstado(cap, { capitulo: 'dividir', paso: 'continuar', plegado: true, tocado: true })).toEqual({ capitulo: 'mesa', paso: 'invitar', plegado: false, tocado: false });
  });

  it('sin cambios devuelve el mismo objeto (no re-renderiza)', () => {
    const e = { capitulo: 'mesa', paso: 'consumos', plegado: true, tocado: true };
    expect(siguienteEstado(cap, e)).toBe(e);
  });

  it('cuando el paso deja de aplicar (se abrió la lista), sigue con el próximo y desplegado', () => {
    const abierta = capitulo(ctx('mesa', [g('invitar'), g('plato'), g('mi-parte'), centro('listo-mesa')], { etapa: 'mesa', rol: 'organizador', modo: 'consumo' }), t);
    expect(siguienteEstado(abierta, { capitulo: 'mesa', paso: 'consumos', plegado: true, tocado: true })).toEqual({ capitulo: 'mesa', paso: 'plato', plegado: false, tocado: true });
  });

  it('al aparecer el selector de porción, el plato se cumplió y la guía pasa a la porción', () => {
    const conPorcion = capitulo(ctx('mesa', [g('plato'), g('porcion'), g('mi-parte'), centro('listo-mesa')], { etapa: 'mesa', rol: 'invitado', modo: 'consumo' }), t);
    expect(paso(conPorcion, 'plato').cumplido).toBe(true);
    expect(siguienteEstado(conPorcion, { capitulo: 'mesa', paso: 'plato', plegado: false, tocado: false })).toEqual({ capitulo: 'mesa', paso: 'porcion', plegado: false, tocado: true });
  });

  it('si no queda nada después, vuelve al anterior que aplica', () => {
    const corto = capitulo(ctx('mesa', [g('plato')], { etapa: 'mesa', rol: 'invitado', modo: 'consumo' }), t);
    expect(siguienteEstado(corto, { capitulo: 'mesa', paso: 'listo', plegado: true, tocado: true }).paso).toBe('plato');
  });

  it('mientras la persona no movió la guía, un paso anterior que termina de cargar pasa adelante', () => {
    const cargando = capitulo(ctx('viaje', [g('agregar-gasto'), centro('camara')]), t);
    const e = siguienteEstado(cargando, ESTADO_INICIAL);
    expect(e.paso).toBe('gasto');
    const cargado = capitulo(ctx('viaje', [g('mi-balance'), g('balance'), g('agregar-gasto'), centro('camara')]), t);
    expect(siguienteEstado(cargado, e)).toEqual({ capitulo: 'viaje', paso: 'balance-propio', plegado: false, tocado: false });
    const movida = { ...e, tocado: true };
    expect(siguienteEstado(cargado, movida)).toBe(movida);
  });

  it('después de un avance automático, una porción abierta no devuelve al organizador al primer paso', () => {
    const org = (hay: string[]) => capitulo(ctx('mesa', hay, { etapa: 'mesa', rol: 'organizador', modo: 'consumo' }), t);
    const enPlato = { capitulo: 'mesa', paso: 'plato', plegado: false, tocado: false };
    const enPorcion = siguienteEstado(org([g('invitar'), g('plato'), g('porcion'), centro('listo-mesa')]), enPlato);
    expect(enPorcion.paso).toBe('porcion');
    expect(siguienteEstado(org([g('invitar'), g('plato'), g('porcion'), centro('listo-mesa')]), enPorcion)).toBe(enPorcion);
  });

  it('Atrás y Siguiente recorren sólo los pasos que aplican', () => {
    expect(vecino(cap, 'invitar', 1)?.id).toBe('consumos');
    expect(vecino(cap, 'plato', -1)?.id).toBe('consumos');
    expect(vecino(cap, 'invitar', -1)).toBeNull();
    expect(vecino(cap, 'listo', 1)).toBeNull();
  });

  it('Atrás desde la porción salta el plato ya cumplido (no rebota) y sin otro anterior se deshabilita', () => {
    const conPorcion = capitulo(ctx('mesa', [g('plato'), g('porcion'), g('mi-parte'), centro('listo-mesa')], { etapa: 'mesa', rol: 'invitado', modo: 'consumo' }), t);
    expect(vecino(conPorcion, 'porcion', -1)).toBeNull();
    const org = capitulo(ctx('mesa', [g('invitar'), g('plato'), g('porcion'), centro('listo-mesa')], { etapa: 'mesa', rol: 'organizador', modo: 'consumo' }), t);
    expect(vecino(org, 'porcion', -1)?.id).toBe('invitar');
  });

  it('«Terminar guía» sólo en los finales; un paso informativo sin siguiente espera, sin cerrar la guía', () => {
    const mira = paso(cap, 'mi-parte');
    expect([primarioDe(mira, true), primarioDe(mira, false)]).toEqual(['siguiente', null]);
    expect(primarioDe(paso(cap, 'listo'), false)).toBe('entendido');
    const fin = paso(capitulo(ctx('home', [g('nav-mesas')], { final: { tipo: 'mesa-guardada', mesa: 'X', cerrada: false } }), t), 'mesas');
    expect(primarioDe(fin, false)).toBe('terminar');
    expect(primarioDe(paso(capitulo(ctx('amigos', [g('nav-home')]), t), 'espera'), true)).toBeNull();
  });
});

describe('D341-M2 · cada texto tiene traducción y cada ancla existe en la app', () => {
  const FUENTES = import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const app = Object.entries(FUENTES).filter(([r]) => !r.includes('/ayuda/') && !/\.test\.tsx?$/.test(r)).map(([, s]) => s).join('\n');
  const recorrido = FUENTES['./recorridoGuia.ts'] ?? '';

  it('toda ancla `data-guia` del recorrido está en alguna pantalla', () => {
    const anclas = [...new Set([...recorrido.matchAll(/\bg\('([a-z-]+)'\)/g)].map((m) => m[1]!))];
    expect(anclas.length).toBeGreaterThan(25);
    const existe = (id: string) => id.startsWith('nav-') ? /data-guia=\{`nav-\$\{it\.slot\}`\}/.test(app)
      : id.startsWith('tab-') ? /data-guia=\{`tab-\$\{tab\.id\}`\}/.test(app)
        // `TuMesa` la pone sólo en el desplegable de consumos.
        : id === 'consumos' ? app.includes("data-guia={className === 'tus-consumos' ? 'consumos' : undefined}")
          : app.includes(`data-guia="${id}"`);
    expect(anclas.filter((id) => !existe(id))).toEqual([]);
  });

  it('todo círculo que nombra el recorrido tiene su `center.guia` (o es el de siempre)', () => {
    const centros = [...new Set([...recorrido.matchAll(/\bcentro\('([a-z-]+)'\)/g)].map((m) => m[1]!))];
    expect(centros.length).toBeGreaterThan(5);
    const faltan = centros.filter((id) => !['camara', 'continuar'].includes(id) && !app.includes(`guia: '${id}'`));
    expect(faltan).toEqual([]);
  });

  it('las clases, ids y etiquetas que usa como ancla existen tal cual (no como parte de otra clase)', () => {
    // Las clases de la app: cada palabra de cada `className` (literal, plantilla o expresión), comparada entera.
    const clases = new Set<string>();
    // Una expresión de className termina en el cierre de su plantilla; cada palabra en minúsculas cuenta entera.
    for (const m of app.matchAll(/className=(?:"([^"]*)"|\{(`[^`]*`|[^}\n]*)\})/g)) {
      for (const k of (m[1] ?? m[2] ?? '').split(/[^a-z0-9-]+/)) if (k) clases.add(k);
    }
    // Sólo los literales que SON selectores: empiezan con clase, id o `section[`.
    const selectores = [...recorrido.matchAll(/'((?:\.|#|section\[)[^'\n]*)'/g)].map((x) => x[1]!);
    const usadas = [...new Set(selectores.flatMap((x) => [...x.matchAll(/\.([a-z][a-z0-9-]*)/g)].map((y) => y[1]!)))];
    expect(usadas.length, 'no encontró las clases del recorrido').toBeGreaterThan(12);
    expect(usadas.filter((k) => !clases.has(k))).toEqual([]);
    // Una clase vecina con el mismo comienzo no la reemplaza.
    expect(clases.has('tip-block--pulse') && !clases.has('tip-blockx')).toBe(true);
    for (const id of [...new Set(selectores.flatMap((x) => [...x.matchAll(/#([a-z][a-z0-9-]*)/g)].map((y) => y[1]!)))]) {
      expect(app, `id ${id}`).toMatch(new RegExp(`\\bid="${id}"`));
    }
    for (const id of [...new Set(selectores.flatMap((x) => [...x.matchAll(/aria-labelledby="([a-z0-9-]+)"/g)].map((y) => y[1]!)))]) {
      expect(app, `etiqueta ${id}`).toMatch(new RegExp(`aria-labelledby="${id}"`));
      expect(app, `id ${id}`).toMatch(new RegExp(`\\bid="${id}"`));
    }
    // `.desplegable.solicitudes`: el desplegable recibe la clase por prop y la suma a `card desplegable`.
    expect(app).toContain('className="solicitudes"');
    expect(app).toMatch(/className=\{`card desplegable\$\{className \? ` \$\{className\}` : ''\}`\}/);
  });

  it('un recorrido en EN no deja nada en español', () => {
    const caps = [
      capitulo(ctx('home', [centro('camara'), g('tab-viajes'), g('mesa-abierta')], { destino: 'viaje', viajeDeHoy: 'Cancun' }), en),
      capitulo(ctx('mesa', [g('plato'), g('plato-tomado'), centro('listo-mesa')], { etapa: 'mesa', rol: 'invitado', modo: 'consumo' }), en),
    ];
    for (const p of caps.flatMap((c) => c.pasos)) {
      for (const texto of [p.titulo, p.texto, p.chip, p.nota]) if (texto) expect(texto, texto).not.toMatch(/[ñáéíóú¿¡]|\b(toca|mesa|Ahora)\b/i);
    }
  });
});
