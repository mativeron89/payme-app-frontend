import { describe, expect, it } from 'vitest';
import {
  VERSION_MAXIMA,
  bitsDeFormato,
  bitsDeVersion,
  capacidadEnBytes,
  codificarQr,
  correccionReedSolomon,
  esModuloDeFuncion,
  simboloDesdeDatos,
  type MatrizQr,
} from './codificarQr';
import {
  ANEXO_I,
  ANEXO_I_POR_MASCARA,
  CAPACIDAD_BYTE_M,
  LINKS_DE_REFERENCIA,
  MASCARAS_AUTOMATICAS,
  MASCARAS_DEL_LINK_125,
  type ReferenciaQr,
} from './qrFixtures';

/**
 * D622 · AF-3 · mejora 6 (§7 de la especificación) · el generador propio (D630).
 * «Un QR decorativo que no decodifique sería peor que no tenerlo»: por eso se
 * compara MÓDULO A MÓDULO con matrices de otras implementaciones (qrcodegen y segno, fuera del
 * repo; ver `qrFixtures.ts`), y lo cierra la prueba de Mati con la cámara (D63).
 */

const filas = (m: MatrizQr): string[] => m.modulos.map((fila) => fila.map((b) => (b ? '1' : '0')).join(''));

/** La primera fila y columna que difieren, para que un rojo diga dónde. */
function primeraDiferencia(m: MatrizQr, ref: ReferenciaQr): string | null {
  const mias = filas(m);
  if (mias.length !== ref.filas.length) return `tamaño ${mias.length} ≠ ${ref.filas.length}`;
  for (let r = 0; r < mias.length; r++) {
    const c = [...mias[r]].findIndex((v, i) => v !== ref.filas[r][i]);
    if (c >= 0) return `fila ${r}, columna ${c}`;
  }
  return null;
}

function bitsANumeros(bits: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return out;
}

/** El anexo I en modo numérico, armado acá: el generador de la app sólo codifica en modo byte. */
function datosDelAnexoI(): number[] {
  const b = (v: number, n: number) => v.toString(2).padStart(n, '0');
  let bits = '0001' + b(8, 10) + b(12, 10) + b(345, 10) + b(67, 7) + '0000';
  while (bits.length % 8 !== 0) bits += '0';
  const datos = bitsANumeros(bits);
  for (let i = 0; datos.length < 16; i++) datos.push(i % 2 === 0 ? 0xec : 0x11);
  return datos;
}

describe('codificarQr · contra el anexo I de ISO/IEC 18004', () => {
  it('🔴 los 16 codewords de datos de «01234567» (1-M)', () => {
    expect(datosDelAnexoI()).toEqual([16, 32, 12, 86, 97, 128, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17]);
  });

  it('🔴 Reed-Solomon da los 10 codewords de corrección del anexo', () => {
    expect(correccionReedSolomon(datosDelAnexoI(), 10)).toEqual([165, 36, 212, 193, 237, 54, 199, 135, 44, 85]);
  });

  it('🔴 el símbolo completo es el de la referencia, módulo a módulo, con la misma máscara automática', () => {
    const m = simboloDesdeDatos(datosDelAnexoI(), 1);
    expect(m.version).toBe(1);
    expect(m.mascara).toBe(ANEXO_I.mascara);
    expect(primeraDiferencia(m, ANEXO_I)).toBeNull();
  });

  for (const ref of ANEXO_I_POR_MASCARA) {
    it(`el anexo con la máscara ${ref.mascara} forzada, igual módulo a módulo (qrcodegen y segno)`, () => {
      const m = simboloDesdeDatos(datosDelAnexoI(), 1, ref.mascara);
      expect(m.mascara).toBe(ref.mascara);
      expect(primeraDiferencia(m, ref)).toBeNull();
    });
  }
});

