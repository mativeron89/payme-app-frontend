/**
 * D622 · AF-3 · mejora 6 (§7 de la especificación) · el generador de QR propio.
 *
 * D630: «Escribirlo nosotros», sin librerías de terceros. D631: el QR abre el
 * link directo, el mismo de «Copiar link».
 *
 * Lo justo para un link: **modo byte** (UTF-8), corrección **M**, versiones
 * **1 a 10**, Reed-Solomon sobre GF(256), máscara elegida por penalización
 * (ISO/IEC 18004:2015 §7.8.3) y la información de formato y de versión.
 * No hay modo numérico, alfanumérico ni kanji, ni ECI, ni Micro QR.
 *
 * 🔴 Lo que no entra en la versión 10 (213 bytes) **se rechaza**: `null`, nunca
 * una matriz recortada. Un QR que decodifica otra cosa es peor que no tenerlo.
 *
 * Se prueba módulo a módulo contra matrices de otras implementaciones hechas
 * fuera del repo (qrcodegen y segno, `qrFixtures.ts`), y lo cierra la prueba con
 * la cámara del iPhone (D63).
 *
 * ⚠️ La máscara automática depende de cómo se lean las reglas 3 y 4 de la
 * penalización, que la norma deja abiertas (segno y qrcodegen eligen distinto
 * en el anexo I). Acá se leen como qrcodegen: la regla 3 por tramos en
 * proporción 1:1:3:1:1 de cualquier ancho, y la 4 con el menor k que contiene
 * la proporción. Cualquier máscara da un símbolo válido: el formato la declara.
 */

export const VERSION_MAXIMA = 10;

export interface MatrizQr {
  readonly version: number;
  /** 17 + 4 × versión. Sin la zona de silencio: la agrega quien dibuja. */
  readonly tamano: number;
  readonly mascara: number;
  /** `modulos[fila][columna]`, `true` = oscuro. */
  readonly modulos: readonly (readonly boolean[])[];
}

/** Bloques de corrección M por versión (ISO/IEC 18004, tabla 9): codewords de corrección por bloque y grupos [bloques, datos]. */
const BLOQUES_M: ReadonlyArray<{ readonly ec: number; readonly grupos: ReadonlyArray<readonly [number, number]> }> = [
  { ec: 10, grupos: [[1, 16]] },
  { ec: 16, grupos: [[1, 28]] },
  { ec: 26, grupos: [[1, 44]] },
  { ec: 18, grupos: [[2, 32]] },
  { ec: 24, grupos: [[2, 43]] },
  { ec: 16, grupos: [[4, 27]] },
  { ec: 18, grupos: [[4, 31]] },
  { ec: 22, grupos: [[2, 38], [2, 39]] },
  { ec: 22, grupos: [[3, 36], [2, 37]] },
  { ec: 26, grupos: [[4, 43], [1, 44]] },
];

