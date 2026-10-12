import type { Idioma } from '../../i18n/idioma';
import type { Apartado, EntradaDeNotas, ErrorDeNotas, ListaConTildes, Pizarron } from '../../api/viajesNotas';
import { unirNombres } from './viajeView';
import { fechaCortaViaje, nombreDePila, type T } from './viajesView';

/**
 * D290 · lo puro del pizarrón de notas (`NotasScreen`): los resúmenes, los contadores y el orden de la vista con muchas
 * personas. Sin React ni red. Todo texto visible sale por `t()`.
 */

/** «1 nota, 1 lista», «2 notas», «1 lista»; sin nada, `null` (cada apartado dice lo suyo). */
export function resumenDeEntradas(entradas: readonly EntradaDeNotas[], t: T): string | null {
  const notas = entradas.filter((e) => e.tipo === 'nota').length;
  const listas = entradas.length - notas;
  const partes = [
    notas === 1 ? t('1 nota') : notas > 1 ? t('{0} notas', notas) : null,
    listas === 1 ? t('1 lista') : listas > 1 ? t('{0} listas', listas) : null,
  ].filter((x): x is string => x !== null);
  return partes.length > 0 ? partes.join(', ') : null;
}

/** «2 de 4»: los ítems tildados de la lista. */
export function tildadosDeLista(lista: Pick<ListaConTildes, 'items'>, t: T): string {
  return t('{0} de {1}', lista.items.filter((i) => i.tildado).length, lista.items.length);
}

/** Desde el 80 % del tope, el contador pasa a píldora ámbar (PANTALLA §3). */
export const cercaDelTope = (n: number, tope: number): boolean => n >= Math.ceil(tope * 0.8);

export interface Contador {
  readonly texto: string;
  /** Desde el 80 %: la píldora ámbar. */
  readonly cerca: boolean;
  /** En el tope: ya no deja escribir ni agregar. */
  readonly tope: boolean;
}

/**
 * El contador de una nota (PANTALLA §3): «120 / 500»; desde el 80 %, «Te quedan 38»; en el tope, «Llegaste a 500».
 * Un título o un ítem (80) muestra el contador sólo desde el 80 %: `null` antes.
 */
export function contadorDeTexto(largo: number, tope: number, t: T, { siempre }: { siempre: boolean }): Contador | null {
  const cerca = cercaDelTope(largo, tope);
  if (!cerca && !siempre) return null;
  if (largo >= tope) return { texto: t('Llegaste a {0}', tope), cerca: true, tope: true };
  return cerca
    ? { texto: t('Te quedan {0}', tope - largo), cerca: true, tope: false }
    : { texto: t('{0} / {1}', largo, tope), cerca: false, tope: false };
}

/** El contador de ítems de una lista: «3 / 30 ítems»; en el tope, «Llegaste a 30 ítems». Desde el 80 %, ámbar. */
export function contadorDeItems(n: number, tope: number, t: T): Contador {
  if (n >= tope) return { texto: t('Llegaste a {0} ítems', tope), cerca: true, tope: true };
  return { texto: t('{0} / {1} ítems', n, tope), cerca: cercaDelTope(n, tope), tope: false };
}

/** PANTALLA §4: con 6 o más personas, la tira de fotos y las filas plegadas. */
export const MUCHAS_PERSONAS = 6;

export interface VistaDeMuchos {
  readonly mio: Apartado | null;
  /** «Con notas»: el último que escribió primero (el orden del dueño). */
  readonly conNotas: readonly Apartado[];
  /** «Sin notas todavía», en el orden de los miembros. */
  readonly sinNotas: readonly Apartado[];
}

/** Separa el pizarrón como lo publica el dueño: el mío, los que escribieron y los que no. No reordena. */
export function vistaDeMuchos(apartados: readonly Apartado[]): VistaDeMuchos {
  const otros = apartados.filter((a) => !a.es_yo);
  return {
    mio: apartados.find((a) => a.es_yo) ?? null,
    conNotas: otros.filter((a) => a.entradas.length > 0),
    sinNotas: otros.filter((a) => a.entradas.length === 0),
  };
}

/** «Pablo, Rosa, Iván, Lucía y Toño»: los de «Sin notas todavía», por su nombre de pila. */
export function nombresEnUnaLinea(apartados: readonly Apartado[], t: T): string {
  return unirNombres(apartados.map((a) => nombreDePila(a, t)), t);
}

/** El día en que se cerró, en hora de México (UTC−6 fijo, como el contrato): «18 ago». `null` sin fecha. */
export function fechaDeCierre(cerradoEn: string | null, idioma: Idioma): string | null {
  if (cerradoEn === null) return null;
  const ms = Date.parse(cerradoEn);
  if (Number.isNaN(ms)) return null;
  return fechaCortaViaje(new Date(ms - 6 * 3_600_000).toISOString().slice(0, 10), idioma);
}

/** El parámetro del apartado de otro: `<viaje>.<miembro>` (un UUID no tiene puntos), como el del ticket. */
export function parametroDeApartado(viajeId: string, miembroId: string): string {
  return `${viajeId}.${miembroId}`;
}

/** `<viaje>` o `<viaje>.<miembro>`; cualquier otra forma, `null`. */
export function leerParametroDeNotas(param: string | null): { viajeId: string; miembroId: string | null } | null {
  if (!param) return null;
  const partes = param.split('.');
  if (partes.length > 2 || partes.some((p) => p.length === 0)) return null;
  return { viajeId: partes[0]!, miembroId: partes[1] ?? null };
}

