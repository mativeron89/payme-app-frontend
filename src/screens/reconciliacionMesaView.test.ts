import { describe, expect, it } from 'vitest';
import type { MesaCreationLookup, MesaCreationOutcome, MesaStatus } from '../api/types';
import { decisionReconciliacion, decisionSinRespuesta } from './reconciliacionMesaView';

/**
 * P0 · QUÉ LIBERA EL JOURNAL DE UNA APERTURA CON GARANTÍA (ORDEN 2A).
 *
 * Lo que se decide acá es si se termina el intento monetario de una apertura
 * congelada. **Liberar de más es una segunda retención por el total de la
 * mesa.** Liberar de menos es un organizador que no puede abrir ninguna mesa
 * en ese navegador. Los dos males son reales; el segundo se arregla con una
 * consulta más, el primero con un refund.
 *
 * La versión anterior de este archivo probaba la contención de 1A.1: que la
 * reconciliación no acreditara por NOMBRE de restaurante ni leyera la ausencia
 * en `/mesas/open` como prueba. Esa mecánica ya no existe —ahora se pregunta
 * por la clave de idempotencia— así que esos mutantes se mudaron: viven en
 * `reconciliacionFuente.test.ts`, que mira el código de la pantalla y falla si
 * alguno de los dos vuelve.
 */

function lookup(
  outcome: MesaCreationOutcome,
  opciones: { code?: string | null; status?: MesaStatus; retry?: boolean } = {},
): MesaCreationLookup {
  const conMesa = outcome !== 'not_found' && outcome !== 'payload_hash_conflict';
  const code = opciones.code === undefined ? 'PA-2847' : opciones.code;
  return {
    found: outcome !== 'not_found',
    outcome,
    retryWithSameKey: opciones.retry ?? (outcome === 'requires_action' || outcome === 'not_found'),
    mesa: conMesa && code
      ? { code, status: opciones.status ?? 'open', totalCents: 84000 }
      : null,
    guarantee: conMesa ? { method: 'card', authorized: outcome !== 'requires_action' } : null,
  };
}

describe('sólo la prueba positiva exacta libera el journal', () => {
  it.each(['open', 'partially_paid', 'replayable'] as const)(
    '%s → acreditada: libera y navega a ESA mesa',
    (outcome) => {
      const d = decisionReconciliacion(lookup(outcome));
      expect(d.veredicto).toBe('acreditada');
      expect(d.liberaJournal).toBe(true);
      expect(d.navegarA).toBe('PA-2847');
      expect(d.permiteReintento).toBe(false);
    },
  );

  it('terminal → libera SIN navegar: la mesa existe pero está muerta', () => {
    // Misma lectura que hace el dueño en `POST /mesas`: ante un estado muerto
    // contesta 409 "rotá la clave", o sea "abrí una nueva".
    const d = decisionReconciliacion(lookup('terminal', { status: 'cancelled' }));
    expect(d.veredicto).toBe('muerta');
    expect(d.liberaJournal).toBe(true);
    expect(d.navegarA).toBeNull();
    expect(d.permiteReintento).toBe(false);
    expect(d.copy).toContain('PA-2847');
  });

  it('🔴 MUTANTE · requires_action NO libera: hay un hold sin autorizar', () => {
    const d = decisionReconciliacion(lookup('requires_action', { status: 'pending_auth' }));
    expect(d.veredicto).toBe('a_medias');
    expect(d.liberaJournal).toBe(false);
    // No se navega: una mesa en pending_auth no es una mesa usable todavía.
    expect(d.navegarA).toBeNull();
    // Pero sí se puede retomar ESA garantía, que es lo que dice el contrato.
    expect(d.permiteReintento).toBe(true);
  });

  it('🔴 MUTANTE · not_found NO libera, aunque el contrato habilite reintentar', () => {
    // El 404 dice que ESA CLAVE no creó nada. No dice nada de una generación
    // anterior, y el journal rota la clave ante errores definitivos: una mesa
    // creada por la clave previa seguiría existiendo con su hold.
    const d = decisionReconciliacion(lookup('not_found'));
    expect(d.veredicto).toBe('sin_rastro');
    expect(d.liberaJournal).toBe(false);
    expect(d.permiteReintento).toBe(true);
  });

  it('🔴 MUTANTE · payload_hash_conflict no libera NI reintenta', () => {
    const d = decisionReconciliacion(lookup('payload_hash_conflict'));
    expect(d.veredicto).toBe('conflicto');
    expect(d.liberaJournal).toBe(false);
    expect(d.permiteReintento).toBe(false);
    expect(d.navegarA).toBeNull();
  });

  it('no saber no libera nada', () => {
    const d = decisionSinRespuesta();
    expect(d.veredicto).toBe('no_concluyente');
    expect(d.liberaJournal).toBe(false);
    expect(d.permiteReintento).toBe(false);
    expect(d.navegarA).toBeNull();
    expect(d.copy).toBeTruthy();
  });
});

