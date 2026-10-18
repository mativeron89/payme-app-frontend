import { describe, expect, it } from 'vitest';
import { CONSERVAR_UNIDADES_Y_SIGLAS, nombreDePlato } from './nombreDePlato';

/**
 * D360-5b · los nombres de la imagen 4 de Mati y los casos del diagnóstico. Lo
 * esperado va escrito a mano, nunca calculado con el código bajo prueba.
 */
describe('nombreDePlato · lo vigente (D370: con unidades y siglas)', () => {
  it('🔴 lo vigente conserva unidades y siglas (D370)', () => {
    expect(CONSERVAR_UNIDADES_Y_SIGLAS).toBe(true);
  });

  it('🔴 los cuatro nombres de la captura de Mati, como los eligió: «Zifon natural 900 ML»', () => {
    expect(nombreDePlato('100 HUGEL COPA')).toBe('100 Hugel copa');
    expect(nombreDePlato('ESPREESO MARTINI')).toBe('Espreeso martini');
    expect(nombreDePlato('ZIFON NATURAL 900 ML')).toBe('Zifon natural 900 ML');
    expect(nombreDePlato('FERNET')).toBe('Fernet');
    expect(nombreDePlato('CERVEZA IPA')).toBe('Cerveza IPA');
  });
});

describe('nombreDePlato · el literal sin excepciones (conservar = false)', () => {
  it('los cuatro nombres de la captura', () => {
    expect(nombreDePlato('100 HUGEL COPA', false)).toBe('100 Hugel copa');
    expect(nombreDePlato('ZIFON NATURAL 900 ML', false)).toBe('Zifon natural 900 ml');
    expect(nombreDePlato('CERVEZA IPA', false)).toBe('Cerveza ipa');
  });

  it('la mayúscula va en la primera letra que empieza una palabra, no en la primera letra a secas', () => {
    expect(nombreDePlato('355ML COCA', false)).toBe('355ml Coca');
    expect(nombreDePlato('2X1 MARGARITAS', false)).toBe('2x1 Margaritas');
    expect(nombreDePlato('½ ORDEN')).toBe('½ Orden');
    expect(nombreDePlato('(SIN HIELO) AGUA')).toBe('(Sin hielo) agua');
  });

  it('acentos y eñes en minúscula y mayúscula de México', () => {
    expect(nombreDePlato('JALAPEÑO')).toBe('Jalapeño');
    expect(nombreDePlato('ÑOQUIS')).toBe('Ñoquis');
    expect(nombreDePlato('CAFÉ AMERICANO')).toBe('Café americano');
  });

  it('🔴 un nombre con alguna minúscula queda tal cual (lo corregido por el dueño o lo tipeado)', () => {
    expect(nombreDePlato('Americano')).toBe('Americano');
    expect(nombreDePlato('Coca Cola 600ML')).toBe('Coca Cola 600ML');
    expect(nombreDePlato('Agua mineral 600 ML')).toBe('Agua mineral 600 ML');
    expect(nombreDePlato('Tagliatelle Bolognese')).toBe('Tagliatelle Bolognese');
    expect(nombreDePlato('pizza')).toBe('pizza');
  });

  it('sin letras, o vacío, queda igual; los espacios se conservan', () => {
    expect(nombreDePlato('')).toBe('');
    expect(nombreDePlato('123')).toBe('123');
    expect(nombreDePlato('½')).toBe('½');
    expect(nombreDePlato('AGUA  MINERAL')).toBe('Agua  mineral');
  });
});

describe('nombreDePlato · con las excepciones (D370)', () => {
  it('las unidades y lo pegado a una cifra quedan como vinieron, como hace el dueño', () => {
    expect(nombreDePlato('ZIFON NATURAL 900 ML', true)).toBe('Zifon natural 900 ML');
    expect(nombreDePlato('AGUA MINERAL 600 ML', true)).toBe('Agua mineral 600 ML');
    expect(nombreDePlato('TACOS AL PASTOR 3 PZA', true)).toBe('Tacos al pastor 3 PZA');
    expect(nombreDePlato('COCA COLA 600ML', true)).toBe('Coca cola 600ML');
    expect(nombreDePlato('2X1 MARGARITAS', true)).toBe('2X1 Margaritas');
  });

  it('las siglas de la lista también; una sigla al principio no recibe otra mayúscula', () => {
    expect(nombreDePlato('CERVEZA IPA', true)).toBe('Cerveza IPA');
    expect(nombreDePlato('IPA ARTESANAL', true)).toBe('IPA artesanal');
    expect(nombreDePlato('COSTILLAS BBQ', true)).toBe('Costillas BBQ');
  });

  it('lo que no está en la lista se normaliza igual', () => {
    expect(nombreDePlato('100 HUGEL COPA', true)).toBe('100 Hugel copa');
    expect(nombreDePlato('FERNET', true)).toBe('Fernet');
  });
});
