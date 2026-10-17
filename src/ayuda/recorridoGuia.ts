import type { PageId } from '../router';
import type { SenalDeGuia } from './senalesGuia';

/**
 * D341-M2 · «Tu turno»: un solo recorrido por capítulos en lugar de un catálogo
 * por pantalla. Este archivo es lógica pura: recibe lo que la pantalla describe
 * (página, `data-guia-etapa/-rol/-modo`, qué anclas se ven, si hay pagos) y
 * devuelve el capítulo y sus pasos. No lee el DOM, no navega, no llama a nadie.
 *
 * Los textos son los de la propuesta aprobada (`PROPUESTA_TUTORIAL_D341.md`,
 * sha256 a8f90f61…d878). Los títulos van sin el punto final de la tabla.
 */
export type T = (s: string, ...args: unknown[]) => string;
/** `si`: pagos con tarjeta encendidos. `no`: apagados por el dueño. `pendiente`: todavía sin dato o mal formado. */
export type Pagos = 'si' | 'no' | 'pendiente';
/** `mira`: Siguiente. `tu-turno`: Entendido y se achica. `final`: Terminar guía. `espera`: fuera del recorrido. */
export type TipoDePaso = 'mira' | 'tu-turno' | 'final' | 'espera';
/** El mapa Foto → Dividir → Invitar → Elegir (→ Pagar). Sólo en el restaurante. */
export type EtapaDelMapa = 'foto' | 'dividir' | 'invitar' | 'elegir' | 'pagar';

export interface Paso {
  readonly id: string;
  /** Selector CSS del control real. `null`: la burbuja va sin control. */
  readonly ancla: string | null;
  readonly tipo: TipoDePaso;
  readonly titulo: string;
  readonly texto: string;
  /** La línea de la versión achicada («Tu turno: toca Continuar»). */
  readonly chip: string | null;
  /** El recordatorio de la casilla, aparte del texto. */
  readonly nota: string | null;
  /** Aplica ahora: su control se ve (o no necesita uno) y la regla del capítulo lo admite. */
  readonly presente: boolean;
  /** Ya se cumplió (apareció lo que sigue, por ejemplo el selector de porción): la guía avanza sola. */
  readonly cumplido: boolean;
}

export interface Capitulo {
  readonly id: string;
  readonly etapa: EtapaDelMapa | null;
  readonly pasos: readonly Paso[];
}

export interface ContextoDeGuia {
  readonly pagina: PageId;
  readonly etapa: string | null;
  readonly rol: string | null;
  readonly modo: string | null;
  /** Lo que publica el círculo de Inicio por las fechas de los viajes (D276). */
  readonly destino: string | null;
  readonly viajeDeHoy: string | null;
  readonly pagos: Pagos;
  /** El último guardado que avisó una pantalla, si todavía no se mostró su final. */
  readonly final: SenalDeGuia | null;
  /** ¿Hay un elemento visible que cumpla este selector? */
  readonly hay: (selector: string) => boolean;
}

