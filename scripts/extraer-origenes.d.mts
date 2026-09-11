/**
 * Tipos de `extraer-origenes.mjs` — el gate de origen, sin efectos al importarse.
 *
 * Es un `.mjs` a propósito: el entrypoint se invoca con `node` desde el gate, sin pasar
 * por el bundler. Sus tipos se declaran acá en vez de usar `as any` en el test, que el
 * gobierno del repo prohíbe — misma convención que `aliasesLib.d.mts`.
 */

/** Hosts que son la propia máquina. Todo lo demás se enumera como externo. */
export const HOSTS_LOOPBACK: readonly string[];

/**
 * Veredictos globales. Cuatro de los siete NO son «cero red externa»: dos dicen que el
 * instrumento no trajo datos, uno que no pudo leer todo, y uno que hay trazas mudas.
 */
export const VEREDICTOS: Readonly<{
  SIN_TRACES: 'INSTRUMENTO_SIN_DATOS_CERO_TRACES';
  SIN_URLS: 'INSTRUMENTO_SIN_DATOS_CERO_URLS';
  SIN_CONTROL: 'INSTRUMENTO_NO_ACREDITADO_FALTA_ORIGEN_ESPERADO';
  NO_VERIFICABLE: 'NO_VERIFICABLE_LINEA_ILEGIBLE_O_DE_FORMA_INESPERADA';
  BIYECCION_ROTA: 'NO_VERIFICABLE_CARDINALIDAD_REGISTRO_VS_TRAZAS';
  /**
   * Ítem 4 · el pareo ordinal entre `.network` y su contexto está roto. Tiene veredicto
   * PROPIO y no se mezcla con el de línea ilegible: las líneas se leyeron bien, lo que falta
   * es saber de qué contexto salieron. Reportarlo como «ilegible» mandaba al auditor a buscar
   * un problema de parseo que no existe.
   */
  PAREO_ROTO: 'NO_VERIFICABLE_PAREO_ORDINAL_RED_VS_CONTEXTO';
  TRAZAS_SIN_RED: 'HALLAZGO_TRAZAS_SIN_RED_OBSERVABLE';
  SIN_REGISTRO: 'NO_VERIFICABLE_TRAZA_SIN_REGISTRO_EN_EL_REPORTER';
  SIN_NETWORK_EN_ZIP: 'HALLAZGO_TRAZAS_SIN_NETWORK_EN_ZIP';
  SIN_NAVEGADOR_NO_DECLARADO: 'HALLAZGO_TRAZAS_SIN_NAVEGADOR_NO_DECLARADAS';
  LIMPIO: 'MEDIDO_SOLO_LOOPBACK_CERO_ORIGENES_EXTERNOS';
  EXTERNOS: 'MEDIDO_CON_ORIGENES_NO_LOOPBACK';
}>;

/** Veredicto de UNA traza. El global no puede ser mejor que el peor de éstos. */
export const VEREDICTOS_DE_TRAZA: Readonly<{
  OK: 'TRAZA_SOLO_LOOPBACK';
  SIN_REGISTRO: 'TRAZA_SIN_REGISTRO_EN_EL_REPORTER';
  SIN_NAVEGADOR: 'TRAZA_SIN_NAVEGADOR';
  SIN_NETWORK_EN_ZIP: 'TRAZA_SIN_NETWORK_EN_ZIP';
  SIN_RED: 'TRAZA_SIN_RED_OBSERVABLE';
  ILEGIBLE: 'TRAZA_CON_LINEA_ILEGIBLE';
  INESPERADA: 'TRAZA_CON_LINEA_DE_FORMA_INESPERADA';
  /** El `N-trace.trace` existe pero no se pudo leer o no parsea: no acredita navegador. */
  CONTEXTO_CORRUPTO: 'TRAZA_CON_CONTEXTO_ILEGIBLE';
  /** Ítem 4: `.network` sin ordinal — no hay con qué parearla, no se sabe de dónde salió. */
  RED_SIN_ORDINAL: 'TRAZA_CON_ENTRADA_DE_RED_SIN_ORDINAL';
  /** Ítem 4: `M-trace.network` cuyo `M-trace.trace` falta o no acredita contexto. */
  RED_SIN_CONTEXTO_PAREADO: 'TRAZA_CON_RED_SIN_CONTEXTO_DEL_MISMO_ORDINAL';
  EXTERNOS: 'TRAZA_CON_ORIGEN_NO_LOOPBACK';
}>;

export interface TestSinNavegadorDeclarado {
  /** Ruta del spec relativa a la raíz, tal como el reporter la registra. */
  readonly spec: string;
  readonly linea: number;
  /** Por qué ese test no necesita navegador. Verificable abriendo el archivo. */
  readonly por_que: string;
}