/**
 * La clave de idempotencia de una nota nueva: una por intento de guardar, la MISMA si se reintenta lo mismo (un doble
 * toque o una respuesta que no llegó), así el dueño no crea dos.
 */
export function nuevaClaveDeNota(): string {
  return `nota-${crypto.randomUUID()}`;
}

// ─── Qué hace la pantalla ante cada respuesta del dueño ──────────────────

/** Qué escribía: crear o editar (con la hoja abierta), borrar o tildar (sin hoja). */
export type AccionDeNotas = 'crear' | 'editar' | 'borrar' | 'tildar';

export interface Reaccion {
  /** El 404 del viaje (n325): la pantalla pasa a «no disponible». */
  readonly noDisponible?: boolean;
  /** Volver a leer el pizarrón (lo que se ve quedó viejo). */
  readonly refrescar?: boolean;
  /** El apartado que trajo el 409: se aplica sin otro pedido. `null` si no vino bien: se refresca. */
  readonly apartado?: Apartado | null;
  readonly cerrarHoja: boolean;
  /** El texto, en la hoja si sigue abierta; si no, en un aviso. */
  readonly mensaje: string | null;
  /** La clave de idempotencia ya se usó con otro pedido: el próximo intento lleva una nueva. */
  readonly nuevaClave?: boolean;
}

/** Los `message` del 400 del dueño (`notas` del contrato), en palabras. Uno que no conocemos: `null`. */
function mensajeDelInvalido(m: string, t: T): string | null {
  switch (m) {
    case 'texto_vacio': return t('Escribe algo para guardar.');
    case 'texto_max_500': return t('Una nota puede tener hasta 500 caracteres.');
    case 'texto_control': return t('Hay un carácter que no se puede guardar. Bórralo y prueba de nuevo.');
    case 'titulo_max_80': return t('El título puede tener hasta 80 caracteres.');
    case 'item_max_80': return t('Cada ítem puede tener hasta 80 caracteres.');
    case 'items_min_1': return t('La lista necesita al menos un ítem.');
    case 'items_max_30': return t('Una lista puede tener hasta 30 ítems.');
    default: return null;
  }
}

/**
 * La orden, punto 6: cada error del dueño, explicado. El 409 de versión trae mi apartado: se aplica y, editando, la hoja
 * sigue abierta con lo que escribí (si guardo otra vez, reemplazo la versión de ahora); borrando, no borra lo que cambió.
 */
export function reaccionAlError(e: ErrorDeNotas, accion: AccionDeNotas, tipo: 'nota' | 'lista', t: T): Reaccion {
  const conHoja = accion === 'crear' || accion === 'editar';
  switch (e.tipo) {
    case 'no_disponible':
      return { noDisponible: true, cerrarHoja: true, mensaje: null };
    case 'nota_no_encontrada':
      return { refrescar: true, cerrarHoja: true, mensaje: t('Ya no estaba') };
    case 'no_es_tuya':
      return { refrescar: true, cerrarHoja: true, mensaje: t('Sólo puedes cambiar lo tuyo.') };
    case 'cuenta_suspendida':
      return { refrescar: true, cerrarHoja: true, mensaje: t('Tu cuenta está suspendida. Escríbenos.') };
    case 'no_abierto':
      return { refrescar: true, cerrarHoja: true, mensaje: t('El viaje ya no está abierto') };
    case 'otra_version':
    case 'otro_orden':
      if (accion === 'editar') {
        return { apartado: e.apartado, refrescar: e.apartado === null, cerrarHoja: false,
          mensaje: tipo === 'nota'
            ? t('Esta nota cambió en otro lado. Si guardas, reemplazas esa versión.')
            : t('Esta lista cambió en otro lado. Si guardas, reemplazas esa versión.') };
      }
      return { apartado: e.apartado, refrescar: e.apartado === null, cerrarHoja: true,
        mensaje: t('Cambió en otro lado. Mira cómo quedó antes de borrarla.') };
    case 'clave_repetida':
      return { nuevaClave: true, cerrarHoja: false, mensaje: t('No pudimos guardarla. Prueba de nuevo.') };
    case 'tope_de_entradas':
      return { refrescar: true, cerrarHoja: false, mensaje: t('Llegaste al tope de {0} notas y listas. Borra una para sumar otra.', e.limite) };
    case 'invalido': {
      const conocido = e.mensajes.map((m) => mensajeDelInvalido(m, t)).find((x): x is string => x !== null);
      return { cerrarHoja: false, mensaje: conocido ?? t('No pudimos guardarla. Revisa el texto y prueba de nuevo.') };
    }
    case 'item_desconocido':
      return { refrescar: true, cerrarHoja: true, mensaje: t('La lista cambió en otro lado. Vuelve a editarla.') };
    default:
      if (accion === 'tildar') return { cerrarHoja: false, mensaje: t('No pudimos tildarlo. Prueba de nuevo.') };
      if (accion === 'borrar') return { cerrarHoja: false, mensaje: t('No pudimos borrarla. Prueba de nuevo.') };
      return { cerrarHoja: !conHoja, mensaje: t('No pudimos guardarla. Prueba de nuevo.') };
  }
}

/** El pizarrón con mi apartado nuevo: el mío sigue primero y `escribieron` se recuenta (las reglas del dueño). */
export function conMiApartado(p: Pizarron, mio: Apartado): Pizarron {
  if (!p.apartados.some((a) => a.es_yo && a.miembro_id === mio.miembro_id)) return p;
  const apartados = p.apartados.map((a) => (a.es_yo ? mio : a));
  return { ...p, apartados, escribieron: apartados.filter((a) => a.entradas.length > 0).length };
}
