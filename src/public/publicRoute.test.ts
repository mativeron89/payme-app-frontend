import { describe, expect, it } from 'vitest';
import {
  codigoValido,
  PATH_PRIVACIDAD,
  PREFIJO_ELIMINACION,
  resolverRutaPublica,
} from './publicRoute';

/**
 * El parser de superficies públicas · APP-FE-META-PUBLIC-COMPLIANCE-01.
 *
 * Lo que se afirma acá es el CONTRATO DE PATHS con Meta. Un parser flojo de más
 * manda a una superficie sin sesión URLs que no le corresponden; uno flojo de
 * menos deja al shell autenticado montándose sobre un pathname que lleva un
 * `confirmation_code`. Las dos direcciones se prueban.
 */

/** 24 caracteres, múltiplo de 4, alfabeto completo. Un código legítimo. */
const CODIGO_OK = 'abcDEF012345_-ghIJKLmnop';

describe('resolverRutaPublica · el censo de paths', () => {
  it('las constantes son las del contrato Meta y no otras', () => {
    // Si alguien las renombra «para que quede más lindo», Meta deja de
    // encontrar la página y nadie se entera hasta la revisión de la app.
    expect(PATH_PRIVACIDAD).toBe('/privacy');
    expect(PREFIJO_ELIMINACION).toBe('/facebook-data-deletion/');
  });

  it('✅ `/privacy` exacto es la superficie de privacidad', () => {
    expect(resolverRutaPublica('/privacy')).toEqual({ tipo: 'privacidad' });
  });

  it('✅ `/facebook-data-deletion/<code>` trae el código consultable', () => {
    expect(resolverRutaPublica(`${PREFIJO_ELIMINACION}${CODIGO_OK}`))
      .toEqual({ tipo: 'eliminacion', code: CODIGO_OK });
  });

  /**
   * 🔴 CONTROL POSITIVO DEL PROPIO CENSO. Sin esto, un parser que devolviera
   * `null` para todo dejaría en verde cada caso negativo de abajo: el conjunto
   * de rechazos no prueba nada si nada se acepta.
   */
  it('🔴 el parser acepta ALGO · si no, los rechazos de abajo miden en vacío', () => {
    const aceptados = ['/privacy', `${PREFIJO_ELIMINACION}${CODIGO_OK}`]
      .map(resolverRutaPublica)
      .filter((r) => r !== null);
    expect(aceptados).toHaveLength(2);
  });

  it.each([
    ['/', 'la raíz'],
    ['/Privacy', 'mayúscula: los paths son sensibles'],
    ['/privacy/', 'con barra final no es el path exacto'],
    ['/privacy/extra', 'con sufijo tampoco'],
    ['/privacidad', 'la traducción no es el contrato'],
    ['/facebook-data-deletion', 'sin barra ni código no es la ruta de estado'],
    ['/otra/facebook-data-deletion/abcDEF012345_-ghIJKLmnop', 'el prefijo va al principio'],
    ['/mesa/PA-1234', 'una ruta cualquiera de la app'],
  ])('🔴 `%s` NO es superficie pública · %s', (path) => {
    expect(resolverRutaPublica(path)).toBeNull();
  });

  /**
   * 🔴 EL CÓDIGO INVÁLIDO SIGUE SIENDO SUPERFICIE PÚBLICA, con `code: null`.
   *
   * Es la decisión que más fácil se rompe «simplificando»: devolver `null` acá
   * haría que el shell autenticado se montara sobre una URL que contiene un
   * código de terceros, con sus requests y su `Referer`. La cabecera
   * `Referrer-Policy: no-referrer` está puesta sobre estas rutas, no sobre la
   * app entera.
   */
  it.each([
    ['', 'vacío'],
    ['corto', 'menos de 20'],
    ['abcDEF012345_-ghIJKLmn+p', 'un `+` no es Base64URL'],
    ['abcDEF012345_-ghIJKLmn/p', 'una `/` no es Base64URL'],
    ['abcDEF012345_-ghIJKLmno=', 'el padding no es canónico'],
    ['abcDEF0123 5_-ghIJKLmnop', 'un espacio'],
    ['%41bcDEF012345_-ghIJKLmnop', 'porcentaje: no se decodifica, no matchea'],
    ['a'.repeat(201), 'más de 200'],
  ])('🔴 código inválido (%s · %s) ⇒ pública SIN consulta', (code) => {
    expect(resolverRutaPublica(`${PREFIJO_ELIMINACION}${code}`))
      .toEqual({ tipo: 'eliminacion', code: null });
  });
});

