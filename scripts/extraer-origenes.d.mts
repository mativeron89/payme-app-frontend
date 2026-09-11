/**
 * Tipos de `extraer-origenes.mjs` — el gate de origen, sin efectos al importarse.
 *
 * Es un `.mjs` a propósito: el entrypoint se invoca con `node` desde un alias npm y
 * desde el gate, sin pasar por el bundler. Sus tipos se declaran acá en vez de usar
 * `as any` en el test, que el gobierno del repo prohíbe — misma convención que
 * `aliasesLib.d.mts`.
 */

/** Hosts que son la propia máquina. Todo lo demás se enumera como externo. */
export const HOSTS_LOOPBACK: readonly string[];

/**
 * Los cinco veredictos posibles. Tres de ellos NO son «cero red externa»:
 * dos dicen que el instrumento no trajo datos y uno que no pudo acreditarse.
 */
export const VEREDICTOS: Readonly<{
  SIN_TRACES: 'INSTRUMENTO_SIN_DATOS_CERO_TRACES';
  SIN_URLS: 'INSTRUMENTO_SIN_DATOS_CERO_URLS';
  SIN_CONTROL: 'INSTRUMENTO_NO_ACREDITADO_FALTA_ORIGEN_ESPERADO';
  LIMPIO: 'MEDIDO_SOLO_LOOPBACK_CERO_ORIGENES_EXTERNOS';
  EXTERNOS: 'MEDIDO_CON_ORIGENES_NO_LOOPBACK';
}>;

export type Veredicto = (typeof VEREDICTOS)[keyof typeof VEREDICTOS];

export interface OrigenObservado {
  readonly origen: string;
  readonly requests: number;
  readonly loopback: boolean;
}

export interface Clasificacion {
  readonly veredicto: Veredicto;
  readonly control_positivo_ok: boolean;
  readonly origenes: readonly OrigenObservado[];
  readonly origenes_no_loopback: readonly OrigenObservado[];
  readonly esquemas_sin_red: readonly { readonly esquema: string; readonly ocurrencias: number }[];
  readonly urls_no_parseables: readonly string[];
}

export interface DetalleDeTrace {
  readonly zip: string;
  readonly entradas_del_zip: number;
  readonly entradas_de_red: readonly string[];
  readonly lineas_red: number;
  readonly urls_extraidas: number;
}

export interface Informe extends Clasificacion {
  readonly instrumento: string;
  readonly acredita: string;
  readonly no_acredita: string;
  readonly medido_utc: string;
  readonly directorio_analizado: string;
  readonly origen_esperado_control_positivo: string;
  readonly totales: {
    readonly traces_hallados: number;
    readonly traces_con_entrada_de_red: number;
    readonly urls_extraidas: number;
    readonly origenes_distintos: number;
    readonly origenes_externos: number;
    readonly urls_no_parseables: number;
  };
  readonly detalle_por_trace: readonly DetalleDeTrace[];
}

/**
 * Clasifica URLs ya observadas. Pura: decide el veredicto sin tocar disco, para que
 * la regla se pueda probar sin fabricar un zip.
 */
export function clasificarOrigenes(urls: readonly unknown[], origenEsperado: string): Clasificacion;

/**
 * Abre cada `*.zip` bajo `dir`, lee toda entrada que termine en `.network` y enumera
 * los orígenes. Lanza si `unzip` no está disponible: un extractor que no puede abrir
 * el zip nunca debe contestar «no vi orígenes externos».
 */
export function extraerDeDirectorio(dir: string, origenEsperado: string): Informe;
