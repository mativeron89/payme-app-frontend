import { clasificarErrorDePropina, type TipSetting } from './miParte';

/**
 * D344 · el `PUT /api/mesas/:code/tip` en vuelo, FUERA de las pantallas.
 *
 * El organizador elige la propina en «Compartir la mesa» y puede irse de ahí
 * antes de que el dueño conteste (con «Continuar», con la barra o desde Inicio):
 * `CreateMesaFlow` se desmonta y se llevaría el reintento. Por eso el pedido y
 * su estado viven acá, con clave cuenta + código, y «Tu mesa» lo lee para no
 * dejar elegir platos mientras se guarda (contrato, `escritura.cliente`).
 *
 * Reintento (orden D344 y respuestas de V, punto 3): sólo ante fallas
 * transitorias —red, timeout, 5xx y 429—, hasta 3 intentos, 8 s por intento y
 * esperas de 1 s y 2 s. Un 400, 403, 404 o 409 es una respuesta fija: no se
 * reintenta. El PUT es idempotente («repetir el mismo valor da lo mismo»).
 *
 * Dos elecciones seguidas: el pedido no lleva versión, así que no se mandan
 * dos a la vez. La última espera a que termine la anterior y sale después;
 * las intermedias se descartan (gana la última que eligió la persona).
 */

export const INTENTOS_DE_PROPINA = 3;
export const TIMEOUT_DE_PROPINA_MS = 8_000;
export const ESPERAS_DE_PROPINA_MS: readonly number[] = [1_000, 2_000];

export interface ClaveDePropina {
  /** El id de la cuenta que eligió: otra cuenta en el mismo teléfono no ve ni hereda el estado. */
  readonly cuenta: string;
  readonly code: string;
}

export type EstadoDePropina =
  | { readonly fase: 'quieta' }
  /** El pedido salió o espera para reintentar. `deseado` es lo que eligió la persona. */
  | { readonly fase: 'guardando'; readonly deseado: TipSetting | null; readonly intento: number }
  | { readonly fase: 'guardada'; readonly setting: TipSetting | null }
  /** Se agotaron los reintentos de una falla transitoria. Se puede volver a intentar. */
  | { readonly fase: 'agotada'; readonly deseado: TipSetting | null }
  /** Una respuesta fija del dueño (400/403/404/409, u otro 4xx). */
  | {
    readonly fase: 'rechazada';
    readonly deseado: TipSetting | null;
    readonly status: number | null;
    readonly codigo: string | null;
  };

/** Lo que hace falta para mandar un pedido: la fachada real o la del mock. */
export type EnviarPropina = (code: string, setting: TipSetting | null, timeoutMs: number) => Promise<TipSetting | null>;

export interface DependenciasDePropina {
  readonly enviar: EnviarPropina;
  /** Espera entre intentos; las pruebas la reemplazan para no dormir. */
  readonly esperar?: (ms: number) => Promise<void>;
  /** La cuenta con sesión en este momento. Si cambia en medio, se deja de reintentar. */
  readonly cuentaActual?: () => string | null;
}

const QUIETA: EstadoDePropina = Object.freeze({ fase: 'quieta' });

interface Entrada {
  estado: EstadoDePropina;
  /** El procesamiento en curso: resuelve con el estado final de la ÚLTIMA elección. */
  enCurso: Promise<EstadoDePropina> | null;
  /** La elección que espera turno, o `undefined` si no hay. */
  siguiente: { readonly deseado: TipSetting | null } | undefined;
}

const entradas = new Map<string, Entrada>();
const oyentes = new Set<() => void>();

function claveDe(clave: ClaveDePropina): string {
  return `${clave.cuenta}\u0000${clave.code}`;
}

function entradaDe(clave: ClaveDePropina): Entrada {
  const k = claveDe(clave);
  let entrada = entradas.get(k);
  if (!entrada) {
    entrada = { estado: QUIETA, enCurso: null, siguiente: undefined };
    entradas.set(k, entrada);
  }
  return entrada;
}

function avisar(): void {
  for (const oyente of [...oyentes]) {
    // Un oyente que falla no corta el aviso a los demás ni el pedido en curso.
    try { oyente(); } catch { /* el estado ya quedó escrito */ }
  }
}

function fijar(entrada: Entrada, estado: EstadoDePropina): void {
  entrada.estado = estado;
  avisar();
}

/** El estado de la propina de esa mesa para esa cuenta. Nunca lanza. */
export function estadoDePropina(clave: ClaveDePropina | null): EstadoDePropina {
  if (!clave) return QUIETA;
  return entradas.get(claveDe(clave))?.estado ?? QUIETA;
}

