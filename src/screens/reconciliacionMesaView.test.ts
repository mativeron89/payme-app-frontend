import { describe, expect, it } from 'vitest';
import type { OpenMesa } from '../api/types';
import { copyReconciliacion, veredictoReconciliacion } from './reconciliacionMesaView';

/**
 * P0 · LA RECONCILIACIÓN NO ACREDITA POR PARECIDO (ORDEN 1A.1).
 *
 * Lo que se decide acá es si se libera el journal de una apertura CON
 * GARANTÍA: acreditar de más significa una segunda retención por el total de
 * la mesa. El código viejo comparaba **nombres de restaurante**, así que tres
 * escenarios distintos —ninguno hipotético— daban "la mesa ya existe":
 * `undefined === undefined`, la mesa de un amigo en el mismo restaurante
 * (G-28 hizo que `/mesas/open` las traiga), y dos sucursales homónimas.
 *
 * Cada `it` de abajo es uno de los mutantes que la orden pidió acreditar.
 */

function mesa(code: string, restaurante: string | null): OpenMesa {
  return {
    id: `id-${code}`,
    code,
    full_name: `Mesa ${code}`,
    // `restaurant` es obligatorio en el tipo, pero el runtime puede traer
    // cualquier cosa: el escenario `undefined === undefined` nacía de ahí.
    restaurant: (restaurante === null ? undefined : { name: restaurante, category: 'other' }) as OpenMesa['restaurant'],
    total_cents: 84000,
    paid_amount_cents: 0,
    pct_paid: 0,
    status: 'open',
    expires_at: new Date().toISOString(),
  };
}

describe('sólo el CÓDIGO acredita', () => {
  it('con referencia exacta y la mesa presente → acreditada, con SU código', () => {
    const r = veredictoReconciliacion({
      referencia: 'PA-2847',
      mesas: [mesa('PA-1111', 'Otro'), mesa('PA-2847', 'La Parolaccia')],
    });
    expect(r).toEqual({ veredicto: 'acreditada', code: 'PA-2847' });
  });

  it('🔴 MUTANTE · la mesa de OTRO PARTICIPANTE en el mismo restaurante NO acredita', () => {
    // Desde G-28, `/mesas/open` trae también las mesas donde sos participante:
    // la de un amigo en La Parolaccia matcheaba por nombre. Con código, no.
    const r = veredictoReconciliacion({
      referencia: 'PA-2847',
      mesas: [mesa('PA-9999', 'La Parolaccia')],
    });
    expect(r.veredicto).toBe('no_concluyente');
    expect(r.code).toBeNull();
  });

  it('🔴 MUTANTE · un restaurante HOMÓNIMO no acredita', () => {
    const r = veredictoReconciliacion({
      referencia: 'PA-2847',
      mesas: [mesa('PA-5050', 'La Parolaccia'), mesa('PA-6060', 'La Parolaccia')],
    });
    expect(r.veredicto).toBe('no_concluyente');
  });

  it('🔴 MUTANTE · `undefined === undefined`: mesas sin restaurante no acreditan nada', () => {
    // El caso que no necesitaba dato malformado ni mala fe: el fetch del
    // restaurante falla, la mesa viene sin el objeto, y los dos `?.` daban
    // `undefined` — comparación verdadera, intento cerrado, mesa dada por
    // creada. Acá el nombre no participa de la decisión en ningún caso.
    const r = veredictoReconciliacion({
      referencia: 'PA-2847',
      mesas: [mesa('PA-7777', null), mesa('PA-8888', null)],
    });
    expect(r.veredicto).toBe('no_concluyente');
  });

  it('sin referencia NO se consulta ni se concluye: la respuesta nunca llegó', () => {
    for (const vacia of [null, undefined, '', '   ']) {
      const r = veredictoReconciliacion({ referencia: vacia, mesas: [mesa('PA-2847', 'La Parolaccia')] });
      expect(r.veredicto).toBe('sin_evidencia');
      expect(r.code).toBeNull();
    }
  });

  it('una respuesta de listado rota no acredita ni revienta', () => {
    for (const raro of [null, undefined, [] as OpenMesa[]]) {
      expect(veredictoReconciliacion({ referencia: 'PA-2847', mesas: raro }).veredicto).toBe('no_concluyente');
    }
  });
});

describe('la ausencia tampoco es prueba', () => {
  it('🔴 "no está en /mesas/open" NO es "no existe": una mesa en pending_auth no se lista', () => {
    // La mitad simétrica del defecto: el código viejo leía la ausencia como
    // "no llegó a crearse" y ofrecía desbloquear — o sea, reintentar la
    // garantía sobre una mesa que podía existir con su retención puesta.
    const r = veredictoReconciliacion({ referencia: 'PA-2847', mesas: [] });
    expect(r.veredicto).toBe('no_concluyente');
    expect(r.veredicto).not.toBe('sin_evidencia');
  });

  it('ninguna copy afirma que la mesa no existe, ni promete desbloquear', () => {
    for (const v of ['sin_evidencia', 'no_concluyente'] as const) {
      const texto = copyReconciliacion(v)!.toLowerCase();
      expect(texto.length).toBeGreaterThan(0);
      for (const prohibida of ['no llegó a crearse', 'no existe', 'desbloquear', 'podés abrir']) {
        expect(texto, `"${prohibida}" en el veredicto ${v}`).not.toContain(prohibida);
      }
      // Y sí dice lo único cierto: que no se reintenta la garantía.
      expect(texto).toContain('no reintentamos la garantía');
    }
  });

  it('la acreditada no tiene copy: su superficie es la navegación a esa mesa', () => {
    expect(copyReconciliacion('acreditada')).toBeNull();
  });
});