/**
 * Tests declarados como «no abren navegador», **por identidad `spec:linea`, nunca por slug**.
 *
 * Estuvo vacía toda la fase anterior con un motivo explícito: el que escribe el gate no se
 * declara sus propias excepciones. Se llenó cuando hubo **evidencia**, no cuando hubo permiso
 * — la corrida de 211 trazas midió exactamente dos sin contexto, y abrir sus fuentes muestra
 * que ninguna toma el fixture `page`.
 *
 * ⚠️ Declara que esos dos no abren navegador. NO declara que sean correctos ni que su
 * ausencia de red sea benigna para siempre: si uno empieza a tomar `page`, el gate vuelve a
 * marcarlo.
 */
export const SIN_NAVEGADOR_DECLARADAS: readonly TestSinNavegadorDeclarado[];

export type Veredicto = (typeof VEREDICTOS)[keyof typeof VEREDICTOS];
export type VeredictoDeTraza = (typeof VEREDICTOS_DE_TRAZA)[keyof typeof VEREDICTOS_DE_TRAZA];

/**
 * Cómo se PUBLICA un origen medido. Adjudicado el 2026-09-11.
 *
 * 🔴 Para lo NO loopback, `origen` **no es el host medido**: es el seudónimo. El campo crudo
 * se retira, no se acompaña — un campo bien redactado no sirve si el valor original quedó en
 * el de al lado.
 */
export type ClaseDeOrigen = 'LOOPBACK' | 'EXTERNO_ALLOWLISTADO' | 'EXTERNO_NO_ALLOWLISTADO';

export interface OrigenObservado {
  /** Loopback: el origen literal. Externo: el tercero declarado, o `EXTERNO_NO_ALLOWLISTADO`. */
  readonly origen: string;
  readonly requests: number;
  readonly loopback: boolean;
  readonly clase: ClaseDeOrigen;
  /** Sólo en `EXTERNO_ALLOWLISTADO`: la entrada de `TERCEROS_CONOCIDOS` que hizo match. */
  readonly tercero?: string;
  /** Sólo en `EXTERNO_NO_ALLOWLISTADO`: esquema y largo, nunca el host. */
  readonly esquema?: string;
  readonly largo_del_host?: number;
}

export interface Seudonimo {
  readonly publicado: string;
  readonly clase: ClaseDeOrigen;
  readonly tercero?: string;
  readonly esquema?: string;
  readonly largo_del_host?: number;
}

/**
 * Allowlist cerrada de terceros que el repo integra, con el motivo de cada entrada en el
 * módulo. El match es por sufijo con frontera de punto, no por extracción de eTLD+1: sin la
 * Public Suffix List, «las dos últimas etiquetas» se equivoca con `co.uk` y similares.
 */
export const TERCEROS_CONOCIDOS: readonly string[];

/**
 * 🔴 `seudonimoDeOrigen` YA NO EXISTE acá · ítem 6. La política de publicación vive en
 * `redactar.mjs` (`origenPublicable`) y este módulo la consume. Tenerla escrita en dos
 * archivos era exactamente el defecto que el ítem señala.
 */

/** Arma la fila publicable y retira el campo crudo cuando el origen no es loopback. */
export function publicarOrigen(o: { origen: string; requests: number; loopback: boolean }): OrigenObservado;

/**
 * Decodifica UTF-8 **estricto**. `Buffer.toString('utf8')` no falla nunca: reemplaza los
 * bytes inválidos por U+FFFD, así que sobre una traza corrupta lee basura como si fuera
 * texto. Acá se LANZA, y el llamador contamina la traza: «no pude decodificar» y «decodifiqué
 * y no había nada» son afirmaciones distintas.
 */
export function decodificarUtf8Estricto(buf: Uint8Array, queEs: string): string;

/**
 * Una URL ilegible NO se guarda cruda **ni hasheada**: puede traer query, tokens o
 * identificadores, y un sha256 de un secreto de baja entropía es un oráculo de diccionario.
 * Se conserva sólo estructura no sensible.
 */
export interface UrlRedactada {
  readonly esquema: string;
  readonly largo: number;
  readonly motivo: 'NO_PARSEA_COMO_URL' | 'NO_ES_STRING';
}

export interface Clasificacion {
  readonly veredicto: Veredicto;
  readonly control_positivo_ok: boolean;
  readonly origenes: readonly OrigenObservado[];
  readonly origenes_no_loopback: readonly OrigenObservado[];
  readonly esquemas_sin_red: readonly { readonly esquema: string; readonly ocurrencias: number }[];
  readonly urls_no_parseables: readonly UrlRedactada[];
}