/** Para `useSyncExternalStore`: avisa en cada cambio de cualquier mesa. */
export function suscribirPropina(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => { oyentes.delete(oyente); };
}

/** ¿Se está guardando? Mientras tanto, no se eligen platos en esa mesa. */
export function guardandoPropina(clave: ClaveDePropina | null): boolean {
  return estadoDePropina(clave).fase === 'guardando';
}

const esperaReal = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Guarda la propina elegida. Resuelve con el estado final de la ÚLTIMA
 * elección de esa mesa: si llega otra mientras ésta sale, la que vale es la
 * nueva. No lanza: todo resultado queda en el estado, que es lo que leen las
 * pantallas.
 */
export function guardarPropinaDeLaMesa(
  clave: ClaveDePropina,
  deseado: TipSetting | null,
  deps: DependenciasDePropina,
): Promise<EstadoDePropina> {
  const entrada = entradaDe(clave);
  entrada.siguiente = { deseado };
  fijar(entrada, { fase: 'guardando', deseado, intento: 0 });
  if (!entrada.enCurso) entrada.enCurso = procesar(clave, entrada, deps);
  return entrada.enCurso;
}

/**
 * 🔴 `enCurso` se libera en el MISMO paso en que el bucle ve que no queda nada.
 * Con un `.finally` encadenado afuera había un hueco de microtareas entre los
 * dos: una elección que llegaba ahí encontraba `enCurso` todavía ocupado, se
 * quedaba en `siguiente` y nadie la mandaba (lo midió la revisión de los tests).
 */
async function procesar(clave: ClaveDePropina, entrada: Entrada, deps: DependenciasDePropina): Promise<EstadoDePropina> {
  try {
    let final: EstadoDePropina = entrada.estado;
    while (entrada.siguiente) {
      const { deseado } = entrada.siguiente;
      entrada.siguiente = undefined;
      final = await unPedido(clave, entrada, deseado, deps);
    }
    return final;
  } finally {
    entrada.enCurso = null;
  }
}

/**
 * Un pedido con sus reintentos. Si mientras tanto la persona eligió otra
 * propina, éste no publica su resultado: el bucle de `procesar` sigue con la
 * nueva, sin un «guardada» viejo en el medio que haría recargar la pantalla
 * con la propina anterior.
 */
async function unPedido(
  clave: ClaveDePropina,
  entrada: Entrada,
  deseado: TipSetting | null,
  deps: DependenciasDePropina,
): Promise<EstadoDePropina> {
  const esperar = deps.esperar ?? esperaReal;
  for (let intento = 1; intento <= INTENTOS_DE_PROPINA; intento += 1) {
    if (deps.cuentaActual && cuentaDistinta(deps.cuentaActual, clave.cuenta)) {
      // Otra sesión en el medio: no se manda nada a su nombre, ni lo que esperaba turno.
      entrada.siguiente = undefined;
      fijar(entrada, QUIETA);
      return QUIETA;
    }
    fijar(entrada, { fase: 'guardando', deseado, intento });
    try {
      const setting = await deps.enviar(clave.code, deseado, TIMEOUT_DE_PROPINA_MS);
      if (entrada.siguiente) return entrada.estado;
      const final: EstadoDePropina = { fase: 'guardada', setting };
      fijar(entrada, final);
      return final;
    } catch (err) {
      if (entrada.siguiente) return entrada.estado;
      const { clase, status, codigo } = clasificarErrorDePropina(err);
      if (clase === 'fijo') {
        const final: EstadoDePropina = { fase: 'rechazada', deseado, status, codigo };
        fijar(entrada, final);
        return final;
      }
      const espera = ESPERAS_DE_PROPINA_MS[intento - 1];
      if (intento < INTENTOS_DE_PROPINA && espera !== undefined) {
        // Una espera que falla no deja la mesa en «guardando»: se sigue con el próximo intento.
        try { await esperar(espera); } catch { /* sin espera */ }
        if (entrada.siguiente) return entrada.estado;
      }
    }
  }
  const final: EstadoDePropina = { fase: 'agotada', deseado };
  fijar(entrada, final);
  return final;
}

/** Si no se puede saber qué cuenta tiene la sesión, no se manda nada a nombre de nadie. */
function cuentaDistinta(cuentaActual: () => string | null, cuenta: string): boolean {
  try {
    return cuentaActual() !== cuenta;
  } catch {
    return true;
  }
}

/** Sólo para pruebas: vuelve todo a cero. */
export function olvidarPropinasParaPruebas(): void {
  entradas.clear();
  avisar();
}
