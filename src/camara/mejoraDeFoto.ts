import type { Marco } from './marcoDelRecorte';

/**
 * D509 · n322 · la foto mejor ANTES de enviarla. Mati: «Medir solo y mejorar
 * ya». Cuatro cosas, todas en el teléfono y sin librerías nuevas:
 *
 * 1. **El borde del ticket** (`detectarBorde`): el marco del recorte (D222)
 *    arranca sobre el papel en lugar de la foto entera. Es sólo el punto de
 *    partida: la persona lo ajusta a mano como siempre. Si no se ve un papel
 *    claro y separado del fondo, no se adivina: el marco arranca entero.
 * 2. **El enderezado** (`estimarInclinacion`): los renglones de un ticket son
 *    paralelos; se busca el ángulo (hasta ±8°) en que quedan más
 *    «horizontales» y la foto se gira lo contrario al codificarla.
 * 3. **El contraste para papel térmico** (`realzarPapel`): gris y niveles
 *    estirados entre el 1 % y el 99 %, sin binarizar (el lector prefiere los
 *    grises a un blanco y negro duro).
 * 4. **El aviso de foco y luz** (`evaluarFoto`): umbrales conservadores; sólo
 *    avisa, nunca bloquea el envío.
 *
 * Todo trabaja sobre la luminancia de una MUESTRA chica (lado largo ~512 px):
 * es rápido y no retiene otra copia grande de la foto en memoria. Nada sale
 * del teléfono más que la foto que ya se enviaba.
 */

/** El lado largo de la muestra que se analiza. */
export const LADO_MUESTRA = 512;

/** Una imagen en gris: un valor de 0 a 255 por píxel, fila por fila. */
export interface Gris {
  readonly ancho: number;
  readonly alto: number;
  readonly datos: Float32Array;
}

/** RGBA (como `ImageData.data`) → luminancia (Rec. 601, la de siempre). */
export function aGris(rgba: ArrayLike<number>, ancho: number, alto: number): Gris {
  const datos = new Float32Array(ancho * alto);
  for (let i = 0, p = 0; i < datos.length; i++, p += 4) {
    datos[i] = 0.299 * rgba[p]! + 0.587 * rgba[p + 1]! + 0.114 * rgba[p + 2]!;
  }
  return { ancho, alto, datos };
}