export interface DetalleDeTrace {
  /** Ruta del zip relativa al DIRECTORIO analizado. */
  readonly zip: string;
  /**
   * Ruta relativa a la RAÍZ DEL REPO — la misma base en la que el reporter registra
   * `trace_path_relativo`. `null` cuando el directorio analizado no es `<raiz>/test-results`.
   *
   * 🔴 Existe porque la cardinalidad compara dos listas, y dos listas sólo se comparan si
   * están expresadas en la misma unidad: sin este campo, `intrusa/trace.zip` se comparaba
   * contra `test-results/intrusa/trace.zip` y toda traza parecía huérfana con otro nombre.
   */
  readonly zip_relativo_al_repo: string | null;
  readonly veredicto: VeredictoDeTraza;
  /** El test que produjo esta traza, cuando la unión por identidad pudo hacerse. */
  readonly test: {
    readonly id: string;
    readonly titulo: string;
    readonly spec: string;
    readonly linea: number;
  } | null;
  readonly union_por_identidad: 'NO_SOLICITADA' | 'SIN_REGISTRO' | 'EXACTA';
  readonly entradas_del_zip: number;
  readonly entradas_de_red: readonly string[];
  readonly hay_contexto_de_navegador: boolean;
  /** `true` si alguna entrada `N-trace.trace` existía y no se pudo leer o no parseó. */
  readonly contexto_corrupto: boolean;
  readonly entradas_de_contexto: readonly string[];
  /**
   * Ítem 4 · el pareo ordinal, publicado y no sólo su consecuencia: ordinal → estado del
   * contexto de ESE chunk. Un auditor tiene que poder ver qué ordinal quedó sin pareja sin
   * volver a abrir el zip.
   */
  readonly contexto_por_ordinal: Readonly<Record<string, 'ACREDITADO' | 'CORRUPTO'>>;
  /** `.network` sin ordinal: no se puede parear, así que no acredita nada. */
  readonly redes_sin_ordinal: readonly string[];
  /** `M-trace.network` cuyo `M-trace.trace` falta o no acredita. */
  readonly redes_sin_contexto_pareado: readonly string[];
  readonly lineas_red: number;
  readonly lineas_ilegibles: number;
  readonly lineas_de_forma_inesperada: number;
  readonly urls_extraidas: number;
  readonly origenes: readonly OrigenObservado[];
  readonly origenes_no_loopback: readonly OrigenObservado[];
}

/**
 * Biyección y cardinalidad registro ↔ ZIP.
 *
 * 🔴 `NO_SOLICITADA` y `NO_BIYECTIVA` son estados DISTINTOS, y confundirlos rompe en las dos
 * direcciones: como acusación —el extractor corrido a mano sin registro saldría «no
 * biyectiva», un defecto inventado— y como permiso —si `NO_SOLICITADA` bastara para seguir,
 * alcanzaría con no pasar el registro para saltearse la comprobación—. La compuerta vive en
 * `gate-origen.mjs`, que aborta con exit 7 si el reporter no dejó `tests`.
 */
export interface Biyeccion {
  readonly estado: 'NO_SOLICITADA' | 'BIYECTIVA' | 'NO_BIYECTIVA';
  readonly problemas: readonly (
    | 'REGISTRO_VACIO'
    | 'REGISTRO_SIN_NINGUNA_TRAZA_DECLARADA'
    | 'PATHS_DUPLICADOS_EN_EL_REGISTRO'
    | 'TESTS_CON_TRAZA_DECLARADA_QUE_NO_ESTA'
    | 'TRAZAS_HUERFANAS_SIN_TEST'
    /** Ítem 5: traza nula sin un `estado` de salteo que la explique. */
    | 'TRAZA_NULA_SIN_ESTADO_DE_SALTEO'
    /** Ítem 5: `trace_path_relativo` que no es ni string usable ni nulo explícito. */
    | 'TRACE_PATH_DE_FORMA_INESPERADA'
  )[];
  readonly cardinalidad: {
    readonly zips_en_el_directorio: number;
    readonly zips_hallados_sin_deduplicar: number;
    /** `null` cuando no se pasó registro. `0` significa que el reporter no declaró un test. */
    readonly tests_en_el_registro: number | null;
    readonly tests_con_traza_declarada: number;
    /** Skips y tests Node-only. No es defecto por sí solo; si fueran todos, sí. */
    readonly tests_sin_traza_declarada: number | null;
    readonly paths_declarados_distintos: number;
  };
  readonly duplicados_en_el_registro: readonly string[];
  readonly tests_con_traza_faltante: readonly string[];
  readonly trazas_huerfanas: readonly string[];
  /**
   * Ítem 5 · ids de tests que declararon traza nula **sin** un estado de salteo que lo
   * justifique. Un test que corrió y no dejó traza y uno que se salteó no son lo mismo: sólo
   * el segundo es benigno. El primero significa que el instrumento perdió un artefacto.
   */
  readonly nulos_sin_estado_de_salteo: readonly string[];
  readonly trace_path_de_forma_inesperada: readonly string[];
  /** Los únicos estados que hacen aceptable un `trace_path_relativo` nulo. */
  readonly estados_que_justifican_nulo: readonly string[];
}