describe('el reintento que se habilita es SIEMPRE con la misma clave', () => {
  it('permiteReintento sale del contrato, no de la clasificación local', () => {
    // Si el emisor dijera `false` en un `requires_action`, se le hace caso: el
    // contrato es quien sabe cuándo repetir el POST hace algo útil.
    const d = decisionReconciliacion(lookup('requires_action', { status: 'pending_auth', retry: false }));
    expect(d.permiteReintento).toBe(false);
  });

  it('ninguna rama que libera habilita además reintentar', () => {
    // Liberar + reintentar a la vez sería clave nueva sobre mesa viva: el
    // segundo hold. Las dos cosas nunca pueden ser ciertas juntas.
    for (const o of ['open', 'partially_paid', 'replayable', 'terminal'] as const) {
      const d = decisionReconciliacion(lookup(o));
      expect(d.liberaJournal && d.permiteReintento, o).toBe(false);
    }
  });
});

describe('dos fuentes que se contradicen no acreditan ninguna', () => {
  it('🔴 MUTANTE · la referencia guardada difiere del código que contesta el endpoint', () => {
    // El journal anotó PA-2847 cuando llegó la respuesta; el endpoint contesta
    // otra mesa para la misma clave. Alguna de las dos miente.
    const d = decisionReconciliacion(lookup('open', { code: 'PA-9999' }), 'PA-2847');
    expect(d.veredicto).toBe('no_concluyente');
    expect(d.liberaJournal).toBe(false);
  });

  it('coinciden → se acredita igual que sin referencia', () => {
    expect(decisionReconciliacion(lookup('open'), 'PA-2847').liberaJournal).toBe(true);
    expect(decisionReconciliacion(lookup('open'), '  PA-2847  ').liberaJournal).toBe(true);
  });

  it('sin referencia —el caso normal: la respuesta nunca llegó— no hay nada que cruzar', () => {
    for (const vacia of [null, undefined, '', '   ']) {
      expect(decisionReconciliacion(lookup('open'), vacia).liberaJournal).toBe(true);
    }
  });

  it('una referencia sin mesa en la respuesta no bloquea el 404', () => {
    // `not_found` llega sin datos de mesa: no hay contradicción posible, y el
    // veredicto sigue siendo el suyo (que tampoco libera).
    const d = decisionReconciliacion(lookup('not_found'), 'PA-2847');
    expect(d.veredicto).toBe('sin_rastro');
  });
});

describe('la copy no afirma lo que no sabemos', () => {
  it('acreditada no tiene copy: su superficie es la navegación', () => {
    expect(decisionReconciliacion(lookup('open')).copy).toBeNull();
  });

  it('ninguna rama no acreditada dice "no existe" ni promete desbloquear', () => {
    for (const o of ['requires_action', 'not_found', 'payload_hash_conflict'] as const) {
      const texto = decisionReconciliacion(lookup(o)).copy!.toLowerCase();
      expect(texto.length).toBeGreaterThan(0);
      for (const prohibida of ['no existe', 'desbloquear', 'no llegó a crearse']) {
        expect(texto, `"${prohibida}" en ${o}`).not.toContain(prohibida);
      }
    }
  });

  it('una mesa acreditable SIN código no se acredita: el código ES la prueba', () => {
    const d = decisionReconciliacion(lookup('open', { code: null }));
    expect(d.veredicto).toBe('no_concluyente');
    expect(d.liberaJournal).toBe(false);
  });
});