/** Centros de los patrones de alineación (anexo E). */
const ALINEACION: ReadonlyArray<readonly number[]> = [
  [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

function validarVersion(version: number): void {
  if (!Number.isInteger(version) || version < 1 || version > VERSION_MAXIMA) {
    throw new RangeError(`versión de QR fuera de 1–${VERSION_MAXIMA}: ${version}`);
  }
}

function validarMascara(mascara: number): void {
  if (!Number.isInteger(mascara) || mascara < 0 || mascara > 7) {
    throw new RangeError(`máscara de QR fuera de 0–7: ${mascara}`);
  }
}

function codewordsDeDatos(version: number): number {
  return BLOQUES_M[version - 1].grupos.reduce((s, [bloques, datos]) => s + bloques * datos, 0);
}

/** Bits del indicador de cantidad en modo byte: 8 hasta la versión 9, 16 desde la 10. */
const bitsDeCantidad = (version: number): number => (version < 10 ? 8 : 16);

/** Cuántos bytes entran en modo byte con corrección M. */
export function capacidadEnBytes(version: number): number {
  validarVersion(version);
  return Math.floor((codewordsDeDatos(version) * 8 - 4 - bitsDeCantidad(version)) / 8);
}

// ─── GF(256), polinomio primitivo x⁸ + x⁴ + x³ + x² + 1 (0x11D) ─────────────

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

const multiplicar = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** El polinomio generador de grado n, ∏(x − αⁱ) para i = 0…n−1, coeficientes de mayor a menor grado. */
function generador(n: number): number[] {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const siguiente = new Array<number>(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      siguiente[j] ^= g[j];
      siguiente[j + 1] ^= multiplicar(g[j], EXP[i]);
    }
    g = siguiente;
  }
  return g;
}

/** Los n codewords de corrección Reed-Solomon de un bloque de datos. */
export function correccionReedSolomon(datos: readonly number[], n: number): number[] {
  if (!Number.isInteger(n) || n < 1 || n > 68) throw new RangeError(`grado de corrección inválido: ${n}`);
  const g = generador(n);
  const resto = new Array<number>(n).fill(0);
  for (const d of datos) {
    if (!Number.isInteger(d) || d < 0 || d > 255) throw new RangeError(`codeword inválido: ${d}`);
    const factor = d ^ resto[0];
    resto.shift();
    resto.push(0);
    for (let i = 0; i < n; i++) resto[i] ^= multiplicar(g[i + 1], factor);
  }
  return resto;
}

// ─── Formato y versión (BCH) ────────────────────────────────────────────────

/** Los 15 bits de formato para corrección M (00) y la máscara, ya con la máscara 0x5412. */
export function bitsDeFormato(mascara: number): number {
  validarMascara(mascara);
  const datos = (0b00 << 3) | mascara;
  let resto = datos;
  for (let i = 0; i < 10; i++) resto = (resto << 1) ^ ((resto >>> 9) * 0x537);
  return ((datos << 10) | (resto & 0x3ff)) ^ 0x5412;
}

/** Los 18 bits de información de versión (desde la versión 7). */
export function bitsDeVersion(version: number): number {
  validarVersion(version);
  let resto = version;
  for (let i = 0; i < 12; i++) resto = (resto << 1) ^ ((resto >>> 11) * 0x1f25);
  return (version << 12) | (resto & 0xfff);
}

// ─── La matriz ──────────────────────────────────────────────────────────────

interface Lienzo {
  readonly n: number;
  readonly modulos: boolean[][];
  readonly funcion: boolean[][];
}

function lienzoConFunciones(version: number): Lienzo {
  const n = 17 + 4 * version;
  const modulos = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const funcion = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const poner = (fila: number, col: number, oscuro: boolean): void => {
    modulos[fila][col] = oscuro;
    funcion[fila][col] = true;
  };
  // Temporización: fila 6 y columna 6 (los buscadores la pisan en sus esquinas).
  for (let i = 0; i < n; i++) {
    poner(6, i, i % 2 === 0);
    poner(i, 6, i % 2 === 0);
  }
  // Buscadores con su separador claro.
  for (const [f0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    for (let df = -1; df <= 7; df++) {
      for (let dc = -1; dc <= 7; dc++) {
        const f = f0 + df;
        const c = c0 + dc;
        if (f < 0 || f >= n || c < 0 || c >= n) continue;
        const dentro = df >= 0 && df <= 6 && dc >= 0 && dc <= 6;
        const borde = df === 0 || df === 6 || dc === 0 || dc === 6;
        const centro = df >= 2 && df <= 4 && dc >= 2 && dc <= 4;
        poner(f, c, dentro && (borde || centro));
      }
    }
  }
  // Alineación: todas las combinaciones de centros, salvo las tres que caen sobre un buscador.
  const centros = ALINEACION[version - 1];
  const ultimo = centros.length - 1;
  for (let i = 0; i < centros.length; i++) {
    for (let j = 0; j < centros.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === ultimo) || (i === ultimo && j === 0)) continue;
      for (let df = -2; df <= 2; df++) {
        for (let dc = -2; dc <= 2; dc++) {
          poner(centros[i] + df, centros[j] + dc, Math.max(Math.abs(df), Math.abs(dc)) !== 1);
        }
      }
    }
  }
  // Formato (reservado acá; se escribe con la máscara elegida) y el módulo oscuro.
  escribirFormato({ n, modulos, funcion }, 0);
  // Versión, desde la 7.
  if (version >= 7) {
    const bits = bitsDeVersion(version);
    for (let i = 0; i < 18; i++) {
      const oscuro = ((bits >>> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = n - 11 + (i % 3);
      poner(a, b, oscuro);
      poner(b, a, oscuro);
    }
  }
  return { n, modulos, funcion };
}

function escribirFormato({ n, modulos, funcion }: Lienzo, mascara: number): void {
  const bits = bitsDeFormato(mascara);
  const bit = (i: number): boolean => ((bits >>> i) & 1) === 1;
  const poner = (fila: number, col: number, oscuro: boolean): void => {
    modulos[fila][col] = oscuro;
    funcion[fila][col] = true;
  };
  // Primera copia, alrededor del buscador de arriba a la izquierda.
  for (let i = 0; i <= 5; i++) poner(i, 8, bit(i));
  poner(7, 8, bit(6));
  poner(8, 8, bit(7));
  poner(8, 7, bit(8));
  for (let i = 9; i < 15; i++) poner(8, 14 - i, bit(i));
  // Segunda copia, partida entre los otros dos buscadores.
  for (let i = 0; i < 8; i++) poner(8, n - 1 - i, bit(i));
  for (let i = 8; i < 15; i++) poner(n - 15 + i, 8, bit(i));
  // El módulo oscuro, en (4v + 9, 8).
  poner(n - 8, 8, true);
}

const MASCARAS: ReadonlyArray<(f: number, c: number) => boolean> = [
  (f, c) => (f + c) % 2 === 0,
  (f) => f % 2 === 0,
  (_f, c) => c % 3 === 0,
  (f, c) => (f + c) % 3 === 0,
  (f, c) => (Math.floor(f / 2) + Math.floor(c / 3)) % 2 === 0,
  (f, c) => ((f * c) % 2) + ((f * c) % 3) === 0,
  (f, c) => (((f * c) % 2) + ((f * c) % 3)) % 2 === 0,
  (f, c) => (((f + c) % 2) + ((f * c) % 3)) % 2 === 0,
];

/** El recorrido en zigzag de dos columnas, de abajo a la derecha, salteando la columna 6 y los módulos de función. */
function colocarCodewords({ n, modulos, funcion }: Lienzo, codewords: readonly number[]): void {
  const totalBits = codewords.length * 8;
  let i = 0;
  for (let derecha = n - 1; derecha >= 1; derecha -= 2) {
    if (derecha === 6) derecha = 5;
    const subiendo = ((derecha + 1) & 2) === 0;
    for (let k = 0; k < n; k++) {
      const fila = subiendo ? n - 1 - k : k;
      for (let j = 0; j < 2; j++) {
        const col = derecha - j;
        if (funcion[fila][col] || i >= totalBits) continue;
        modulos[fila][col] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
        i++;
      }
    }
  }
  // Los bits de resto (7 en las versiones 2 a 6) quedan claros, como manda la norma.
}

function aplicarMascara({ n, modulos, funcion }: Lienzo, mascara: number): void {
  const condicion = MASCARAS[mascara];
  for (let f = 0; f < n; f++) {
    for (let c = 0; c < n; c++) {
      if (!funcion[f][c] && condicion(f, c)) modulos[f][c] = !modulos[f][c];
    }
  }
}

// ─── Penalización (§7.8.3: N1 = 3, N2 = 3, N3 = 40, N4 = 10) ────────────────

function penalizacion(modulos: readonly (readonly boolean[])[]): number {
  const n = modulos.length;
  let total = 0;
  const lineas: boolean[][] = [];
  for (let f = 0; f < n; f++) lineas.push([...modulos[f]]);
  for (let c = 0; c < n; c++) lineas.push(modulos.map((fila) => fila[c]));

  for (const linea of lineas) {
    // Regla 1: cinco o más módulos seguidos del mismo color.
    let largo = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && linea[i] === linea[i - 1]) {
        largo++;
        continue;
      }
      if (largo >= 5) total += 3 + (largo - 5);
      largo = 1;
    }
    // Regla 3: tramos en proporción 1:1:3:1:1 (oscuro, claro, oscuro, claro, oscuro), de cualquier ancho n,
    // con claro a los dos lados y de al menos 4n de uno de ellos (cada lado que cumple suma).
    // Fuera del símbolo es claro (la zona de silencio), así que el borde cuenta como claro largo.
    const tramos: number[] = [];
    let actual = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && linea[i] === linea[i - 1]) {
        actual++;
        continue;
      }
      tramos.push(actual);
      actual = 1;
    }
    // Los tramos alternan de color; `primeroOscuro` dice el color del primero.
    const primeroOscuro = linea[0];
    const BORDE = Number.POSITIVE_INFINITY;
    const claroEn = (k: number): number => {
      if (k < 0 || k >= tramos.length) return BORDE;
      const oscuro = (k % 2 === 0) === primeroOscuro;
      if (oscuro) return 0;
      return k === 0 || k === tramos.length - 1 ? BORDE : tramos[k];
    };
    for (let k = 0; k + 4 < tramos.length; k++) {
      const oscuro = (k % 2 === 0) === primeroOscuro;
      if (!oscuro) continue;
      const a = tramos[k];
      if (tramos[k + 1] !== a || tramos[k + 2] !== 3 * a || tramos[k + 3] !== a || tramos[k + 4] !== a) continue;
      const antes = claroEn(k - 1);
      const despues = claroEn(k + 5);
      if (antes >= 4 * a && despues >= a) total += 40;
      if (despues >= 4 * a && antes >= a) total += 40;
    }
  }
  // Regla 2: cada bloque de 2×2 del mismo color.
  for (let f = 0; f < n - 1; f++) {
    for (let c = 0; c < n - 1; c++) {
      const v = modulos[f][c];
      if (v === modulos[f][c + 1] && v === modulos[f + 1][c] && v === modulos[f + 1][c + 1]) total += 3;
    }
  }
  // Regla 4: el menor k ≥ 0 con (45 − 5k) % ≤ oscuros ≤ (55 + 5k) %.
  let oscuros = 0;
  for (const fila of modulos) for (const v of fila) if (v) oscuros++;
  const cuadrados = n * n;
  total += 10 * Math.max(0, Math.ceil(Math.abs(oscuros * 20 - cuadrados * 10) / cuadrados) - 1);
  return total;
}