const g = (id: string) => `[data-guia="${id}"]`;
const centro = (id: string) => `.appbar-center[data-guia="${id}"]`;
const CAMARA = centro('camara');
/** «Crear viaje» es el primer lanzador de la pestaña Viajes (D266/D302); su test fija el HTML, así que va por posición. */
export const CREAR_VIAJE = '.vj-lanzadores > .vj-lanzador:first-child';
const escapar = (v: string) => v.replace(/["\\]/g, '\\$&');

interface Opciones { readonly chip?: string; readonly nota?: string; readonly si?: boolean; readonly avanzaCon?: string }

function armar(c: ContextoDeGuia) {
  return (id: string, ancla: string | null, tipo: TipoDePaso, titulo: string, texto: string, o: Opciones = {}): Paso => ({
    id, ancla, tipo, titulo, texto,
    chip: o.chip ?? null,
    nota: o.nota ?? null,
    presente: (o.si ?? true) && (ancla === null || c.hay(ancla)),
    cumplido: o.avanzaCon !== undefined && c.hay(o.avanzaCon),
  });
}

function recordatorio(t: T) {
  return t('¿No quieres ver la guía al entrar? Marca «No volver a mostrar».');
}

export function capituloEspera(c: ContextoDeGuia, t: T): Capitulo {
  const p = armar(c);
  const casa = g('nav-home');
  return { id: 'espera', etapa: null, pasos: [
    p('espera', c.hay(casa) ? casa : null, 'espera', t('La guía te espera'),
      t('Esta pantalla no es parte de la guía. Toca Inicio para seguir, o abre tu mesa o tu viaje.')),
  ] };
}

function bienvenida(c: ContextoDeGuia, t: T): Capitulo {
  const p = armar(c);
  const turno = c.destino === 'viaje' && c.viajeDeHoy
    ? t('Ahora: toca Escanear y saca la foto. Hoy estás en las fechas de {0}: el ticket va a ese viaje.', c.viajeDeHoy)
    : c.destino === 'elegir-viaje'
      ? t('Ahora: toca Escanear. Hoy tienes más de un viaje en fechas: PayMe te pregunta a cuál va el ticket.')
      : t('Ahora: toca Escanear y saca la foto del ticket. Después: revisas los platos y eligen cómo dividir.');
  return { id: 'bienvenida', etapa: 'foto', pasos: [
    p('apertura', CAMARA, 'mira', t('Así se divide la cuenta en PayMe'), c.pagos === 'si'
      ? t('Sacas la foto del ticket, cada quien elige lo que comió desde su teléfono y paga su parte con tarjeta. Te mostramos cómo, mientras lo haces.')
      : t('Sacas la foto del ticket, cada quien elige lo que comió desde su teléfono y PayMe calcula cuánto le toca a cada uno. Te mostramos cómo, mientras lo haces.')),
    p('viajes', g('tab-viajes'), 'mira', t('¿Van de viaje?'),
      t('En Viajes juntan los tickets y gastos de todo el viaje, y PayMe lleva la cuenta de quién puso cuánto.')),
    p('mesa-abierta', g('mesa-abierta'), 'mira', t('Tienes una mesa abierta'),
      t('Tócala para elegir lo tuyo o ver el avance de la cuenta.')),
    p('escanear', CAMARA, 'tu-turno', t('Empieza con el ticket'), turno, { chip: t('Tu turno: toca Escanear') }),
  ] };
}

function finalDeMesa(c: ContextoDeGuia, t: T, mesa: string): Capitulo {
  const p = armar(c);
  const tarjeta = `${g('mesa-abierta')}[data-guia-mesa="${escapar(mesa)}"]`;
  const nota = recordatorio(t);
  return { id: 'final-mesa', etapa: 'elegir', pasos: [
    p('tarjeta', tarjeta, 'final', t('Así queda tu mesa'),
      t('La tarjeta muestra el avance de la cuenta. Tócala cuando quieras para revisar lo tuyo.'), { nota }),
    // Mientras la lista de mesas carga (o si no llega), la burbuja no desaparece: apunta a Mesas.
    p('mesas', g('nav-mesas'), 'final', t('Así queda tu mesa'),
      t('Puedes verla en Mesas cuando quieras para revisar lo tuyo.'), { nota, si: !c.hay(tarjeta) }),
  ] };
}

function viajesEnInicio(c: ContextoDeGuia, t: T): Capitulo {
  const p = armar(c);
  return { id: 'viajes-inicio', etapa: null, pasos: [
    p('viaje', '.viaje-burbuja', 'mira', t('Tu viaje abierto'),
      t('Tócalo para cargar tickets y ver tu balance. Con + Gasto cargas un gasto a mano.')),
    p('pendiente', '.viaje-pendiente', 'mira', t('Aquí falta elegir'),
      t('Todavía faltan personas por elegir lo suyo. Tócalo para elegir lo tuyo.')),
    p('crear', CREAR_VIAJE, 'tu-turno', t('Crea un viaje'),
      t('Ahora: toca Crear viaje. Después: le pones nombre y sumas a quienes van.'), { chip: t('Tu turno: toca Crear viaje') }),
  ] };
}

function camara(c: ContextoDeGuia, t: T): Capitulo {
  const p = armar(c);
  const enViaje = c.etapa?.startsWith('viaje-') ?? false;
  const etapa = enViaje ? null : 'foto';
  if (c.etapa === 'recorte' || c.etapa === 'viaje-recorte') {
    return { id: 'recorte', etapa, pasos: [
      p('usar-foto', g('usar-foto'), 'tu-turno', t('¿Se ve todo el ticket?'),
        t('Ahora: deja sólo el ticket dentro del marco y toca Usar foto. Después: PayMe lee los platos y el total.'),
        { chip: t('Tu turno: toca Usar foto') }),
    ] };
  }
  return { id: 'foto', etapa, pasos: [
    p('sacar-foto', g('camara-controles'), 'tu-turno', t('Saca la foto del ticket'),
      t('Ahora: saca la foto del ticket completo, de cerca y con luz. ¿Ya tienes la foto? Elígela de la galería. Después: ajustas el marco.'),
      { chip: t('Tu turno: saca la foto del ticket') }),
  ] };
}

function dividir(c: ContextoDeGuia, t: T): Capitulo {
  const p = armar(c);
  const consumo = c.modo === 'consumo';
  // Con el riel pendiente o mal formado, el texto no promete garantía ni link: sólo el paso.
  const despues = c.pagos === 'si'
    ? t('Ahora: toca Continuar. Después: dejas una tarjeta como garantía de la mesa.')
    : c.pagos === 'no'
      ? t('Ahora: toca Continuar. Después: PayMe abre la mesa y te da el link para invitar.')
      : t('Ahora: toca Continuar.');
  return { id: 'dividir', etapa: 'dividir', pasos: [
    p('revisar', `${g('revisar-ticket')}:not(:disabled)`, 'mira', t('Revisa lo que leyó PayMe'),
      t('Toca Ver el ticket para corregir un plato o una cantidad, o agregar uno que falte.')),
    p('reparto', g('reparto'), 'mira', t('Elijan cómo dividir'),
      t('Por lo que pidió cada uno: cada quien elige sus platos. En partes iguales: el total entre todos. Pagar el total: uno o varios cubren la cuenta.')),
    p('personas', g('personas'), 'mira', consumo ? t('¿Cuántos son?') : t('¿Cuántos pagan?'), consumo
      ? t('Elige con − y + cuántos son en la mesa, tú incluido. Con este reparto, el monto de abajo es sólo la base de propina por persona.')
      : t('Elige con − y + cuántos pagan. PayMe divide el total entre ellos.')),
    p('continuar', centro('continuar'), 'tu-turno', t('Abre la mesa'), despues, { chip: t('Tu turno: toca Continuar') }),
  ] };
}

function garantia(c: ContextoDeGuia, t: T): Capitulo {
  const p = armar(c);
  if (c.etapa === 'banco') {
    return { id: 'banco', etapa: 'dividir', pasos: [
      p('confirmar', centro('confirmar-banco'), 'tu-turno', t('Confirma con tu banco'),
        t('Ahora: toca Confirmar y sigue lo que te pida tu banco. Después: compartes la mesa.'), { chip: t('Tu turno: toca Confirmar') }),
    ] };
  }
  return { id: 'garantia', etapa: 'dividir', pasos: [
    p('tarjetas', g('garantia-tarjeta'), 'mira', t('Tu tarjeta respalda la mesa'),
      t('Se retiene el total hasta que todos paguen. No es un cobro: si alguien no paga a tiempo, cubre lo que falte.')),
    p('garantizar', centro('garantizar'), 'tu-turno', t('Garantiza la mesa'),
      t('Ahora: elige o agrega una tarjeta y toca Garantizar. Después: tu banco puede pedirte confirmar.'), { chip: t('Tu turno: toca Garantizar') }),
  ] };
}

function invitar(c: ContextoDeGuia, t: T): Capitulo {
  const p = armar(c);
  return { id: 'invitar', etapa: 'invitar', pasos: [
    p('compartir', g('compartir'), 'mira', t('Invita a la mesa'),
      t('Manda el link por WhatsApp o dales el código. Quien no tiene PayMe crea su cuenta gratis desde el link.')),
    p('seguir', centro('continuar-compartir'), 'tu-turno', t('Ahora lo tuyo'),
      t('Ahora: toca Continuar. Después: entras a tu mesa para elegir lo que comiste.'), { chip: t('Tu turno: toca Continuar') }),
  ] };
}

function mesa(c: ContextoDeGuia, t: T): Capitulo {
  const p = armar(c);
  if (c.hay(g('ver-avisos'))) {
    return { id: 'mesa-invitacion', etapa: 'elegir', pasos: [
      p('aceptar', g('ver-avisos'), 'tu-turno', t('Primero, acepta'),
        t('Para elegir lo tuyo, primero acepta la invitación a esta mesa en Avisos.'), { chip: t('Tu turno: toca Ver avisos') }),
    ] };
  }
  const org = c.rol === 'organizador';
  const consumo = c.modo === 'consumo';
  const antes = org ? '' : `${t('Cada quien elige lo suyo desde su teléfono.')} `;
  const candado = c.hay(g('plato-tomado')) ? ` ${t('Los platos con candado ya los eligió otra persona.')}` : '';
  return { id: 'mesa', etapa: 'elegir', pasos: [
    p('solicitudes', '.desplegable.solicitudes', 'mira', t('Quieren unirse'),
      t('Alguien pidió entrar con el código. Acéptalo aquí para que elija lo suyo.'), { si: org }),
    p('invitar', g('invitar'), 'mira', t('¿Falta alguien?'),
      t('Invita a tus amigos de PayMe desde aquí o dales el código de la mesa.'), { si: org }),
    p('consumos', `${g('consumos')}[aria-expanded="false"]`, 'tu-turno', t('Abre tus consumos'),
      t('Ahora: toca Tus consumos para ver los platos del ticket.'), { si: org, chip: t('Tu turno: toca Tus consumos') }),
    p('plato', g('plato'), 'mira', consumo ? t('Toca lo que comiste') : t('Marca lo que comiste'), antes + (consumo
      ? t('Ahora: toca cada plato que comiste. Si lo compartieron, eliges tu porción.')
      : t('En partes iguales tu parte ya está calculada. Marcar tus platos es opcional y no cambia lo que te toca.')) + candado,
    { avanzaCon: g('porcion') }),
    p('porcion', g('porcion'), 'mira', t('¿Cuánto comiste?'),
      t('Elige tu porción del plato compartido. Si te equivocas, toca Soltar.')),
    p('mi-parte', g('mi-parte'), 'mira', t('Tu parte'), consumo
      ? t('Es la suma de lo que elegiste y cambia cada vez que tocas un plato.')
      : t('Es tu parte igual de la cuenta.')),
    p('cerrar', g('cerrar-mesa'), 'mira', t('Cuando terminen'),
      t('Cuando todos hayan elegido, puedes cerrar la mesa aquí. Después de cerrarla ya no se puede modificar.'), { si: org }),
    p('listo', centro('listo-mesa'), 'tu-turno', c.pagos === 'si' ? t('Confirma y paga') : t('Confirma lo tuyo'), c.pagos === 'si'
      ? t('Ahora: toca Listo. Después: eliges la propina y pagas tu parte.')
      : t('Ahora: toca Listo para guardar lo que elegiste. Después: vuelves a Inicio.'), { chip: t('Tu turno: toca Listo') }),
  ] };
}

/** La vista de pago (sólo con pagos). Sus anclas son clases que ya existen: el bloque de P36 no se toca. */
function pagar(c: ContextoDeGuia, t: T): Capitulo {
  const p = armar(c);
  const congelado = c.hay(`.appbar-center[aria-label="${escapar(t('Reintentar el pago sin confirmar'))}"]`);
  return { id: 'pagar', etapa: 'pagar', pasos: [
    p('propina', '.tip-block', 'mira', t('Elige la propina'),
      t('Elige un porcentaje, 0% incluido, u Otro para escribir el monto. Sin elegirla no se puede pagar.')),
    p('mesero', '.tip-recipient-card', 'mira', t('¿Para quién es?'),
      t('Si quieres, elige al mesero que te atendió. Puedes dejarlo sin elegir.')),
    p('pagar', centro('continuar'), 'tu-turno', t('Paga tu parte'), congelado
      ? t('Hay un pago sin confirmar. Reinténtalo aquí: se manda el mismo pago, no uno nuevo.')
      : t('Ahora: revisa el Total a pagar y toca Pagar. Después: ves tu comprobante.'),
    { chip: congelado ? t('Tu turno: reintenta el pago') : t('Tu turno: toca Pagar') }),
  ] };
}

function viaje(c: ContextoDeGuia, t: T): Capitulo {
  const p = armar(c);
  return { id: 'viaje', etapa: null, pasos: [
    p('balance-propio', g('mi-balance'), 'mira', t('Tu balance'),
      t('Es lo que pagaste menos lo que te corresponde consumir. A favor: pusiste de más. En negativo: te falta cubrir esa parte.')),
    p('balance', g('balance'), 'mira', t('El balance del viaje'),
      t('Aquí ves los consumos por lugar y cuánto pagó cada quien.')),
    p('gasto', g('agregar-gasto'), 'mira', t('¿Sin ticket?'),
      t('Toca Agregar gasto para escribir qué fue, cuánto costó y quién pagó.')),
    p('configuracion', '.vjv-titulo-engranaje', 'mira', t('Al terminar el viaje'),
      t('Quien creó el viaje lo cierra desde aquí. Entonces PayMe propone quién le transfiere a quién; el dinero lo mueven ustedes.')),
    p('escanear', CAMARA, 'tu-turno', t('Carga un ticket'),
      t('Ahora: toca Escanear y saca la foto. Después: eliges quién pagó y cómo lo dividen.'), { chip: t('Tu turno: toca Escanear') }),
    // Esperando pagos (D242): sus botones fijan el HTML en sus tests, así que van por clase.
    p('ya-pague', '.vjv-tr-destacada > .btn-navy', 'mira', t('Transfiere y avisa'),
      t('PayMe no mueve el dinero: haz la transferencia por tu cuenta y toca Ya pagué.')),
    p('recibi', '.vjv-tr-botones > .btn-navy, .vjv-tr-pie > .btn', 'mira', t('¿Te llegó?'),
      t('Cuando veas la transferencia, toca Recibí.')),
  ] };
}

function finalDeViaje(c: ContextoDeGuia, t: T): Capitulo {
  const p = armar(c);
  return { id: 'final-viaje', etapa: null, pasos: [
    p('balance', g('mi-balance'), 'final', t('Así va tu viaje'),
      t('Cada ticket o gasto mueve tu balance. Cuando terminen, quien creó el viaje lo cierra.'), { nota: recordatorio(t) }),
  ] };
}

function viajeNuevo(c: ContextoDeGuia, t: T): Capitulo {
  const p = armar(c);
  return { id: 'viaje-nuevo', etapa: null, pasos: [
    p('nombre', '#vjc-nombre', 'mira', t('Ponle nombre'),
      t('Por ejemplo, «Cancún 2026». Las fechas son opcionales: con las dos, mientras dure el viaje, Escanear te lleva a este viaje.')),
    p('miembros', 'section[aria-labelledby="vjc-miembros"]', 'mira', t('Suma a quienes van'),
      t('Búscalos entre tus amigos o por su @. Cada quien acepta la invitación desde Avisos.')),
    p('crear', '.vjc .vj-pie > .btn-navy', 'tu-turno', t('Crea el viaje'),
      t('Ahora: toca Crear viaje; se activa con nombre y al menos otra persona. Después: entras al viaje.'), { chip: t('Tu turno: toca Crear viaje') }),
  ] };
}

const QUIEN_PAGO = (t: T) => t('Viene marcado Tú. Si pagó otra persona, o varias, cámbialo aquí.');

function ticketNuevo(c: ContextoDeGuia, t: T): Capitulo {
  const p = armar(c);
  return { id: 'ticket-nuevo', etapa: null, pasos: [
    p('quien-pago', g('quien-pago'), 'mira', t('¿Quién pagó?'), QUIEN_PAGO(t)),
    p('reparto', g('reparto'), 'mira', t('¿Cómo lo dividen?'),
      t('Por lo que pidió cada uno: cada quien elige lo suyo. En partes iguales: entre los que estuvieron. Pagar el total: invitas tú y nadie te debe.')),
    p('presentes', 'section[aria-labelledby="vjt-quienes"]', 'mira', t('¿Quiénes estuvieron?'),
      t('Vienen todos marcados. Desmarca a quien no estuvo: sólo los marcados entran en el reparto.')),
    p('compartir', '.vj-pie > .btn-navy', 'tu-turno', t('Súmalo al viaje'),
      t('Ahora: toca Compartir con el viaje. Después: eliges tus platos y los demás, los suyos desde su teléfono.'),
      { chip: t('Tu turno: toca Compartir con el viaje') }),
  ] };
}

function consumosDelTicket(c: ContextoDeGuia, t: T): Capitulo {
  const p = armar(c);
  return { id: 'ticket-consumo', etapa: null, pasos: [
    p('plato', g('elegir-consumo'), 'mira', t('Toca lo que comiste'),
      t('Ahora: toca cada plato que comiste. Si lo compartieron, eliges tu porción.'), { avanzaCon: g('porcion') }),
    p('porcion', g('porcion'), 'mira', t('¿Cuánto comiste?'),
      t('Elige tu porción del plato compartido. Si te equivocas, toca Soltar.')),
    p('mi-parte', g('mi-parte'), 'mira', t('Lo que te toca'),
      t('Es la suma de lo que elegiste y cambia cada vez que tocas un plato.')),
    p('listo', g('listo-consumos'), 'tu-turno', t('Guarda lo tuyo'),
      t('Ahora: toca Listo. Después: vuelves a donde estabas y tu balance se actualiza.'), { chip: t('Tu turno: toca Listo') }),
  ] };
}

function gasto(c: ContextoDeGuia, t: T): Capitulo {
  const p = armar(c);
  return { id: 'gasto', etapa: null, pasos: [
    p('que', g('descripcion-gasto'), 'mira', t('¿Qué fue?'), t('Escribe qué pagaste.')),
    p('cuanto', g('monto-gasto'), 'mira', t('¿Cuánto costó?'), t('Escribe el total.')),
    p('quien-pago', g('quien-pago'), 'mira', t('¿Quién pagó?'), QUIEN_PAGO(t)),
    p('entre', g('entre-quienes'), 'mira', t('¿Entre quiénes?'),
      t('Marca entre quiénes se divide. Si quedas sólo tú y pagaste tú, es un gasto personal: sólo lo ves tú.')),
    p('guardar', g('guardar-gasto'), 'tu-turno', t('Guarda el gasto'),
      t('Ahora: toca Listo; se activa con descripción, monto y reparto. Después: vuelves a donde estabas.'), { chip: t('Tu turno: toca Listo') }),
  ] };
}

function balanceDelViaje(c: ContextoDeGuia, t: T): Capitulo {
  const p = armar(c);
  return { id: 'balance', etapa: null, pasos: [
    p('consumos', g('tab-consumos'), 'mira', t('Consumos'), t('Aquí están los consumos del viaje. Abre uno para revisar su ticket y reparto.')),
    p('miembros', g('tab-miembros'), 'mira', t('Miembros'), t('Esta pestaña muestra cuánto pagó cada persona, no cuánto le corresponde consumir.')),
  ] };
}

function resolver(c: ContextoDeGuia, t: T): Capitulo {
  const f = c.final;
  switch (c.pagina) {
    case 'home':
      if (f?.tipo === 'mesa-guardada' && !f.cerrada) return finalDeMesa(c, t, f.mesa);
      return c.hay(CREAR_VIAJE) ? viajesEnInicio(c, t) : bienvenida(c, t);
    case 'scan':
      if (c.etapa === 'ticket') return dividir(c, t);
      if (c.etapa === 'garantia' || c.etapa === 'banco') return garantia(c, t);
      if (c.etapa === 'compartir') return invitar(c, t);
      return c.etapa ? camara(c, t) : capituloEspera(c, t);
    case 'mesa': {
      if (c.hay(centro('ir-inicio'))) {
        const p = armar(c);
        return { id: 'pagado', etapa: 'pagar', pasos: [
          p('pagado', centro('ir-inicio'), 'final', t('¡Pagaste tu parte!'),
            t('Puedes enviar o descargar el comprobante.'), { nota: recordatorio(t) }),
        ] };
      }
      if (f?.tipo === 'mesa-guardada' && f.cerrada) {
        const p = armar(c);
        const casa = g('nav-home');
        return { id: 'mesa-cerrada', etapa: 'elegir', pasos: [
          p('cerrada', c.hay(casa) ? casa : null, 'final', t('La mesa se cerró'),
            t('Ya no se puede modificar. Puedes verla en Mesas.'), { nota: recordatorio(t) }),
        ] };
      }
      if (c.hay('.tip-block')) return pagar(c, t);
      return c.etapa === 'mesa' ? mesa(c, t) : capituloEspera(c, t);
    }
    case 'viaje':
      return f?.tipo === 'viaje-guardado' ? finalDeViaje(c, t) : viaje(c, t);
    case 'viaje-nuevo': return viajeNuevo(c, t);
    case 'viaje-ticket-nuevo': return ticketNuevo(c, t);
    case 'viaje-ticket': return consumosDelTicket(c, t);
    case 'viaje-gasto': return gasto(c, t);
    case 'viaje-balance': return balanceDelViaje(c, t);
    default: return capituloEspera(c, t);
  }
}

/** El capítulo que corresponde a lo que se ve. Si ningún paso aplica todavía, la guía espera en vez de desaparecer. */
export function capituloDe(c: ContextoDeGuia, t: T): Capitulo {
  const cap = resolver(c, t);
  return cap.pasos.some((p) => p.presente) ? cap : capituloEspera(c, t);
}

/** Dónde está la persona dentro del recorrido. Vive en memoria: no se guarda en ningún lado. */
export interface EstadoDeGuia {
  readonly capitulo: string;
  readonly paso: string | null;
  /** Después de «Entendido»: la burbuja es una línea y la persona hace el paso. */
  readonly plegado: boolean;
  /** La persona ya movió la guía en este capítulo (Siguiente, Atrás, Entendido). */
  readonly tocado: boolean;
}
export const ESTADO_INICIAL: EstadoDeGuia = { capitulo: '', paso: null, plegado: false, tocado: false };

/**
 * El paso vigente. Otro capítulo empieza desde su primer paso; si el paso actual
 * dejó de aplicar o ya se cumplió, sigue con el próximo que aplique (y si no
 * hay, vuelve al anterior). Mientras la persona no movió la guía, un paso
 * anterior que recién aparece (la pantalla terminó de cargar) pasa adelante.
 * Devuelve el MISMO objeto si nada cambia.
 */
export function siguienteEstado(cap: Capitulo, e: EstadoDeGuia): EstadoDeGuia {
  const primero = cap.pasos.find((p) => p.presente && !p.cumplido) ?? cap.pasos.find((p) => p.presente);
  if (e.capitulo !== cap.id) return { capitulo: cap.id, paso: primero?.id ?? null, plegado: false, tocado: false };
  const i = cap.pasos.findIndex((p) => p.id === e.paso);
  const actual = i >= 0 ? cap.pasos[i] : undefined;
  if (actual && actual.presente && !actual.cumplido) {
    return e.tocado || !primero || primero.id === e.paso ? e : { ...e, paso: primero.id, plegado: false };
  }
  const despues = i >= 0 ? cap.pasos.slice(i + 1).find((p) => p.presente && !p.cumplido) : undefined;
  const antes = i >= 0 ? [...cap.pasos.slice(0, i)].reverse().find((p) => p.presente) : undefined;
  const nuevo = (despues ?? antes ?? primero)?.id ?? null;
  // Avanzar porque la persona hizo el paso cuenta como movida: no se vuelve al principio.
  return nuevo === e.paso && !e.plegado ? e : { capitulo: cap.id, paso: nuevo, plegado: false, tocado: true };
}

/** Los pasos que aplican, en orden: el contador cuenta sólo éstos. */
export function pasosPresentes(cap: Capitulo): readonly Paso[] {
  return cap.pasos.filter((p) => p.presente);
}

/** El vecino que aplica, hacia adelante (+1) o hacia atrás (−1). */
export function vecino(cap: Capitulo, paso: string | null, sentido: 1 | -1): Paso | null {
  const lista = pasosPresentes(cap);
  const i = lista.findIndex((p) => p.id === paso);
  return i < 0 ? null : lista[i + sentido] ?? null;
}
