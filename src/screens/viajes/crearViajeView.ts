import type { Friend } from '../../api/types';
import { arrobaCoincide, arrobaVisible, consultaValida, normalizarUsername, USERNAME_MIN, type ResultadoArroba } from '../../api/username';
import { MAX_MIEMBROS_VIAJE, type ErrorDeViaje, type MiembroPedido } from '../../api/viajes';
import { fold } from '../../utils/format';
import { iniciales, type T } from './viajesView';

/**
 * AF-VIAJES · D242 · 1d/1e · «Crear viaje», lo puro (sin React ni red).
 *
 * Quién puede entrar al viaje (contrato `POST /api/viajes`, D119): un amigo
 * aceptado, por su id, o alguien que la búsqueda por @ muestra, por su @. El
 * front no inventa a nadie: sólo arma el pedido con lo que vio en esas dos
 * fuentes. Nunca el correo: ni `Friend` ni `ResultadoArroba` lo traen.
 */

/** Yo + 19: el dueño admite `miembros` de 1 a 19 (`limites.miembros` = 20). */
export const MAX_AGREGADOS = MAX_MIEMBROS_VIAJE - 1;

/** Una persona que se puede sumar al viaje, venga de Amigos o de la búsqueda por @. */
export type Candidato =
  | {
    readonly tipo: 'amigo';
    /** Estable entre fuentes: `u:<id>` para un amigo, `@<usuario>` para el resto. */
    readonly clave: string;
    readonly user_id: string;
    readonly first_name: string;
    readonly last_name: string;
    readonly username: string | null;
  }
  | {
    readonly tipo: 'arroba';
    readonly clave: string;
    readonly username: string;
    readonly first_name: string;
    readonly last_name: string;
  };

export function candidatoDeAmigo(f: Friend): Candidato {
  return {
    tipo: 'amigo',
    clave: `u:${f.id}`,
    user_id: f.id,
    first_name: f.first_name,
    last_name: f.last_name,
    username: typeof f.username === 'string' ? f.username : null,
  };
}

export function candidatoDeArroba(r: ResultadoArroba): Candidato {
  return { tipo: 'arroba', clave: `@${r.username}`, username: r.username, first_name: r.first_name, last_name: r.last_name };
}

/** Lo que se ve de una persona en una fila: nombre, iniciales y su @ (o nada). */
export interface FilaDePersona {
  readonly clave: string;
  readonly nombre: string;
  readonly iniciales: string;
  readonly arroba: string | null;
}

export function filaDe(c: Candidato, arrobaHabilitada: boolean): FilaDePersona {
  const nombre = [c.first_name, c.last_name].map((x) => x.trim()).filter(Boolean).join(' ');
  return {
    clave: c.clave,
    nombre,
    iniciales: iniciales({ first_name: c.first_name, last_name: c.last_name, username: null, eliminada: false }),
    // Lo que muestra la búsqueda por @ ya es un @ (la capacidad estaba encendida al buscar).
    arroba: arrobaVisible(c.username, c.tipo === 'arroba' ? true : arrobaHabilitada),
  };
}

/** El texto del buscador, ya preparado: plegado (sin acentos, minúsculas) y como @. */
export interface Consulta {
  /** Sin espacios al borde: vacío = no se está buscando. */
  readonly texto: string;
  readonly plegado: string;
  /** Sin la «@» de adelante, para comparar con nombres. */
  readonly plegadoSinArroba: string;
  /** Lo que iría a `GET /api/users/search` (sin «@», minúsculas). */
  readonly arroba: string;
  /** ¿Vale como consulta por @? (3+ caracteres del alfabeto del @). */
  readonly consultable: boolean;
}

export function consultaDe(raw: string): Consulta {
  const texto = raw.trim();
  const plegado = fold(texto);
  const arroba = normalizarUsername(texto);
  return { texto, plegado, plegadoSinArroba: plegado.replace(/^@/, ''), arroba, consultable: consultaValida(arroba) };
}

/** ¿Coincide la persona con lo escrito? Por nombre (sin acentos) o por su @. */
export function coincide(c: Candidato, q: Consulta, arrobaHabilitada: boolean): boolean {
  if (!q.plegado) return false;
  const nombre = fold([c.first_name, c.last_name].join(' '));
  if (q.plegadoSinArroba && nombre.includes(q.plegadoSinArroba)) return true;
  return arrobaCoincide(c.username, c.tipo === 'arroba' ? true : arrobaHabilitada, q.plegado);
}

export interface Secciones {
  /** «En tus amigos»: amigos aceptados que coinciden y todavía no se agregaron. */
  readonly amigos: readonly Candidato[];
  /** «Otros usuarios de PayMe»: lo que trajo la búsqueda por @, sin amigos, sin agregados y sin mí. */
  readonly otros: readonly Candidato[];
  /** «Ya agregaste»: los agregados que coinciden (sin botón). */
  readonly yaAgregados: readonly Candidato[];
}