describe('codificarQr · contra matrices de otra implementación (qrcodegen)', () => {
  it('las referencias son las que pide la orden: 40, 90, 125 y 200 caracteres', () => {
    expect(LINKS_DE_REFERENCIA.map((r) => r.texto.length)).toEqual([40, 90, 125, 200]);
  });

  for (const ref of LINKS_DE_REFERENCIA) {
    it(`🔴 ${ref.texto.length} caracteres → versión ${ref.version}, máscara ${ref.mascara}, igual módulo a módulo`, () => {
      const m = codificarQr(ref.texto);
      expect(m).not.toBeNull();
      expect(m!.version).toBe(ref.version);
      expect(m!.mascara).toBe(ref.mascara);
      expect(primeraDiferencia(m!, ref)).toBeNull();
    });
  }

  for (const ref of MASCARAS_DEL_LINK_125) {
    it(`el link de 125 con la máscara ${ref.mascara} forzada, igual módulo a módulo`, () => {
      const m = codificarQr(ref.texto, { mascara: ref.mascara });
      expect(m).not.toBeNull();
      expect(m!.mascara).toBe(ref.mascara);
      expect(primeraDiferencia(m!, ref)).toBeNull();
    });
  }
  it('🔴 la penalización elige la misma máscara y versión que la referencia en los 213 largos de link (1 a 213)', () => {
    const distintas = MASCARAS_AUTOMATICAS.filter((ref) => {
      const m = codificarQr(ref.texto);
      return !m || m.version !== ref.version || m.mascara !== ref.mascara;
    }).map((ref) => ref.texto.length);
    expect(MASCARAS_AUTOMATICAS).toHaveLength(213);
    expect(distintas).toEqual([]);
  });
});

describe('codificarQr · capacidad y rechazo', () => {
  it('🔴 la capacidad en bytes de cada versión con corrección M es la medida', () => {
    for (let v = 1; v <= VERSION_MAXIMA; v++) expect(capacidadEnBytes(v), `v${v}`).toBe(CAPACIDAD_BYTE_M[v]);
  });

  it('elige la versión mínima: justo la capacidad entra en v, un byte más pasa a v+1', () => {
    for (let v = 1; v <= VERSION_MAXIMA; v++) {
      expect(codificarQr('a'.repeat(CAPACIDAD_BYTE_M[v]))?.version, `${CAPACIDAD_BYTE_M[v]} bytes`).toBe(v);
      if (v < VERSION_MAXIMA) {
        expect(codificarQr('a'.repeat(CAPACIDAD_BYTE_M[v] + 1))?.version, `${CAPACIDAD_BYTE_M[v] + 1} bytes`).toBe(v + 1);
      }
    }
  });

  it('🔴 rechaza lo que no entra en la versión 10: devuelve null, nunca una matriz recortada', () => {
    expect(codificarQr('a'.repeat(213))?.version).toBe(10);
    expect(codificarQr('a'.repeat(214))).toBeNull();
    expect(codificarQr('a'.repeat(5000))).toBeNull();
  });

  it('cuenta BYTES de UTF-8, no caracteres: 107 «ñ» son 214 bytes y no entran', () => {
    expect(codificarQr('ñ'.repeat(106) + 'a')?.version).toBe(10);
    expect(codificarQr('ñ'.repeat(107))).toBeNull();
  });

  it('una máscara fuera de 0–7 no se acepta', () => {
    expect(() => codificarQr('hola', { mascara: 8 })).toThrow();
    expect(() => codificarQr('hola', { mascara: -1 })).toThrow();
  });
});

/** Lee los 15 bits de formato de una de sus dos copias. */
function formatoLeido(m: MatrizQr, copia: 1 | 2): number {
  const n = m.tamano;
  const pos: Array<[number, number]> = [];
  if (copia === 1) {
    for (let i = 0; i <= 5; i++) pos.push([8, i]);
    pos.push([8, 7], [8, 8], [7, 8]);
    for (let i = 5; i >= 0; i--) pos.push([i, 8]);
  } else {
    for (let i = 0; i < 7; i++) pos.push([n - 1 - i, 8]);
    for (let i = 0; i < 8; i++) pos.push([8, n - 8 + i]);
  }
  // pos[0] es el bit 14 (el más significativo).
  return pos.reduce((acc, [r, c]) => (acc << 1) | (m.modulos[r][c] ? 1 : 0), 0);
}

/** Lee los 18 bits de versión de una de sus dos copias (bit 0 primero). */
function versionLeida(m: MatrizQr, copia: 1 | 2): number {
  const n = m.tamano;
  let v = 0;
  for (let i = 0; i < 18; i++) {
    const a = Math.floor(i / 3);
    const b = n - 11 + (i % 3);
    const bit = copia === 1 ? m.modulos[a][b] : m.modulos[b][a];
    if (bit) v |= 1 << i;
  }
  return v;
}

