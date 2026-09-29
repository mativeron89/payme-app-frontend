import { describe, expect, it } from 'vitest';
import { casillaVigente } from './LoginScreen';

/**
 * AF-CORRECCIONES-AUDITORIA · AF-01 (auditoría Codex). En el alta, cada casilla
 * guarda el par sobre el que se marcó y cuenta sólo con ese par vigente. El
 * recorrido con 409, 503 y red está en `e2e/legal-cambio-de-par.spec.ts`.
 */
describe('AF-01 · casillaVigente', () => {
  const A = JSON.stringify({ aviso_version: '2.5.5', terminos_version: '1.0.0' });
  const B = JSON.stringify({ aviso_version: '2.5.5', terminos_version: '1.0.1' });

  it('marcada sobre el par vigente: cuenta', () => {
    expect(casillaVigente(A, A)).toBe(true);
  });

  it('sin marcar: no cuenta', () => {
    expect(casillaVigente(null, A)).toBe(false);
  });

  it('marcada sobre otro par: no cuenta (el 409 trajo textos nuevos)', () => {
    expect(casillaVigente(A, B)).toBe(false);
  });

  it('sin par vigente (textos recargando o sin paquete): no cuenta', () => {
    expect(casillaVigente(A, null)).toBe(false);
    expect(casillaVigente(null, null)).toBe(false);
  });
});
