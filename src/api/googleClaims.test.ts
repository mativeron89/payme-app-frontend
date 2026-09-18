import { describe, expect, it } from 'vitest';
import { sugerenciaDesdeIdToken } from './googleClaims';

/** Un JWT con forma real: header.payload.firma, en base64url sin padding. */
function jwt(payload: unknown): string {
  const b64 = (texto: string) => Buffer.from(texto, 'utf-8').toString('base64url');
  return `${b64('{"alg":"RS256","typ":"JWT"}')}.${b64(JSON.stringify(payload))}.firma-que-nadie-verifica-aca`;
}

describe('AF-16 · sugerencia de datos desde el id_token de Google', () => {
  it('toma nombre, apellido y correo de los claims, con acentos intactos', () => {
    expect(sugerenciaDesdeIdToken(jwt({
      sub: '1234567890',
      given_name: 'Sofía',
      family_name: 'Núñez',
      email: 'sofia@ejemplo.mx',
    }))).toEqual({ firstName: 'Sofía', lastName: 'Núñez', email: 'sofia@ejemplo.mx' });
  });

  it('recorta espacios y deja vacío cada claim ausente sin tocar los demás', () => {
    expect(sugerenciaDesdeIdToken(jwt({ given_name: '  Ana  ' })))
      .toEqual({ firstName: 'Ana', lastName: '', email: '' });
  });

  const INVALIDOS: ReadonlyArray<readonly [string, string]> = [
    ['la credencial del riel mock, que no es un JWT', 'mock-google-credential-0000'],
    ['dos segmentos', 'aaa.bbb'],
    ['payload con caracteres fuera de base64url', 'aaa.b+b/b.ccc'],
    ['payload que no es JSON', `aaa.${Buffer.from('no json').toString('base64url')}.ccc`],
    ['payload que es un arreglo', jwt(['Sofía'])],
    ['payload null', jwt(null)],
    ['bytes que no son UTF-8', `aaa.${Buffer.from([0xff, 0xfe, 0xfd]).toString('base64url')}.ccc`],
  ];
  for (const [nombre, token] of INVALIDOS) {
    it(`🔴 ${nombre} ⇒ sugerencia vacía, nunca una excepción`, () => {
      expect(sugerenciaDesdeIdToken(token)).toEqual({ firstName: '', lastName: '', email: '' });
    });
  }

  it('🔴 un claim con otro tipo o demasiado largo no se sugiere', () => {
    expect(sugerenciaDesdeIdToken(jwt({
      given_name: 42,
      family_name: 'x'.repeat(101),
      email: `${'a'.repeat(250)}@x.mx`,
    }))).toEqual({ firstName: '', lastName: '', email: '' });
  });

  it('🔴 un correo sin arroba no se sugiere', () => {
    expect(sugerenciaDesdeIdToken(jwt({ email: 'no-es-un-correo' })).email).toBe('');
  });

  it('control positivo de los límites: 100 caracteres de nombre sí pasan', () => {
    expect(sugerenciaDesdeIdToken(jwt({ given_name: 'x'.repeat(100) })).firstName).toHaveLength(100);
  });
});