/** Un rectángulo de la muestra, en píxeles enteros. */
export interface Region {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

const REGION_ENTERA = (g: Gris): Region => ({ x0: 0, y0: 0, x1: g.ancho, y1: g.alto });

/** El umbral de Otsu de los valores de una región (0..255). */
export function umbralOtsu(g: Gris, r: Region = REGION_ENTERA(g)): number {
  const hist = new Float64Array(256);
  let n = 0;
  for (let y = r.y0; y < r.y1; y++) {
    for (let x = r.x0; x < r.x1; x++) {
      hist[Math.min(255, Math.max(0, Math.round(g.datos[y * g.ancho + x]!)))]! += 1;
      n++;
    }
  }
  if (n === 0) return 128;
  let suma = 0;
  for (let i = 0; i < 256; i++) suma += i * hist[i]!;
  let sumaB = 0;
  let pesoB = 0;
  let mejor = 0;
  let umbral = 128;
  for (let i = 0; i < 256; i++) {
    pesoB += hist[i]!;
    if (pesoB === 0) continue;
    const pesoF = n - pesoB;
    if (pesoF === 0) break;
    sumaB += i * hist[i]!;
    const mB = sumaB / pesoB;
    const mF = (suma - sumaB) / pesoF;
    const entre = pesoB * pesoF * (mB - mF) * (mB - mF);
    if (entre > mejor) {
      mejor = entre;
      umbral = i;
    }
  }
  return umbral;
}

// ─── 1 · el borde del ticket ──────────────────────────────────────────────

/** La corrida contigua más larga de índices donde `ok` vale, tolerando huecos chicos. */
function corridaMasLarga(ok: readonly boolean[], hueco: number): [number, number] | null {
  let mejor: [number, number] | null = null;
  let desde = -1;
  let ultimo = -1;
  for (let i = 0; i <= ok.length; i++) {
    if (i < ok.length && ok[i]) {
      if (desde < 0) desde = i;
      ultimo = i;
      continue;
    }
    if (desde >= 0 && (i === ok.length || i - ultimo > hueco)) {
      if (!mejor || ultimo - desde > mejor[1] - mejor[0]) mejor = [desde, ultimo + 1];
      desde = -1;
    }
  }
  return mejor;
}

/** El margen que se deja alrededor del papel detectado, en proporción de la foto. */
export const MARGEN_DEL_BORDE = 0.015;

/**
 * El papel del ticket: la zona clara y compacta, bien separada de un fondo más
 * oscuro. Devuelve el marco (proporciones de la foto, con un margen chico) o
 * `null` si no hay un papel claro: entonces el marco arranca entero, como
 * antes. Umbrales conservadores a propósito: un marco mal puesto le corta el
 * TOTAL al ticket, y eso es peor que no ayudar (lección de la auditoría de
 * Codex sobre el recorte automático de D222).
 */
export function detectarBorde(g: Gris, rgba?: ArrayLike<number>): Marco | null {
  const { ancho, alto, datos } = g;
  if (ancho < 32 || alto < 32) return null;
  const t = umbralOtsu(g);
  // Las dos clases tienen que estar lejos: papel claro sobre fondo oscuro.
  let sClaro = 0; let nClaro = 0; let sOscuro = 0; let nOscuro = 0;
  for (let i = 0; i < datos.length; i++) {
    const v = datos[i]!;
    if (v > t) { sClaro += v; nClaro++; } else { sOscuro += v; nOscuro++; }
  }
  if (nClaro === 0 || nOscuro === 0) return null;
  if (sClaro / nClaro - sOscuro / nOscuro < 70) return null;
  const claro = (x: number, y: number) => datos[y * ancho + x]! > t;
  const filas: number[] = [];
  for (let y = 0; y < alto; y++) {
    let c = 0;
    for (let x = 0; x < ancho; x++) if (claro(x, y)) c++;
    filas.push(c / ancho);
  }
  const columnas: number[] = [];
  for (let x = 0; x < ancho; x++) {
    let c = 0;
    for (let y = 0; y < alto; y++) if (claro(x, y)) c++;
    columnas.push(c / alto);
  }
  const maxF = Math.max(...filas);
  const maxC = Math.max(...columnas);
  if (maxF < 0.15 || maxC < 0.15) return null;
  const rf = corridaMasLarga(filas.map((f) => f >= maxF * 0.5), Math.ceil(alto * 0.02));
  const rc = corridaMasLarga(columnas.map((c) => c >= maxC * 0.5), Math.ceil(ancho * 0.02));
  if (!rf || !rc) return null;
  const caja: Region = { x0: rc[0], y0: rf[0], x1: rc[1], y1: rf[1] };
  const area = ((caja.x1 - caja.x0) * (caja.y1 - caja.y0)) / (ancho * alto);
  // Muy chico: no es el ticket. Casi toda la foto: no hay nada que recortar.
  if (area < 0.12 || area > 0.9) return null;
  // Adentro, papel; afuera, fondo.
  let adentro = 0; let nAdentro = 0; let afuera = 0; let nAfuera = 0;
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const dentro = x >= caja.x0 && x < caja.x1 && y >= caja.y0 && y < caja.y1;
      if (dentro) { nAdentro++; if (claro(x, y)) adentro++; } else { nAfuera++; if (claro(x, y)) afuera++; }
    }
  }
  if (nAfuera === 0 || adentro / nAdentro < 0.6 || afuera / nAfuera > 0.2) return null;
  // Un ticket tiene algo impreso: una zona clara lisa (una captura de pantalla, una pared) no se toma por papel.
  if (1 - adentro / nAdentro < TINTA_MINIMA) return null;
  // El papel claro puede tener puntas oscuras (un logo, una franja, el TOTAL en negrita): la caja se extiende por las
  // filas y columnas pegadas que no se parecen al fondo. Mejor dejar fondo de más que cortar el ticket.
  const final = rgba ? extenderPorColor(caja, rgba, ancho, alto) : caja;
  const m = MARGEN_DEL_BORDE;
  return {
    x0: Math.max(0, final.x0 / ancho - m),
    y0: Math.max(0, final.y0 / alto - m),
    x1: Math.min(1, final.x1 / ancho + m),
    y1: Math.min(1, final.y1 / alto + m),
  };
}

/** La fracción mínima de oscuro (lo impreso) adentro del papel para tomarlo por un ticket. */
export const TINTA_MINIMA = 0.005;

/** Lo que tiene que alejarse del fondo (distancia RGB) una fila o columna para contar como parte del ticket. */
const DISTANCIA_AL_FONDO = 45;

