import { useEffect, useSyncExternalStore } from 'react';
import { MemoriaDeCuenta } from './memoriaDeCuenta';
import { ultimoVisto } from './ultimoVisto';
import { aplicarCapacidadDeRecomendaciones } from './sugerencias';

/**
 * D550/D553/D554 · el agente gastronómico, etapa E1 (comensal base) · consumidor del dueño App Backend 2.208.0
 * (`contract/agente-e1-v1.schema.json`), publicado APAGADO por dos banderas del dueño:
 * - `RECOMENDACIONES_CERCA_ENABLED`: «Lo de siempre, cerca», el presupuesto del mes y el aviso «Es tu hora»;
 * - `CALIFICACIONES_ENABLED`: la calificación con un toque al cerrar la mesa.
 * Apagada, cada ruta contesta 404 `not_found` sin leer nada. `GET /api/agente/estado` dice cuáles están encendidas.
 *
 * 🔴 Las puertas, en este orden:
 * 1. el estado del dueño (`/agente/estado`), leído UNA vez por sesión. Ausente (backend anterior: 404), mal formado o
 *    con red caída: todo apagado. Con todo apagado no se pide nada más y no se dibuja nada;
 * 2. el permiso `recomendaciones` de la persona (R-2 a, Configuración › Privacidad). Sin él, la tarjeta de Inicio no se
 *    pide ni se muestra (el dueño contestaría 403 `permission_required`). El presupuesto no lo pide (vista propia).
 *
 * 🔴 La ubicación (R-4 a): se pide al navegador SÓLO al tocar «Ver lugares cerca», se redondea acá a 3 decimales (unos
 * 110 m, lo mismo que hace el dueño) y viaja en el CUERPO de un POST, nunca en la URL. No se guarda: ni storage, ni
 * memoria de la cuenta, ni estado de la pantalla. De los locales sólo se muestra lo que el dueño publica: nombre,
 * cocina, distancia, nivel y estrellas propias; nunca dirección ni coordenadas (el contrato no las trae).
 */

export const RUTA_ESTADO_AGENTE = '/agente/estado';
export const RUTA_PARA_VOS = '/agente/para-vos';
export const RUTA_CERCA = '/agente/cerca';
export const RUTA_PRESUPUESTO = '/agente/presupuesto';
export const PERMISO_RECOMENDACIONES = 'recomendaciones';

/** La calificación de una mesa: el código se escapa (guarda C-03). */
export function rutaDeCalificacion(code: string): string {
  return `/agente/mesas/${encodeURIComponent(code)}/calificacion`;
}

function record(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null;
}
function keys(v: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(v).length === expected.length && expected.every((k) => Object.prototype.hasOwnProperty.call(v, k));
}
const entero = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const malFormado = (que: string) => new Error(`agente_${que}_malformed`);

// ─── El estado del dueño ───────────────────────────────────────────────────────

export interface EstadoDelAgente {
  readonly recomendaciones: boolean;
  readonly calificaciones: boolean;
}
export const AGENTE_APAGADO: EstadoDelAgente = Object.freeze({ recomendaciones: false, calificaciones: false });

/** `{recomendaciones:{enabled}, calificaciones:{enabled}}`, de claves exactas. Otra forma ⇒ error. */
export function decodeEstadoDelAgente(value: unknown): EstadoDelAgente {
  const enabled = (v: unknown): boolean => {
    if (!record(v) || !keys(v, ['enabled']) || typeof v.enabled !== 'boolean') throw malFormado('estado');
    return v.enabled;
  };
  if (!record(value) || !keys(value, ['recomendaciones', 'calificaciones'])) throw malFormado('estado');
  return { recomendaciones: enabled(value.recomendaciones), calificaciones: enabled(value.calificaciones) };
}

/**
 * El estado de la sesión, en memoria y con dueño (`MemoriaDeCuenta`): se borra al cambiar la cuenta. `null` = todavía
 * no se sabe; mientras no se sabe, nada se dibuja.
 */
const memoriaDelEstado = new MemoriaDeCuenta<EstadoDelAgente>();
let enVuelo: Promise<EstadoDelAgente> | null = null;
const oyentes = new Set<() => void>();
const avisar = () => { for (const o of [...oyentes]) o(); };
// Al cambiar la sesión (cerrar, entrar, otra cuenta) se olvida también la lectura en vuelo: la respuesta de la cuenta
// anterior no se guarda para la nueva, y las pantallas vuelven a preguntar.
ultimoVisto.alVaciarse(() => { enVuelo = null; avisar(); });

/**
 * Lee el estado una vez (single-flight). Un error cuenta como apagado y queda guardado así: con el dueño caído no se
 * reintenta en cada pantalla, y al cambiar la sesión se vuelve a preguntar.
 */
