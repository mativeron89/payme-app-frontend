import { describe, expect, it } from 'vitest';
import { legalAcceptanceResponse } from './contractResponses';

const H = (c: string) => c.repeat(64);
const apagado = { required: false, aviso: null, terminos: null };
const vigente = {
  required: true,
  aviso: { version: '3.0.0', hash: H('a') },
  terminos: { version: '1.0.0', hash: H('b') },
};

/**
 * LEGAL-3.0.0 (AF1) · forma exacta de `GET/POST /api/legal/acceptance` según
 * App Backend - Opus (DISENO_AB1.md §3): tres claves, pares o null. Rojo
 * contra 0.191.1 porque el decoder no existía.
 */
describe('paquete legal · decoder de /legal/acceptance', () => {
  it('acepta el paquete apagado, el vigente pendiente y el vigente ya aceptado', () => {
    expect(legalAcceptanceResponse(apagado)).toEqual(apagado);
    expect(legalAcceptanceResponse(vigente)).toEqual(vigente);
    expect(legalAcceptanceResponse({ ...vigente, required: false })).toEqual({ ...vigente, required: false });
  });

  it.each([
    [null, 'sin cuerpo'],
    [{}, 'vacío'],
    [{ ...apagado, accepted_at: null }, 'clave de más'],
    [{ required: false, aviso: null }, 'clave de menos'],
    [{ ...apagado, required: 'no' }, 'required no booleano'],
    [{ ...vigente, aviso: null }, 'required true sin aviso'],
    [{ ...vigente, terminos: null }, 'required true sin terminos'],
    [{ ...vigente, aviso: { version: '3.0.0' } }, 'par sin hash'],
    [{ ...vigente, aviso: { version: '3.0.0', hash: H('a'), extra: 1 } }, 'par con clave de más'],
    [{ ...vigente, aviso: { version: '3.0.0', hash: H('A') } }, 'huella en mayúsculas'],
    [{ ...vigente, aviso: { version: '3.0.0', hash: 'corto' } }, 'huella corta'],
    [{ ...vigente, terminos: { version: 'v1', hash: H('b') } }, 'versión inválida'],
  ])('falla cerrado ante %j (%s)', (value, _label) => {
    expect(() => legalAcceptanceResponse(value)).toThrow('contract_response_invalid:legal/acceptance');
  });
});