/** Extiende la caja por las filas y columnas pegadas cuyo color medio se aleja del color del fondo. */
function extenderPorColor(caja: Region, rgba: ArrayLike<number>, ancho: number, alto: number): Region {
  // El color del fondo: el promedio de lo que queda afuera de la caja.
  const fondo = [0, 0, 0];
  let n = 0;
  for (let y = 0; y < alto; y += 2) {
    for (let x = 0; x < ancho; x += 2) {
      if (x >= caja.x0 && x < caja.x1 && y >= caja.y0 && y < caja.y1) continue;
      const p = (y * ancho + x) * 4;
      fondo[0] += rgba[p]!; fondo[1] += rgba[p + 1]!; fondo[2] += rgba[p + 2]!;
      n++;
    }
  }
  if (n === 0) return caja;
  const bg = fondo.map((v) => v / n);
  const lejos = (x0: number, y0: number, x1: number, y1: number): boolean => {
    const s = [0, 0, 0];
    let k = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const p = (y * ancho + x) * 4;
        s[0] += rgba[p]!; s[1] += rgba[p + 1]!; s[2] += rgba[p + 2]!;
        k++;
      }
    }
    if (k === 0) return false;
    const d = Math.hypot(s[0]! / k - bg[0]!, s[1]! / k - bg[1]!, s[2]! / k - bg[2]!);
    return d > DISTANCIA_AL_FONDO;
  };
  let { x0, y0, x1, y1 } = caja;
  while (y0 > 0 && lejos(x0, y0 - 1, x1, y0)) y0--;
  while (y1 < alto && lejos(x0, y1, x1, y1 + 1)) y1++;
  while (x0 > 0 && lejos(x0 - 1, y0, x0, y1)) x0--;
  while (x1 < ancho && lejos(x1, y0, x1 + 1, y1)) x1++;
  return { x0, y0, x1, y1 };
}

// ─── 2 · el enderezado ────────────────────────────────────────────────────

/** El giro máximo que se corrige, en grados. Más que eso es otra cosa (la foto acostada la endereza el EXIF). */
export const INCLINACION_MAXIMA = 8;
/** Menos que esto no se gira: no vale la pena recodificar por un grado. */
export const INCLINACION_MINIMA = 1;
const PASO_GRADOS = 0.5;

/**
 * El ángulo, en grados, en que están inclinados los renglones dentro de
 * `region`: positivo si bajan hacia la derecha (giro horario). 0 si no hay
 * texto suficiente, si es menos de `INCLINACION_MINIMA` o si ningún ángulo es
 * claramente mejor que dejarla como está.
 *
 * Método de perfil de proyección: los píxeles de tinta se proyectan sobre el
 * eje vertical girado; en el ángulo correcto los renglones caen en franjas
 * nítidas y el perfil tiene más «saltos».
 */
export function estimarInclinacion(g: Gris, region: Region = REGION_ENTERA(g)): number {
  // Los puntos de borde HORIZONTAL (salto vertical de brillo): el arriba y el
  // abajo de cada renglón, y del papel. Un fondo liso no aporta ninguno, así
  // que no hace falta separar el papel del fondo para medir.
  const xs: number[] = [];
  const ys: number[] = [];
  for (let y = Math.max(1, region.y0); y < Math.min(g.alto - 1, region.y1); y++) {
    for (let x = region.x0; x < region.x1; x++) {
      const salto = Math.abs(g.datos[(y + 1) * g.ancho + x]! - g.datos[(y - 1) * g.ancho + x]!);
      if (salto > 60) { xs.push(x); ys.push(y); }
    }
  }
  const n = xs.length;
  // Sin bordes no hay renglones que medir.
  if (n < 200) return 0;
  const cx = (region.x0 + region.x1) / 2;
  const cy = (region.y0 + region.y1) / 2;
  const alto = region.y1 - region.y0 + region.x1 - region.x0;
  const puntaje = (grados: number): number => {
    const rad = (grados * Math.PI) / 180;
    const sen = Math.sin(rad);
    const cos = Math.cos(rad);
    const perfil = new Float64Array(alto * 2 + 2);
    for (let i = 0; i < n; i++) {
      const yr = (ys[i]! - cy) * cos - (xs[i]! - cx) * sen;
      perfil[Math.round(yr + alto)]! += 1;
    }
    let s = 0;
    for (let i = 1; i < perfil.length; i++) {
      const d = perfil[i]! - perfil[i - 1]!;
      s += d * d;
    }
    return s;
  };
  const base = puntaje(0);
  let mejor = 0;
  let mejorPuntaje = base;
  for (let a = -INCLINACION_MAXIMA; a <= INCLINACION_MAXIMA + 1e-9; a += PASO_GRADOS) {
    const p = puntaje(a);
    if (p > mejorPuntaje) { mejorPuntaje = p; mejor = a; }
  }
  if (Math.abs(mejor) < INCLINACION_MINIMA || mejorPuntaje < base * 1.15) return 0;
  return mejor;
}