export function asegurarEstadoDelAgente(leer: () => Promise<EstadoDelAgente>): Promise<EstadoDelAgente> {
  const guardado = memoriaDelEstado.leer();
  if (guardado) return Promise.resolve(guardado);
  if (enVuelo) return enVuelo;
  // La fila «Recomendaciones» de Configuración usa la misma lectura: encendida se otorga, apagada sólo se revoca, y
  // sin el estado (backend anterior, forma rara o red) no hay fila.
  const nuevo = leer().then(
    (estado) => { aplicarCapacidadDeRecomendaciones(estado.recomendaciones); return estado; },
    () => { aplicarCapacidadDeRecomendaciones(null); return AGENTE_APAGADO; },
  ).then((estado) => {
    if (enVuelo === nuevo) {
      memoriaDelEstado.guardar(estado);
      enVuelo = null;
      avisar();
    }
    return estado;
  });
  enVuelo = nuevo;
  return nuevo;
}

function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => { oyentes.delete(oyente); };
}
const instantanea = (): EstadoDelAgente | null => memoriaDelEstado.leer();

/**
 * El estado del agente para una pantalla: lo pide (una vez por sesión) con `leer` y devuelve `null` mientras no se
 * sabe. Sin sesión, `null` siempre.
 */
export function useEstadoDelAgente(leer: (() => Promise<EstadoDelAgente>) | null): EstadoDelAgente | null {
  const estado = useSyncExternalStore(suscribir, instantanea, instantanea);
  useEffect(() => {
    if (leer && estado === null) void asegurarEstadoDelAgente(leer);
  }, [leer, estado]);
  return leer ? estado : null;
}

/** Sólo para tests. */
export function reiniciarEstadoDelAgenteParaTests(): void {
  memoriaDelEstado.olvidar();
  enVuelo = null;
  oyentes.clear();
}

// ─── El presupuesto del mes (R-13 a) ──────────────────────────────────────────

export interface PresupuestoDelMes {
  /** El de este mes: el que editó la persona o su promedio. `null` sin promedio ni edición. */
  readonly montoCents: number | null;
  readonly origen: 'editado' | 'automatico' | null;
  /** El promedio de los últimos 3 meses completos (con los meses sin consumo adentro); `null` sin consumo. */
  readonly promedioCents: number | null;
  /** Lo del mes en curso, con la misma cuenta que `consumption_month`. */
  readonly gastadoCents: number;
  readonly basis: 'consumption' | 'payments';
}

const MONTO_MINIMO_CENTS = 100;
const MONTO_MAXIMO_CENTS = 100_000_000;

/** El monto que acepta `PUT /presupuesto` (centavos enteros, de 100 a 100.000.000). */
export function montoDePresupuestoValido(cents: number): boolean {
  return entero(cents) && cents >= MONTO_MINIMO_CENTS && cents <= MONTO_MAXIMO_CENTS;
}

/**
 * La forma exacta del dueño, con su coherencia: `editado` trae monto; `automatico` es el promedio; sin origen no hay
 * monto ni promedio. Otra cosa ⇒ error (y la tarjeta no se muestra: un presupuesto inventado es peor que ninguno).
 */
export function decodePresupuesto(value: unknown): PresupuestoDelMes {
  if (!record(value) || !keys(value, ['monto_cents', 'origen', 'promedio_cents', 'gastado_cents', 'basis'])) {
    throw malFormado('presupuesto');
  }
  const { monto_cents: monto, origen, promedio_cents: promedio, gastado_cents: gastado, basis } = value;
  const centsONull = (v: unknown) => v === null || (entero(v) && v >= 0);
  if (!centsONull(monto) || !centsONull(promedio) || !entero(gastado) || gastado < 0
      || (basis !== 'consumption' && basis !== 'payments')
      || (origen !== 'editado' && origen !== 'automatico' && origen !== null)) throw malFormado('presupuesto');
  if (origen === 'editado' && monto === null) throw malFormado('presupuesto');
  if (origen === 'automatico' && (monto === null || monto !== promedio)) throw malFormado('presupuesto');
  if (origen === null && (monto !== null || promedio !== null)) throw malFormado('presupuesto');
  return {
    montoCents: monto as number | null, origen, promedioCents: promedio as number | null,
    gastadoCents: gastado, basis,
  };
}

// ─── «Para vos» ───────────────────────────────────────────────────────────────

export type Franja = 'madrugada' | 'desayuno' | 'comida' | 'cena';
const FRANJAS: readonly Franja[] = ['madrugada', 'desayuno', 'comida', 'cena'];

export interface TuPlato {
  readonly nombre: string;
  readonly visitas: number;
}

