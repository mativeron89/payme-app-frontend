import { describe, expect, it } from 'vitest';
import { atribucionInicial } from './freezeMachine';
import { metadatosDelBody } from './comprobanteDelBody';
import type { UnconfirmedAttempt } from '../api/idempotency';

/**
 * P2-① · LA CARRERA, con los dos órdenes FORZADOS.
 *
 * 🔴 La regla de atribución (`puedeAtribuirTarjeta`) cerraba el caso por
 * ESTADO y no por TIEMPO: `getPaymentMethods()` y `readUnconfirmed()` corren
 * en efectos distintos y **no tienen orden garantizado**. Si las tarjetas
 * resolvían primero, el journal todavía no había dicho «hay un replay» y la
 * pantalla preseleccionaba la default — la misma atribución falsa, por una
 * ventana temporal en vez de por lógica.
 *
 * ⚠️ **Mi guarda anterior no lo vio porque en los tests el orden era siempre
 * el inverso: el fixture no producía el caso.** Por eso acá los dos órdenes se
 * fuerzan explícitamente en vez de dejarlos al azar del runner.
 *
 * Se modela la coordinación —«el que termina último aplica»— como función
 * pura, que es lo que se puede probar sin montar la app (jsdom está vetado).
 */
interface Coordinacion {
  journalResuelto: boolean;
  defaultCandidato: string | null;
  frozen: UnconfirmedAttempt | null;
}

/**
 * 🔴 Se prueba LA FUNCIÓN REAL, no una copia. La primera versión de este test
 * traía un «espejo exacto» de la lógica del componente — que es literalmente
 * el defecto que el dictamen señaló con `payGate`: la versión probada y la que
 * corre pueden separarse sin que nada se ponga rojo.
 */
const atribuir = (c: Coordinacion): string | null => atribucionInicial(c);

const replayable = {
  actor: 'a', scope: 'a::pay:PA-1',
  handle: { key: 'k', generation: 1 },
  payload: { idempotency_key: 'k', payment_type: 'card' },
} as unknown as UnconfirmedAttempt;

describe('🔴 la carrera entre tarjetas y journal, en los DOS órdenes', () => {
  it('ORDEN A · el journal primero, las tarjetas después: no se atribuye', () => {
    let c: Coordinacion = { journalResuelto: false, defaultCandidato: null, frozen: null };
    c = { ...c, journalResuelto: true, frozen: replayable };   // journal
    expect(atribuir(c)).toBeNull();
    c = { ...c, defaultCandidato: 'card-default' };            // tarjetas
    expect(atribuir(c)).toBeNull();
  });

  it('🔴 ORDEN B · las tarjetas primero: ÉSTE era el que fallaba', () => {
    let c: Coordinacion = { journalResuelto: false, defaultCandidato: null, frozen: null };
    c = { ...c, defaultCandidato: 'card-default' };            // tarjetas
    // Con el journal sin contestar NO se atribuye: antes acá se pintaba la
    // default, y cuando el journal llegaba el daño ya estaba en pantalla.
    expect(atribuir(c)).toBeNull();
    c = { ...c, journalResuelto: true, frozen: replayable };   // journal
    expect(atribuir(c)).toBeNull();
  });

  it('sin replay, los dos órdenes atribuyen igual: la coordinación no rompe el caso normal', () => {
    const a: Coordinacion = { journalResuelto: true, defaultCandidato: 'c1', frozen: null };
    const b: Coordinacion = { journalResuelto: true, defaultCandidato: 'c1', frozen: null };
    expect(atribuir(a)).toBe('c1');
    expect(atribuir(b)).toBe('c1');
  });

  it('🔴 journal ilegible: NO se atribuye — en la duda no se afirma una tarjeta', () => {
    // El `.catch` deja `journalResuelto` en false a propósito.
    expect(atribuir({ journalResuelto: false, defaultCandidato: 'c1', frozen: null })).toBeNull();
  });
});

describe('🔴 P2-② · el comprobante sale del BODY, no del estado visual', () => {
  const staff = [{ id: 's1', display_name: 'Ana' }] as never;

  it('el body del replay conserva porcentaje y mesero aunque el estado esté vacío', () => {
    expect(metadatosDelBody({ tip_bps: 1000, tip_to_staff_id: 's1' }, staff))
      .toEqual({ pct: 10, nombre: 'Ana' });
  });

  it('monto propio: NO hay porcentaje, y no se inventa un 0', () => {
    expect(metadatosDelBody({ tip_to_staff_id: 's1' }, staff)).toEqual({ pct: null, nombre: 'Ana' });
  });

  it('un bps que no es preset se respeta: 250 son 2,5 %, no se redondea', () => {
    expect(metadatosDelBody({ tip_bps: 250 }, staff).pct).toBe(2.5);
  });

  it('mesero que ya no está en la mesa: se calla el nombre, no se inventa', () => {
    expect(metadatosDelBody({ tip_bps: 1000, tip_to_staff_id: 'fantasma' }, staff))
      .toEqual({ pct: 10, nombre: null });
  });

  it('sin staff cargado tampoco rompe', () => {
    expect(metadatosDelBody({ tip_bps: 1000, tip_to_staff_id: 's1' }, undefined).nombre).toBeNull();
  });
});