describe('codigoValido · Base64URL canónico de 20 a 200', () => {
  it('✅ los bordes de longitud entran, y son múltiplos válidos', () => {
    expect(codigoValido('a'.repeat(20))).toBe(true);
    expect(codigoValido('a'.repeat(200))).toBe(true);
  });

  it('🔴 19 y 201 quedan afuera · los límites son inclusivos, no aproximados', () => {
    expect(codigoValido('a'.repeat(19))).toBe(false);
    expect(codigoValido('a'.repeat(201))).toBe(false);
  });

  /**
   * 🔴 `length % 4 === 1` es IMPOSIBLE en base64 y por eso se rechaza.
   *
   * Los caracteres se agrupan de a cuatro; un grupo final de UNO exigiría 6 bits
   * sueltos que ningún codificador produce. 21 y 25 son las dos longitudes ≡1
   * dentro del rango que caerían del lado bueno si alguien borra esa condición
   * «porque parece de más».
   */
  it.each([21, 25, 197])('🔴 largo %i (≡1 mod 4) no lo emite ningún codificador', (n) => {
    expect(codigoValido('a'.repeat(n))).toBe(false);
  });
});

/**
 * 🔴 CANONICIDAD MEDIDA CONTRA BYTES REALES, no contra longitudes.
 *
 * Los controles positivos se **producen codificando bytes**, así que son
 * exactamente lo que emitiría el backend. Los negativos comparten esos mismos
 * bytes y sólo alteran los bits de relleno del último carácter: decodifican
 * igual y no son la codificación canónica.
 *
 * ⚠️ La longitud sola no distingue estos casos —el par legítimo/alterado tiene
 * el MISMO largo—, que es por qué `length % 4` no alcanzaba.
 */
describe('codigoValido · canonicidad Base64URL contra bytes', () => {
  const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  /** Bytes deterministas, para que el caso sea el mismo en toda máquina. */
  const bytes = (n: number): Buffer =>
    Buffer.from(Array.from({ length: n }, (_, i) => (i * 37 + 11) & 0xff));

  const b64url = (b: Buffer): string => b.toString('base64url');

  /** El mismo string con los bits de relleno del último carácter alterados. */
  const alterarRelleno = (code: string): string => {
    const valor = ALFABETO.indexOf(code[code.length - 1]!);
    return code.slice(0, -1) + ALFABETO[valor + 1]!;
  };

  it('🔴 el instrumento produce lo que dice · largos y restos esperados', () => {
    // 15 bytes → 20 caracteres (resto 0) · 16 → 22 (resto 2) · 17 → 23 (resto 3)
    expect([15, 16, 17].map((n) => b64url(bytes(n)).length)).toEqual([20, 22, 23]);
  });

  it.each([15, 16, 17, 30, 60, 149])('✅ %i bytes reales codificados ⇒ código válido', (n) => {
    const code = b64url(bytes(n));
    expect(code.length, 'la muestra se salió del rango de la orden')
      .toBeGreaterThanOrEqual(20);
    expect(codigoValido(code), `rechazó una codificación legítima: ${code}`).toBe(true);
  });

  it.each([16, 17, 31, 32])(
    '🔴 %i bytes con los bits de relleno ALTERADOS ⇒ inválido, y decodifica igual',
    (n) => {
      const original = b64url(bytes(n));
      const alterado = alterarRelleno(original);

      // El control que hace que este test signifique algo: mismos bytes.
      expect(
        Buffer.from(alterado, 'base64url').equals(Buffer.from(original, 'base64url')),
        'la muestra alterada no decodifica a los mismos bytes: no prueba canonicidad',
      ).toBe(true);
      expect(alterado.length, 'cambió el largo: la longitud sola lo distinguiría')
        .toBe(original.length);
      expect(alterado, 'la alteración no cambió nada').not.toBe(original);

      expect(codigoValido(original)).toBe(true);
      expect(codigoValido(alterado), `aceptó una codificación no canónica: ${alterado}`)
        .toBe(false);
    },
  );

  it('🔴 y un código no canónico deja la superficie pública SIN consultar', () => {
    const alterado = alterarRelleno(b64url(bytes(16)));
    expect(resolverRutaPublica(`${PREFIJO_ELIMINACION}${alterado}`))
      .toEqual({ tipo: 'eliminacion', code: null });
  });
});