// ─── 3 · el contraste para papel térmico ──────────────────────────────────

/**
 * En el lugar: RGBA → gris, con los niveles estirados entre el percentil 1 y el
 * 99 de la luminancia (el papel térmico desteñido queda con poco rango). Si el
 * rango ya es amplio, sólo el gris. No binariza: los grises ayudan al lector.
 */
export function realzarPapel(rgba: Uint8ClampedArray | number[]): void {
  const n = rgba.length / 4;
  if (n === 0) return;
  const hist = new Uint32Array(256);
  const lum = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const v = Math.round(0.299 * rgba[p]! + 0.587 * rgba[p + 1]! + 0.114 * rgba[p + 2]!);
    lum[i] = v;
    hist[v]! += 1;
  }
  const percentil = (q: number): number => {
    const meta = n * q;
    let acum = 0;
    for (let v = 0; v < 256; v++) {
      acum += hist[v]!;
      if (acum >= meta) return v;
    }
    return 255;
  };
  const lo = percentil(0.01);
  const hi = percentil(0.99);
  const estirar = hi - lo >= 30 && (lo > 0 || hi < 255);
  const escala = estirar ? 255 / (hi - lo) : 1;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const v = estirar ? Math.min(255, Math.max(0, Math.round((lum[i]! - lo) * escala))) : lum[i]!;
    rgba[p] = v;
    rgba[p + 1] = v;
    rgba[p + 2] = v;
  }
}

// ─── 4 · el aviso de foco y luz ───────────────────────────────────────────

export interface AvisosDeFoto {
  /** Poca luz: el papel casi no se distingue. */
  readonly oscura: boolean;
  /** Mucho brillo o un reflejo que quema el papel. */
  readonly quemada: boolean;
  /** Movida o fuera de foco. */
  readonly movida: boolean;
}

/** Umbrales conservadores: avisar de más sería ruido en cada foto (D509: «nunca bloquea»). */
export const UMBRALES_DE_AVISO = {
  /** Brillo medio de la región por debajo de esto: oscura. */
  oscura: 55,
  /** Proporción de píxeles casi blancos (≥ 250) que la quema. */
  quemada: 0.45,
  /**
   * Nitidez RELATIVA (varianza del laplaciano sobre la varianza de la imagen)
   * por debajo de esto: movida. Relativa para no depender del contraste de la
   * foto. Calibrada con tickets sintéticos a la escala de la muestra: nítido
   * 0,66; desenfoque de caja radio 2 0,028; radio 3 0,013. Avisa sólo la muy
   * movida.
   */
  movida: 0.015,
  /** Con menos varianza que esto la foto es casi lisa: no hay con qué medir el foco. */
  varianzaMinima: 100,
} as const;

/** La varianza del laplaciano (4 vecinos) de una región: alta con bordes nítidos, baja con la foto movida. */
export function nitidez(g: Gris, r: Region = REGION_ENTERA(g)): number {
  let s = 0;
  let s2 = 0;
  let n = 0;
  for (let y = Math.max(1, r.y0); y < Math.min(g.alto - 1, r.y1); y++) {
    for (let x = Math.max(1, r.x0); x < Math.min(g.ancho - 1, r.x1); x++) {
      const i = y * g.ancho + x;
      const l = g.datos[i - 1]! + g.datos[i + 1]! + g.datos[i - g.ancho]! + g.datos[i + g.ancho]! - 4 * g.datos[i]!;
      s += l;
      s2 += l * l;
      n++;
    }
  }
  if (n === 0) return 0;
  const media = s / n;
  return s2 / n - media * media;
}

export function evaluarFoto(g: Gris, r: Region = REGION_ENTERA(g)): AvisosDeFoto {
  let suma = 0;
  let suma2 = 0;
  let blancos = 0;
  let n = 0;
  for (let y = r.y0; y < r.y1; y++) {
    for (let x = r.x0; x < r.x1; x++) {
      const v = g.datos[y * g.ancho + x]!;
      suma += v;
      suma2 += v * v;
      if (v >= 250) blancos++;
      n++;
    }
  }
  if (n === 0) return { oscura: false, quemada: false, movida: false };
  const media = suma / n;
  const varianza = suma2 / n - media * media;
  const oscura = media < UMBRALES_DE_AVISO.oscura;
  return {
    oscura,
    quemada: blancos / n >= UMBRALES_DE_AVISO.quemada,
    // Con poca luz la nitidez baja sola: se avisa la luz, no las dos cosas. Y
    // una foto casi lisa no dice nada del foco.
    movida: !oscura && varianza >= UMBRALES_DE_AVISO.varianzaMinima
      && nitidez(g, r) / varianza < UMBRALES_DE_AVISO.movida,
  };
}