export interface Informe {
  readonly instrumento: string;
  readonly acredita: string;
  readonly no_acredita: string;
  readonly medido_utc: string;
  readonly directorio_analizado: string;
  readonly origen_esperado_control_positivo: string;
  readonly veredicto: Veredicto;
  readonly control_positivo_ok: boolean;
  readonly origenes: readonly OrigenObservado[];
  readonly origenes_no_loopback: readonly OrigenObservado[];
  readonly esquemas_sin_red: readonly { readonly esquema: string; readonly ocurrencias: number }[];
  readonly urls_no_parseables: readonly UrlRedactada[];
  readonly totales: {
    readonly traces_hallados: number;
    readonly traces_con_entrada_de_red: number;
    readonly traces_ok: number;
    readonly traces_sin_red: number;
    readonly traces_sin_navegador: number;
    readonly traces_sin_registro_en_el_reporter: number;
    readonly traces_sin_navegador_no_declaradas: number;
    readonly traces_sin_network_en_zip: number;
    readonly traces_con_linea_ilegible: number;
    readonly traces_con_pareo_roto: number;
    readonly traces_con_origen_externo: number;
    readonly urls_extraidas: number;
    readonly origenes_distintos: number;
    readonly origenes_externos: number;
    readonly urls_no_parseables: number;
  };
  readonly trazas_sin_red_observable: readonly string[];
  readonly trazas_sin_navegador: readonly string[];
  readonly trazas_sin_registro: readonly string[];
  readonly union_por_identidad: 'NO_SOLICITADA' | 'EXACTA_POR_PATH_DEL_ATTACHMENT';
  readonly biyeccion: Biyeccion;
  readonly trazas_sin_network_en_zip: readonly string[];
  readonly trazas_con_linea_ilegible: readonly string[];
  /** Ítem 4 · trazas cuyo pareo ordinal red↔contexto está roto. Balde propio, no «ilegible». */
  readonly trazas_con_pareo_roto: readonly string[];
  readonly detalle_por_trace: readonly DetalleDeTrace[];
}

/**
 * Clasifica URLs ya observadas. Pura: decide el veredicto sin tocar disco, para que la
 * regla se pueda probar sin fabricar un zip. Una URL ilegible produce `NO_VERIFICABLE`.
 */
export function clasificarOrigenes(urls: readonly unknown[], origenEsperado: string): Clasificacion;

/** Un test tal como el reporter lo registró en `onTestEnd`. La unión es por `trace_path_relativo`. */
export interface TestRegistrado {
  readonly id: string;
  readonly titulo: string;
  readonly spec: string;
  readonly linea: number;
  /**
   * 🔴 Ítem 5 · el `status` que el reporter registró en `onTestEnd`. Es lo que decide si un
   * `trace_path_relativo` nulo es aceptable: sólo un salteo declarado lo justifica. Sin este
   * campo, «este test no dejó traza» era una afirmación que el gate aceptaba sin pedir motivo.
   */
  readonly estado?: string;
  /**
   * Ruta relativa EXACTA del attachment `trace`, tal como la registró `onTestEnd`. La unión
   * con el zip medido es por **igualdad exacta** de este string, nunca por substring.
   *
   * `null` únicamente cuando `estado` declara un salteo autorizado. `SIN_NAVEGADOR` **no se
   * infiere del slug ni del stack**: se declara.
   */
  readonly trace_path_relativo: string | null;
}

/**
 * Abre cada `*.zip` bajo `dir`, lee toda entrada que termine en `.network` y rinde un
 * veredicto POR TRAZA además del global.
 *
 * La descompresión la hace `leer-zip.mjs` con el `yauzl` que ya viaja pinneado dentro de
 * `playwright-core` — **no un parser propio y no `node:zlib`**, que fue la implementación
 * rechazada en auditoría—. Verifica CRC32 en streaming, rechaza duplicados y LANZA ante un
 * zip que no entiende: un extractor que no puede abrirlo nunca debe contestar «no vi
 * orígenes externos».
 *
 * `registroDeTests` viene del reporter. Si se pasa, cada traza se une a su test por
 * **igualdad exacta** del path del attachment y una traza sin registro es `NO_VERIFICABLE`.
 * Si no se pasa, el informe lo declara `NO_SOLICITADA` en vez de fingir que unió.
 */
export function extraerDeDirectorio(
  dir: string,
  origenEsperado: string,
  registroDeTests?: readonly TestRegistrado[] | null,
): Promise<Informe>;