export interface ParaVos {
  readonly franjaHabitual: Franja | null;
  readonly esTuHora: boolean;
  readonly platos: readonly TuPlato[];
  readonly presupuesto: PresupuestoDelMes;
}

function decodePlato(v: unknown, que: string): TuPlato {
  if (!record(v) || !keys(v, ['nombre', 'visitas']) || typeof v.nombre !== 'string' || !v.nombre.trim()
      || !entero(v.visitas) || v.visitas < 3) throw malFormado(que);
  return { nombre: v.nombre, visitas: v.visitas };
}

export function decodeParaVos(value: unknown): ParaVos {
  if (!record(value) || !keys(value, ['franja_habitual', 'es_tu_hora', 'platos', 'presupuesto'])) throw malFormado('para_vos');
  const { franja_habitual: franja, es_tu_hora: esTuHora, platos } = value;
  if ((franja !== null && !FRANJAS.includes(franja as Franja)) || typeof esTuHora !== 'boolean'
      || !Array.isArray(platos) || platos.length > 3) throw malFormado('para_vos');
  return {
    franjaHabitual: franja as Franja | null,
    esTuHora,
    platos: platos.map((p) => decodePlato(p, 'para_vos')),
    presupuesto: decodePresupuesto(value.presupuesto),
  };
}

// ─── «Lo de siempre, cerca» ───────────────────────────────────────────────────

export interface EstrellasPropias {
  /** El promedio de PayMe, redondeado a un decimal por el dueño (de 1 a 5). */
  readonly promedio: number;
  /** Cuentas distintas que calificaron: 3 o más (R-6 a). */
  readonly cuentas: number;
}

export interface LugarCerca {
  readonly ref: string;
  readonly nombre: string;
  /** Una cocina del catálogo (`contract/cocinas-v1.json`), o `null` si no se sabe. */
  readonly cocina: string | null;
  /** Redondeada a 50 m por el dueño. */
  readonly distanciaM: number;
  /** «Se pide en PayMe» (confirmado) o «Probable». */
  readonly nivel: 'confirmado' | 'probable';
  readonly estrellas: EstrellasPropias | null;
}

export interface PlatoCerca extends TuPlato {
  readonly lugares: readonly LugarCerca[];
}

export interface Cerca {
  readonly radioM: 1000 | 3000;
  readonly platos: readonly PlatoCerca[];
  readonly atribucion: { readonly textos: readonly string[]; readonly urls: readonly string[] };
}

/** «Cerca» no sirve para volcar el catálogo: como mucho 10 lugares entre todos los platos (`x-tope`). */
export const MAX_LUGARES_CERCA = 10;

function decodeLugar(v: unknown): LugarCerca {
  if (!record(v) || !keys(v, ['ref', 'nombre', 'cocina', 'distancia_m', 'nivel', 'estrellas'])) throw malFormado('cerca');
  const { ref, nombre, cocina, distancia_m: distancia, nivel, estrellas } = v;
  if (typeof ref !== 'string' || !ref || typeof nombre !== 'string' || !nombre.trim()
      || (cocina !== null && typeof cocina !== 'string')
      || !entero(distancia) || distancia < 50 || distancia % 50 !== 0
      || (nivel !== 'confirmado' && nivel !== 'probable')) throw malFormado('cerca');
  let propias: EstrellasPropias | null = null;
  if (estrellas !== null) {
    if (!record(estrellas) || !keys(estrellas, ['promedio', 'cuentas'])
        || typeof estrellas.promedio !== 'number' || !Number.isFinite(estrellas.promedio)
        || estrellas.promedio < 1 || estrellas.promedio > 5
        || !entero(estrellas.cuentas) || estrellas.cuentas < 3) throw malFormado('cerca');
    propias = { promedio: estrellas.promedio, cuentas: estrellas.cuentas };
  }
  return { ref, nombre, cocina, distanciaM: distancia, nivel, estrellas: propias };
}

function decodeAtribucion(v: unknown): Cerca['atribucion'] {
  const textos = (a: unknown) => Array.isArray(a) && a.every((s) => typeof s === 'string');
  if (!record(v) || !keys(v, ['textos', 'urls']) || !textos(v.textos) || !textos(v.urls)) throw malFormado('cerca');
  // Los enlaces se filtran al dibujar (`enlaceDeAtribucion`): sólo `https:` llega a un `href`.
  return { textos: v.textos as string[], urls: v.urls as string[] };
}

