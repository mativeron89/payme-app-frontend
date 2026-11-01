/**
 * D622 · mejoras 2 y 3 · D628 · D639 · «los de la mesa» · App Backend 2.210.0
 * (`contract-mirror/contract/mesa-miembros-v1.json`, `payme.app.mesa_miembros/v1`).
 *
 * Con `members_version=1`, el detalle (`GET /api/mesas/:code`) suma `mesa.members`
 * y, en cada plato, `picked_by` y `picked_by_more`. El detalle se castea sin
 * decodificador, y el contrato pide leer estas claves «con un decodificador propio
 * que ignora lo que no entiende». Eso hace este módulo, como `miParte.ts`.
 *
 * Cada lectura falla CERRADO y nunca lanza:
 *   · `undefined`: la clave no vino, o vino con una forma que no cumple el
 *     contrato. Rige lo de hoy: «Lo eligió otro» y sin «Se sumaron N de M».
 *   · `null`: vino en null (quien mira tiene una invitación sin aceptar, o el
 *     dueño no pudo leerlo). También rige lo de hoy.
 *
 * Sólo salen del servidor la inicial, el orden de llegada y si es quien mira:
 * nunca el nombre, montos ni identificadores (D628). Este módulo no acepta una
 * ficha con una clave de más, así que un cambio futuro del dueño no puede
 * colar un nombre en la pantalla sin pasar por acá.
 */

/** Una persona de la mesa, como la manda el dueño: exactamente estas tres claves. */
export interface FichaDeMiembro {
  /** Orden de llegada (0 = organizador). No es un id: cambia de mesa a mesa. */
  readonly ordinal: number;
  /** De 1 a 2 letras, o «?» (cuenta eliminada, invitado sin cuenta o sin letras). */
  readonly initials: string;
  /** `true` sólo para quien mira. */
  readonly mine: boolean;
}

/** `mesa.members`. */
export interface Miembros {
  /** Participantes activos, incluido el organizador (≥ 1). */
  readonly joinedCount: number;
  /** Los esperados (`original_participants`, 1..50) o `null` en una mesa vieja. */
  readonly expectedCount: number | null;
  /** Hasta 12, por orden de llegada. */
  readonly fichas: readonly FichaDeMiembro[];
  /** Cuántos activos más hay fuera de `fichas`. */
  readonly mas: number;
}

/** `picked_by` y `picked_by_more` de un plato. */
export interface QuienesEligieron {
  /** Hasta 6, por orden de llegada; sólo quienes tienen una parte tomada. */
  readonly fichas: readonly FichaDeMiembro[];
  readonly mas: number;
}

/** Los topes del contrato (`lectura.topes`). */
export const TOPE_DE_LA_LISTA = 12;
export const TOPE_DE_QUIENES_ELIGIERON = 6;
/** `expected_count`: `original_participants` va de 1 a 50 (D375). */
const ESPERADOS_MAX = 50;

function registro(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

/** Exactamente esas claves PROPIAS y enumerables, ninguna más. */
function clavesExactas(r: Record<string, unknown>, claves: readonly string[]): boolean {
  const propias = Object.keys(r);
  return propias.length === claves.length && propias.every((k) => claves.includes(k));
}

function propia(r: Record<string, unknown>, clave: string): boolean {
  return Object.prototype.hasOwnProperty.call(r, clave);
}

function entero(v: unknown, min: number, max = Number.MAX_SAFE_INTEGER): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
}

/**
 * «?», o de 1 a 2 letras Unicode, ya en NFC. Una letra con su tilde suelta
 * (sin componer) no está en NFC y no se lee; un número, un punto o un espacio
 * tampoco: eso no es una inicial.
 */
function inicialesValidas(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  if (v === '?') return true;
  return v.normalize('NFC') === v && /^\p{L}{1,2}$/u.test(v);
}

function leerFicha(v: unknown): FichaDeMiembro | null {
  const r = registro(v);
  if (!r || !clavesExactas(r, ['ordinal', 'initials', 'mine'])) return null;
  if (!entero(r.ordinal, 0) || !inicialesValidas(r.initials) || typeof r.mine !== 'boolean') return null;
  return { ordinal: r.ordinal, initials: r.initials, mine: r.mine };
}

/** Una lista de fichas en orden de llegada estricto, con a lo sumo una de quien mira, y no más que el tope. */
function leerFichas(v: unknown, tope: number): FichaDeMiembro[] | null {
  if (!Array.isArray(v) || v.length > tope) return null;
  const fichas: FichaDeMiembro[] = [];
  for (const x of v) {
    const ficha = leerFicha(x);
    if (!ficha) return null;
    const anterior = fichas[fichas.length - 1];
    if (anterior && ficha.ordinal <= anterior.ordinal) return null;
    fichas.push(ficha);
  }
  if (fichas.filter((x) => x.mine).length > 1) return null;
  return fichas;
}

/** `mesa.members` del detalle. */
export function leerMiembros(mesa: unknown): Miembros | null | undefined {
  const m = registro(mesa);
  if (!m || !propia(m, 'members')) return undefined;
  if (m.members === null) return null;
  const r = registro(m.members);
  if (!r || !clavesExactas(r, ['joined_count', 'expected_count', 'list', 'list_more'])) return undefined;
  if (!entero(r.joined_count, 1) || !entero(r.list_more, 0)) return undefined;
  if (r.expected_count !== null && !entero(r.expected_count, 1, ESPERADOS_MAX)) return undefined;
  const fichas = leerFichas(r.list, TOPE_DE_LA_LISTA);
  if (!fichas) return undefined;
  // La lista y los que no entraron son los activos: ni uno más, ni uno menos.
  if (fichas.length + r.list_more !== r.joined_count) return undefined;
  if (r.list_more > 0 && fichas.length !== TOPE_DE_LA_LISTA) return undefined;
  return { joinedCount: r.joined_count, expectedCount: r.expected_count as number | null, fichas, mas: r.list_more };
}

/** `picked_by` y `picked_by_more` de un plato del detalle. Vienen las dos o ninguna, y en null las dos juntas. */
export function leerEligieron(item: unknown): QuienesEligieron | null | undefined {
  const i = registro(item);
  if (!i) return undefined;
  const conLista = propia(i, 'picked_by');
  const conMas = propia(i, 'picked_by_more');
  if (!conLista && !conMas) return undefined;
  if (!conLista || !conMas) return undefined;
  if (i.picked_by === null && i.picked_by_more === null) return null;
  if (!entero(i.picked_by_more, 0)) return undefined;
  const fichas = leerFichas(i.picked_by, TOPE_DE_QUIENES_ELIGIERON);
  if (!fichas) return undefined;
  if (i.picked_by_more > 0 && fichas.length !== TOPE_DE_QUIENES_ELIGIERON) return undefined;
  return { fichas, mas: i.picked_by_more };
}