// ─── Todo junto ───────────────────────────────────────────────────────────

/** Lo que la pantalla de escaneo sabe de una foto recién llegada. */
export interface AnalisisDeFoto {
  /** El marco inicial sobre el papel, o `null` (arranca entero, como antes). */
  readonly marco: Marco | null;
  /** Los grados que hay que girar la foto al codificarla para enderezarla (0: nada). */
  readonly giro: number;
  /**
   * Si conviene el realce para papel térmico: sólo con el papel desteñido (poco
   * rango de brillo). Una foto con buen contraste va como está, en color: el
   * lector la lee bien y no hay por qué tocarla.
   */
  readonly realzar: boolean;
  readonly avisos: AvisosDeFoto;
}

export const SIN_ANALISIS: AnalisisDeFoto = {
  marco: null,
  giro: 0,
  realzar: false,
  avisos: { oscura: false, quemada: false, movida: false },
};

/** Por debajo de este rango de brillo (percentiles 2 a 98) el papel está desteñido y se realza. */
export const RANGO_PARA_REALZAR = 140;

/**
 * El papel de un ticket es gris: con más color que esto (diferencia media entre el canal más alto y el más bajo) la
 * foto no es un papel desteñido sino algo de color, y no se pasa a gris.
 */
export const SATURACION_PARA_REALZAR = 25;

/** La saturación media de una región: el promedio de (canal más alto − canal más bajo). */
export function saturacionMedia(rgba: ArrayLike<number>, ancho: number, r: Region): number {
  let s = 0;
  let n = 0;
  for (let y = r.y0; y < r.y1; y++) {
    for (let x = r.x0; x < r.x1; x++) {
      const p = (y * ancho + x) * 4;
      s += Math.max(rgba[p]!, rgba[p + 1]!, rgba[p + 2]!) - Math.min(rgba[p]!, rgba[p + 1]!, rgba[p + 2]!);
      n++;
    }
  }
  return n === 0 ? 0 : s / n;
}

/** El rango de brillo de una región, entre los percentiles 2 y 98: el contraste que tiene el papel. */
export function rangoDeBrillo(g: Gris, r: Region = REGION_ENTERA(g)): number {
  const hist = new Uint32Array(256);
  let n = 0;
  for (let y = r.y0; y < r.y1; y++) {
    for (let x = r.x0; x < r.x1; x++) {
      hist[Math.min(255, Math.max(0, Math.round(g.datos[y * g.ancho + x]!)))]! += 1;
      n++;
    }
  }
  if (n === 0) return 255;
  const percentil = (q: number): number => {
    let acum = 0;
    for (let v = 0; v < 256; v++) {
      acum += hist[v]!;
      if (acum >= n * q) return v;
    }
    return 255;
  };
  return percentil(0.98) - percentil(0.02);
}

/**
 * La muestra (RGBA, lado largo ~512) → el marco inicial, el giro y los avisos,
 * medidos sobre el papel si se encontró y sobre la foto entera si no.
 */
export function analizarMuestra(rgba: ArrayLike<number>, ancho: number, alto: number): AnalisisDeFoto {
  if (!(ancho > 0) || !(alto > 0) || rgba.length < ancho * alto * 4) return SIN_ANALISIS;
  const g = aGris(rgba, ancho, alto);
  const marco = detectarBorde(g, rgba);
  const region: Region = marco
    ? {
      x0: Math.floor(marco.x0 * ancho), y0: Math.floor(marco.y0 * alto),
      x1: Math.ceil(marco.x1 * ancho), y1: Math.ceil(marco.y1 * alto),
    }
    : REGION_ENTERA(g);
  const inclinacion = estimarInclinacion(g, region);
  return {
    marco,
    giro: inclinacion === 0 ? 0 : -inclinacion,
    realzar: rangoDeBrillo(g, region) < RANGO_PARA_REALZAR && saturacionMedia(rgba, ancho, region) < SATURACION_PARA_REALZAR,
    avisos: evaluarFoto(g, region),
  };
}