export function seccionesDeBusqueda({
  consulta, amigos, resultados, agregados, arrobaHabilitada, miUsername,
}: {
  readonly consulta: Consulta;
  readonly amigos: readonly Friend[];
  readonly resultados: readonly ResultadoArroba[];
  readonly agregados: readonly Candidato[];
  readonly arrobaHabilitada: boolean;
  /** Mi @ sin «@», si lo sé: la búsqueda por @ me puede encontrar a mí. */
  readonly miUsername: string | null;
}): Secciones {
  if (!consulta.texto) return { amigos: [], otros: [], yaAgregados: [] };
  const agregado = new Set(agregados.map((a) => a.clave));
  const arrobasAgregadas = new Set(agregados.map((a) => a.username).filter((u): u is string => !!u));
  const arrobasDeAmigos = new Set(amigos.map((f) => f.username).filter((u): u is string => typeof u === 'string' && !!u));

  const deAmigos = amigos.map(candidatoDeAmigo)
    .filter((c) => !agregado.has(c.clave) && coincide(c, consulta, arrobaHabilitada));
  // Un amigo encontrado por su @ va en «En tus amigos» (y viaja por su id), no acá.
  const otros = resultados.filter((r) => r.username !== miUsername
    && !arrobasDeAmigos.has(r.username) && !arrobasAgregadas.has(r.username)).map(candidatoDeArroba);
  const yaAgregados = agregados.filter((c) => coincide(c, consulta, arrobaHabilitada));
  return { amigos: deAmigos, otros, yaAgregados };
}

/** ¿Se escribió una «@» pero todavía no alcanza para buscar? (Menos de 3 letras.) */
export function arrobaCorta(q: Consulta): boolean {
  return q.texto.startsWith('@') && !q.consultable && q.arroba.length < USERNAME_MIN;
}

/** Un amigo va por su id; cualquier otro, por el @ que mostró la búsqueda (sin «@»). */
export function miembrosDelPedido(agregados: readonly Candidato[]): MiembroPedido[] {
  return agregados.map((c) => (c.tipo === 'amigo' ? { user_id: c.user_id } : { username: c.username }));
}

/** «Al» antes que «Del» (las dos son `YYYY-MM-DD`: se comparan como texto). */
export function fechasInvertidas(desde: string, hasta: string): boolean {
  return desde !== '' && hasta !== '' && hasta < desde;
}

export function puedeCrear({
  nombre, agregados, desde, hasta, enviando,
}: {
  readonly nombre: string;
  readonly agregados: readonly Candidato[];
  readonly desde: string;
  readonly hasta: string;
  readonly enviando: boolean;
}): boolean {
  return !enviando && nombre.trim().length > 0 && agregados.length >= 1 && agregados.length <= MAX_AGREGADOS
    && !fechasInvertidas(desde, hasta);
}

/** El pedido sin la llave: lo que el dueño compara para decidir si es «el mismo pedido». */
export interface ContenidoDelPedido {
  readonly nombre: string;
  readonly fecha_desde: string | null;
  readonly fecha_hasta: string | null;
  readonly miembros: readonly MiembroPedido[];
}

export function contenidoDelPedido(nombre: string, desde: string, hasta: string, agregados: readonly Candidato[]): ContenidoDelPedido {
  return { nombre: nombre.trim(), fecha_desde: desde || null, fecha_hasta: hasta || null, miembros: miembrosDelPedido(agregados) };
}

export interface LlaveDelPedido {
  readonly contenido: string;
  readonly clave: string;
}

/**
 * La llave de idempotencia: la MISMA para reintentar el mismo pedido (un
 * reintento tras una red caída no crea dos viajes) y una NUEVA si el pedido
 * cambió (el dueño responde 409 `idempotency_key_conflict` a la misma llave
 * con otro contenido).
 */
export function llaveParaElPedido(previa: LlaveDelPedido | null, contenido: ContenidoDelPedido, nueva: () => string): LlaveDelPedido {
  const json = JSON.stringify(contenido);
  return previa && previa.contenido === json ? previa : { contenido: json, clave: nueva() };
}

/** Lo que dice la pantalla cuando el dueño no creó el viaje. */
export function mensajeAlCrear(e: ErrorDeViaje, t: T): string {
  switch (e.tipo) {
    case 'miembro_no_encontrado':
      return e.username ? t('No encontramos a {0}. Revísalo.', `@${e.username}`) : t('No encontramos a esa persona. Revísalo.');
    case 'limite_miembros':
      return t('Un viaje admite hasta 20 personas.');
    case 'demasiadas_invitaciones':
      return t('Muchas invitaciones seguidas. Prueba en unos minutos.');
    default:
      return t('No pudimos guardarlo. Prueba de nuevo.');
  }
}

// ─── Lo que ve el buscador (1e) ───────────────────────────────────────────

/** La búsqueda por @: sin consulta, esperando, con lista, frenada por el dueño (429) o fallida. */
export type FaseDeBusqueda = 'quieta' | 'buscando' | 'lista' | 'limite' | 'error';

export interface VistaDeBusqueda {
  /** Lo escrito, sin espacios al borde (no vacío). */
  readonly texto: string;
  readonly amigos: readonly FilaDePersona[];
  readonly otros: readonly FilaDePersona[];
  readonly yaAgregados: readonly FilaDePersona[];
  /** D255-8 · Configuración: quienes ya están en el viaje (por su @), sin «Agregar». */
  readonly enElViaje?: readonly FilaDePersona[];
  readonly fase: FaseDeBusqueda;
  /** Una «@» con menos de 3 letras: todavía no se busca. */
  readonly arrobaCorta: boolean;
}

/** ¿No hay nada que mostrar para lo escrito? (Ni mientras se busca ni si la búsqueda falló.) */
export function sinResultados(b: VistaDeBusqueda): boolean {
  return b.amigos.length === 0 && b.otros.length === 0 && b.yaAgregados.length === 0
    && (b.enElViaje?.length ?? 0) === 0 && !b.arrobaCorta
    && (b.fase === 'quieta' || b.fase === 'lista');
}
