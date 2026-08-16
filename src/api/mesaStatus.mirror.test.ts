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

const ESPEJO = import.meta.glob(
  ['/contract-mirror/utils/stateMachine.js', '/contract-mirror/routes/mesas.js'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

/**
 * 🔴 LA CLASIFICACIÓN, LEÍDA DEL ESPEJO · corregido el 2026-08-16.
 *
 * Acá abajo había una copia A MANO de `CREACION_OUTCOMES`, y su comentario
 * prometía: *«si el dueño reclasifica un estado, esto queda rojo»*. **Era
 * falso.** El test comparaba el union contra **otra constante de este mismo
 * repo**, sin abrir `routes/mesas.js` nunca. Si el dueño movía `settled` de
 * `replayable` a `terminal`, el espejo cambiaba y **esto seguía verde**: lo
 * único que lo ponía rojo era editar `types.ts`, o sea el lado equivocado.
 *
 * Es la clase que el Bibliotecario señaló como la más dura: **una afirmación de
 * fidelidad que ninguna guarda sostiene** — con el agravante de que acá el
 * comentario afirmaba la guarda que faltaba, así que quien lo leyera quedaba
 * tranquilo por escrito.
 *
 * Ahora los cinco grupos se leen del espejo. El fallback `unknown` no se lee:
 * es lo que la función devuelve cuando ningún grupo matchea, y se afirma abajo
 * como propiedad, no como lista.
 */
function clasificacionDelEmisor(): Record<string, string> {
  const fuente = ESPEJO['/contract-mirror/routes/mesas.js'];
  expect(fuente, 'no se pudo leer routes/mesas.js del espejo').toBeTruthy();
  const grupos: [string, string][] = [
    ['CREACION_REQUIERE_ACCION', 'requires_action'],
    ['CREACION_ABIERTA', 'open'],
    ['CREACION_PARCIAL', 'partially_paid'],
    ['CREACION_TERMINAL', 'terminal'],
    ['CREACION_REPLAYABLE', 'replayable'],
  ];
  const fuera: Record<string, string> = {};
  for (const [constante, outcome] of grupos) {
    const bloque = new RegExp(`const ${constante}\\s*=\\s*Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\)`).exec(fuente!);
    expect(bloque, `no se encontró ${constante} en el espejo`).toBeTruthy();
    const estados = [...bloque![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
    expect(estados.length, `${constante} quedó vacío: el parseo mediría en vacío`).toBeGreaterThan(0);
    for (const e of estados) fuera[e] = outcome;
  }
  return fuera;
}

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

  it('🔴 la clasificación se LEE del espejo · si el dueño reclasifica, esto queda rojo', () => {
    // Ahora sí hace lo que su comentario prometía: la expectativa sale de
    // `contract-mirror/routes/mesas.js`, no de una copia a mano de este repo.
    expect(MESA_CREATION_OUTCOME_BY_STATUS).toEqual(clasificacionDelEmisor());
  });

  it('🔴 SONDA · el parseo del espejo encontró los cinco grupos de verdad', () => {
    // Sin esto, un regex que dejara de matchear devolvería `{}` y el test de
    // arriba compararía contra vacío… y pasaría sólo si el union también
    // estuviera vacío. Se afirma la forma, no sólo que no explotó.
    const emisor = clasificacionDelEmisor();
    expect(Object.keys(emisor).length, 'el espejo devolvió menos estados que la FSM').toBe(fsm.length);
    expect(new Set(Object.values(emisor))).toEqual(
      new Set(['requires_action', 'open', 'partially_paid', 'terminal', 'replayable']),
    );
  });

  it('🔴 `unknown` NO sale de una lista: es lo que el emisor devuelve por descarte', () => {
    // El sexto outcome no está en ningún grupo del espejo a propósito — es el
    // `return 'unknown'` final de `outcomeDeCreacion`. Se afirma como propiedad
    // para que nadie lo agregue a la tabla creyendo que faltaba.
    expect(Object.values(clasificacionDelEmisor())).not.toContain('unknown');
    expect(MESA_CREATION_OUTCOME_BY_STATUS['estado_del_futuro' as never]).toBeUndefined();
  });
});