const BUSCADOR = ['1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111'];

describe('codificarQr · propiedades de cada versión (1 a 10)', () => {
  const porVersion = Array.from({ length: VERSION_MAXIMA }, (_, i) => codificarQr('x'.repeat(CAPACIDAD_BYTE_M[i + 1]))!);

  it('🔴 la matriz de la versión v mide 17 + 4v', () => {
    porVersion.forEach((m, i) => {
      expect(m.version).toBe(i + 1);
      expect(m.tamano).toBe(17 + 4 * (i + 1));
      expect(m.modulos).toHaveLength(m.tamano);
      for (const fila of m.modulos) expect(fila).toHaveLength(m.tamano);
    });
  });

  it('🔴 los tres patrones de búsqueda y sus separadores claros', () => {
    for (const m of porVersion) {
      const n = m.tamano;
      for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
        for (let r = 0; r < 7; r++) {
          expect(m.modulos[r0 + r].slice(c0, c0 + 7).map((b) => (b ? '1' : '0')).join('')).toBe(BUSCADOR[r]);
        }
      }
      for (let i = 0; i < 8; i++) {
        expect(m.modulos[7][i]).toBe(false);
        expect(m.modulos[i][7]).toBe(false);
        expect(m.modulos[7][n - 1 - i]).toBe(false);
        expect(m.modulos[i][n - 8]).toBe(false);
        expect(m.modulos[n - 8][i]).toBe(false);
        expect(m.modulos[n - 1 - i][7]).toBe(false);
      }
    }
  });

  it('🔴 la temporización alterna en la fila 6 y la columna 6, y el módulo oscuro está en (4v+9, 8)', () => {
    for (const m of porVersion) {
      for (let i = 8; i < m.tamano - 8; i++) {
        expect(m.modulos[6][i]).toBe(i % 2 === 0);
        expect(m.modulos[i][6]).toBe(i % 2 === 0);
      }
      expect(m.modulos[4 * m.version + 9][8]).toBe(true);
    }
  });

  it('🔴 el formato se lee de vuelta igual en sus dos copias: corrección M y la máscara elegida', () => {
    for (const m of porVersion) {
      const leido1 = formatoLeido(m, 1);
      expect(leido1).toBe(formatoLeido(m, 2));
      expect(leido1).toBe(bitsDeFormato(m.mascara));
      const sinMascara = leido1 ^ 0x5412;
      expect(sinMascara >> 13).toBe(0b00); // M
      expect((sinMascara >> 10) & 0b111).toBe(m.mascara);
    }
  });

  it('🔴 la versión (desde la 7) se lee de vuelta igual en sus dos copias y su BCH cierra', () => {
    for (const m of porVersion) {
      if (m.version < 7) continue;
      expect(versionLeida(m, 1)).toBe(bitsDeVersion(m.version));
      expect(versionLeida(m, 2)).toBe(bitsDeVersion(m.version));
      expect(bitsDeVersion(m.version) >> 12).toBe(m.version);
    }
    // Los valores publicados de la tabla de versiones (7 y 10).
    expect(bitsDeVersion(7)).toBe(0x07c94);
    expect(bitsDeVersion(10)).toBe(0x0a4d3);
  });

  it('🔴 sin colisión: los módulos de datos son exactamente los bits de los codewords (más los de resto)', () => {
    const totalCodewords = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
    const resto = [0, 7, 7, 7, 7, 7, 0, 0, 0, 0];
    for (const m of porVersion) {
      let datos = 0;
      for (let r = 0; r < m.tamano; r++) {
        for (let c = 0; c < m.tamano; c++) if (!esModuloDeFuncion(m.version, r, c)) datos++;
      }
      expect(datos, `v${m.version}`).toBe(totalCodewords[m.version - 1] * 8 + resto[m.version - 1]);
    }
  });

  it('la máscara automática es determinista: el mismo texto da la misma matriz', () => {
    const a = codificarQr(LINKS_DE_REFERENCIA[2].texto)!;
    const b = codificarQr(LINKS_DE_REFERENCIA[2].texto)!;
    expect(filas(a)).toEqual(filas(b));
  });
});
