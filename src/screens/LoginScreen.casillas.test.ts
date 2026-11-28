import { describe, expect, it } from 'vitest';
import { eleccionParaAviso } from '../components/permisosDeTerminos';
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

describe('elección opcional en el alta', () => {
  const aviso = { version: '3.1.0', hash: 'a'.repeat(64) };
  const eleccion = { aviso, elecciones: { foto_perfil_no_amigos: false, analisis_interno: true } };

  it('conserva la elección mixta si versión y hash coinciden', () => {
    expect(eleccionParaAviso(eleccion, { ...aviso })).toEqual(eleccion);
  });

  it.each([
    ['cambia sólo la versión', { ...aviso, version: '3.1.1' }],
    ['cambia sólo el hash', { ...aviso, hash: 'b'.repeat(64) }],
    ['se está leyendo el Aviso', null],
  ] as const)('%s: la elección anterior carece de vigencia', (_, actual) => {
    expect(eleccionParaAviso(eleccion, actual)).toBeNull();
  });

  it('publicar otro par descarta el gesto anterior aunque luego vuelva el primero', () => {
    const descartada = eleccionParaAviso(eleccion, { ...aviso, version: '3.2.0' });
    expect(eleccionParaAviso(descartada, aviso)).toBeNull();
  });
});