// ─── Armado ─────────────────────────────────────────────────────────────────

/** Separa los datos en bloques, les agrega la corrección e intercala (§7.6). */
function intercalar(datos: readonly number[], version: number): number[] {
  const { ec, grupos } = BLOQUES_M[version - 1];
  const bloques: number[][] = [];
  let k = 0;
  for (const [cantidad, largo] of grupos) {
    for (let b = 0; b < cantidad; b++) {
      bloques.push(datos.slice(k, k + largo));
      k += largo;
    }
  }
  const correcciones = bloques.map((b) => correccionReedSolomon(b, ec));
  const salida: number[] = [];
  const maximo = Math.max(...bloques.map((b) => b.length));
  for (let i = 0; i < maximo; i++) for (const b of bloques) if (i < b.length) salida.push(b[i]);
  for (let i = 0; i < ec; i++) for (const e of correcciones) salida.push(e[i]);
  return salida;
}

function congelar(lienzo: Lienzo, version: number, mascara: number): MatrizQr {
  return {
    version,
    tamano: lienzo.n,
    mascara,
    modulos: lienzo.modulos.map((fila) => Object.freeze([...fila])),
  };
}

/**
 * El símbolo a partir de los codewords de DATOS ya completos de la versión (con
 * terminador y relleno). Con `mascara` la fuerza; sin ella, la de menor penalización
 * (ante un empate, la de número menor).
 */