export function decodeCerca(value: unknown): Cerca {
  if (!record(value) || !keys(value, ['radio_m', 'platos', 'atribucion'])) throw malFormado('cerca');
  const { radio_m: radio, platos } = value;
  if ((radio !== 1000 && radio !== 3000) || !Array.isArray(platos) || platos.length > 3) throw malFormado('cerca');
  const decodificados = platos.map((p): PlatoCerca => {
    if (!record(p) || !keys(p, ['nombre', 'visitas', 'lugares']) || !Array.isArray(p.lugares) || p.lugares.length > 5) {
      throw malFormado('cerca');
    }
    const base = decodePlato({ nombre: p.nombre, visitas: p.visitas }, 'cerca');
    return { ...base, lugares: p.lugares.map(decodeLugar) };
  });
  if (decodificados.reduce((n, p) => n + p.lugares.length, 0) > MAX_LUGARES_CERCA) throw malFormado('cerca');
  return { radioM: radio, platos: decodificados, atribucion: decodeAtribucion(value.atribucion) };
}

/** Un enlace de atribución se dibuja como enlace sólo si es `https:`. */
export function enlaceDeAtribucion(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

// ─── La ubicación del momento (R-4 a) ─────────────────────────────────────────

export interface Ubicacion {
  readonly lat: number;
  readonly lon: number;
}

/** A 3 decimales (unos 110 m), como el dueño. Fuera de rango o no finita ⇒ `null`: no se manda. */
export function redondearUbicacion(lat: number, lon: number): Ubicacion | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const r = (n: number) => {
    const v = Math.round(n * 1000) / 1000;
    return Object.is(v, -0) ? 0 : v;
  };
  return { lat: r(lat), lon: r(lon) };
}

export type ResultadoDeUbicacion =
  | { readonly tipo: 'ok'; readonly ubicacion: Ubicacion }
  | { readonly tipo: 'negada' }
  | { readonly tipo: 'no_disponible' };

interface Geolocalizador {
  getCurrentPosition(
    ok: (p: { readonly coords: { readonly latitude: number; readonly longitude: number } }) => void,
    error: (e: { readonly code: number }) => void,
    opciones: { readonly enableHighAccuracy: boolean; readonly timeout: number; readonly maximumAge: number },
  ): void;
}

/**
 * Pide la ubicación una vez, con el permiso del navegador. Baja precisión a propósito: alcanza con unos 100 m, y se
 * redondea antes de salir de esta función. Sin la API, o con un error que no sea la negativa: `no_disponible`.
 */
export function pedirUbicacion(geo: Geolocalizador | undefined = globalThis.navigator?.geolocation): Promise<ResultadoDeUbicacion> {
  if (!geo || typeof geo.getCurrentPosition !== 'function') return Promise.resolve({ tipo: 'no_disponible' });
  return new Promise((resolve) => {
    try {
      geo.getCurrentPosition(
        (p) => {
          const u = redondearUbicacion(p.coords.latitude, p.coords.longitude);
          resolve(u ? { tipo: 'ok', ubicacion: u } : { tipo: 'no_disponible' });
        },
        // 1 = PERMISSION_DENIED.
        (e) => resolve(e.code === 1 ? { tipo: 'negada' } : { tipo: 'no_disponible' }),
        { enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 },
      );
    } catch {
      resolve({ tipo: 'no_disponible' });
    }
  });
}

// ─── La calificación (D553, funcionalidad 8) ──────────────────────────────────

export interface CalificacionDeMesa {
  readonly estrellas: 1 | 2 | 3 | 4 | 5;
  readonly creadaEn: string;
  readonly actualizadaEn: string;
}

export function estrellasValidas(n: number): n is CalificacionDeMesa['estrellas'] {
  return entero(n) && n >= 1 && n <= 5;
}

/** `{calificacion: null | {estrellas, creada_en, actualizada_en}}`, de claves exactas. */
export function decodeCalificacion(value: unknown): CalificacionDeMesa | null {
  if (!record(value) || !keys(value, ['calificacion'])) throw malFormado('calificacion');
  const c = value.calificacion;
  if (c === null) return null;
  const fecha = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
  if (!record(c) || !keys(c, ['estrellas', 'creada_en', 'actualizada_en']) || typeof c.estrellas !== 'number'
      || !estrellasValidas(c.estrellas) || !fecha(c.creada_en) || !fecha(c.actualizada_en)) throw malFormado('calificacion');
  return { estrellas: c.estrellas, creadaEn: c.creada_en, actualizadaEn: c.actualizada_en };
}

/** El cambio pedido tiene que ser el que el dueño confirma; si no, error. */
export function confirmarCalificacion(value: unknown, estrellas: number): CalificacionDeMesa {
  const c = decodeCalificacion(value);
  if (c === null || c.estrellas !== estrellas) throw new Error('agente_calificacion_unconfirmed');
  return c;
}

// ─── El aviso de la campana ───────────────────────────────────────────────────

export const AVISO_ES_TU_HORA = 'agente_tu_hora';
/** El destino del aviso: Inicio, con la tarjeta a la vista (`/home/cerca`). */
export const PARAM_TARJETA_CERCA = 'cerca';
