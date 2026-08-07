import { describe, expect, it } from 'vitest';
import { MESA_CREATION_OUTCOME_BY_STATUS, MESA_STATUSES } from './types';
import { mesaStatusLabel } from '../utils/labels';

/**
 * ⭐ EL UNION DE ESTADOS DE MESA, CONTRA LA FSM DEL DUEÑO.
 *
 * ## El defecto que este gate cierra, encontrado en la ORDEN 2-A
 *
 * `MesaStatus` tenía ONCE estados y `TRANSITIONS.mesa` del backend tiene DOCE:
 * faltaba **`dispersed`**, el terminal del flujo legacy sin garantía, y
 * faltaba desde siempre. No lo notó nadie porque **ninguna verificación
 * comparaba las dos listas**: TypeScript no valida contra el backend, y un
 * `status` que el tipo no declara igual llega en runtime.
 *
 * No era inofensivo. `mesaStatusLabel` es un `Record` EXHAUSTIVO sobre el
 * union, así que `dispersed` caía en el fallback `?? 'En curso'`: **una mesa
 * terminada se leía como si siguiera viva.**
 *
 * Es la forma exacta del dato que ningún gate mira: nada lo contradecía nunca.
 * Ahora esto lo contradice, en las dos direcciones.
 */

const ESPEJO = import.meta.glob('/contract-mirror/utils/stateMachine.js', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/**
 * Se leen las claves del bloque `mesa: { … }` de `TRANSITIONS`. Es parsing de
 * texto, sí — el espejo no se ejecuta desde `src/` — y por eso el test empieza
 * afirmando que encontró algo: un regex que no matchea daría una lista vacía y
 * todo pasaría en verde sin haber comparado nada.
 */
function estadosDeLaFsm(): string[] {
  const fuente = ESPEJO['/contract-mirror/utils/stateMachine.js'];
  expect(fuente, 'no se pudo leer stateMachine.js del espejo').toBeTruthy();
  const bloque = /\bmesa:\s*\{([\s\S]*?)\n\s{2}\}/.exec(fuente!);
  expect(bloque, 'no se encontró el bloque TRANSITIONS.mesa').toBeTruthy();
  const estados = [...bloque![1]!.matchAll(/^\s{4}([a-z_]+):\s*\[/gm)].map((m) => m[1]!);
  return [...new Set(estados)].sort();
}

describe('MesaStatus espeja la FSM del dueño', () => {
  const fsm = estadosDeLaFsm();

  it('el parseo encontró la FSM de verdad (si no, todo pasaría en vacío)', () => {
    expect(fsm.length).toBeGreaterThanOrEqual(12);
    expect(fsm).toContain('pending_auth');
    expect(fsm).toContain('completed');
  });

  it('🔴 el union declara EXACTAMENTE los estados de la FSM, sin faltantes ni fósiles', () => {
    expect([...MESA_STATUSES].sort()).toEqual(fsm);
  });

  it('🔴 `dispersed` está — por nombre, no por conteo', () => {
    // Se nombra explícito: si mañana alguien lo saca "porque el MVP no lo usa",
    // el mensaje dice qué falta en vez de mostrar dos números distintos.
    expect(MESA_STATUSES).toContain('dispersed');
    expect(fsm).toContain('dispersed');
  });

  it('🔴 ningún estado cae en el fallback del label: los doce tienen texto propio', () => {
    // El fallback existe para lo que el backend agregue mañana, no para tapar
    // un estado que YA existe. `dispersed` vivía ahí y decía "En curso" sobre
    // una mesa terminada.
    for (const estado of MESA_STATUSES) {
      expect(mesaStatusLabel(estado), estado).not.toBe('En curso');
    }
    // Y el fallback sigue vivo para lo desconocido.
    expect(mesaStatusLabel('estado_del_futuro')).toBe('En curso');
  });

  it('🔴 la matriz status → outcome cubre los doce, sin inventar ninguno', () => {
    expect(Object.keys(MESA_CREATION_OUTCOME_BY_STATUS).sort()).toEqual(fsm);
  });

  it('la clasificación coincide con la que declara el emisor', () => {
    // Copiada de `CREACION_OUTCOMES` en `routes/mesas.js` (v2.48.0). Si el
    // dueño reclasifica un estado, esto queda rojo antes de que el decoder
    // empiece a rechazar respuestas legítimas por "incoherentes".
    expect(MESA_CREATION_OUTCOME_BY_STATUS).toEqual({
      pending_auth: 'requires_action',
      open: 'open',
      partially_paid: 'partially_paid',
      auth_failed: 'terminal',
      cancelled: 'terminal',
      expired: 'terminal',
      fully_paid: 'replayable',
      settling: 'replayable',
      settled: 'replayable',
      dispersing: 'replayable',
      completed: 'replayable',
      dispersed: 'replayable',
    });
  });
});