export function simboloDesdeDatos(datos: readonly number[], version: number, mascara?: number): MatrizQr {
  validarVersion(version);
  if (datos.length !== codewordsDeDatos(version)) {
    throw new RangeError(`la versión ${version}-M lleva ${codewordsDeDatos(version)} codewords de datos, no ${datos.length}`);
  }
  if (mascara !== undefined) validarMascara(mascara);
  const codewords = intercalar(datos, version);
  const candidatas = mascara === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [mascara];
  let mejor: { lienzo: Lienzo; mascara: number; puntos: number } | null = null;
  for (const m of candidatas) {
    const lienzo = lienzoConFunciones(version);
    colocarCodewords(lienzo, codewords);
    aplicarMascara(lienzo, m);
    escribirFormato(lienzo, m);
    const puntos = candidatas.length === 1 ? 0 : penalizacion(lienzo.modulos);
    if (mejor === null || puntos < mejor.puntos) mejor = { lienzo, mascara: m, puntos };
  }
  return congelar(mejor!.lienzo, version, mejor!.mascara);
}

/** Modo byte: indicador 0100, cantidad, los bytes, terminador, relleno a byte y los codewords 0xEC / 0x11. */
function datosEnModoByte(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const escribir = (valor: number, largo: number): void => {
    for (let i = largo - 1; i >= 0; i--) bits.push((valor >>> i) & 1);
  };
  escribir(0b0100, 4);
  escribir(bytes.length, bitsDeCantidad(version));
  for (const b of bytes) escribir(b, 8);
  const capacidad = codewordsDeDatos(version) * 8;
  escribir(0, Math.min(4, capacidad - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const datos: number[] = [];
  for (let i = 0; i < bits.length; i += 8) datos.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let i = 0; datos.length < codewordsDeDatos(version); i++) datos.push(i % 2 === 0 ? 0xec : 0x11);
  return datos;
}

/**
 * El QR del texto, en la versión más chica que lo contiene (1 a 10), modo byte
 * UTF-8 y corrección M. `null` si no entra en la versión 10: nunca se recorta.
 */
export function codificarQr(texto: string, opciones: { readonly mascara?: number } = {}): MatrizQr | null {
  if (opciones.mascara !== undefined) validarMascara(opciones.mascara);
  const bytes = new TextEncoder().encode(texto);
  for (let version = 1; version <= VERSION_MAXIMA; version++) {
    if (bytes.length <= capacidadEnBytes(version)) {
      return simboloDesdeDatos(datosEnModoByte(bytes, version), version, opciones.mascara);
    }
  }
  return null;
}

const MAPAS_DE_FUNCION = new Map<number, readonly (readonly boolean[])[]>();

/** Si el módulo (fila, columna) es de función (buscador, separador, temporización, alineación, formato o versión). */
export function esModuloDeFuncion(version: number, fila: number, col: number): boolean {
  validarVersion(version);
  let mapa = MAPAS_DE_FUNCION.get(version);
  if (!mapa) {
    mapa = lienzoConFunciones(version).funcion;
    MAPAS_DE_FUNCION.set(version, mapa);
  }
  return mapa[fila]?.[col] ?? false;
}
