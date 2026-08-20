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

/**
 * 🔴 AF-03 · EL ORÁCULO DEL MUTANTE QUE EL E2E NO PUEDE MATAR, y por qué es
 * éste y no otro.
 *
 * El mutante que Codex nombra —restaurar la procedencia pre-P20, o sea leer
 * `tip`/`staffId` del estado visual— **sólo diverge en un caso: un replay
 * congelado tras remount**, donde el estado nace vacío y el cuerpo conserva el
 * dato. **Ese escenario no se puede producir en la suite de navegador:** en
 * modo mock el pago resuelve en proceso, no hay red que abortar, y fabricar un
 * journal congelado a mano exigiría escribir sus internas —índices
 * digeridos— desde el test, que es acoplar la prueba a lo que vino a proteger.
 *
 * Lo verifiqué: con el mutante puesto, el E2E de las tres superficies queda
 * **verde 2/2**. Así que se cubre donde SÍ es verificable — **que el cableado
 * no PUEDA leer el estado visual**— y se declara que es una acreditación de
 * fuente, más débil que un recorrido.
 */
describe('🔴 el comprobante no puede leer el estado visual (AF-03)', () => {
  const SRC = (
    import.meta.glob('/src/screens/MesaScreen.tsx', {
      query: '?raw', import: 'default', eager: true,
    }) as Record<string, string>
  )['/src/screens/MesaScreen.tsx']!;
  const vivo = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // El bloque que arma el comprobante, acotado: mirar el archivo entero
  // matchearía usos legítimos de `tip` en la pantalla de pago.
  const bloque = vivo.slice(vivo.indexOf('setResult({'), vivo.indexOf('});', vivo.indexOf('setResult({')));

  it('el bloque del comprobante existe: si no, esto mediría en vacío', () => {
    expect(bloque.length).toBeGreaterThan(100);
  });

  it('🔴 sale de `metaPropina`, derivado del body', () => {
    expect(bloque).toMatch(/tipPct:\s*metaPropina\.pct/);
    expect(bloque).toMatch(/tipToName:\s*metaPropina\.nombre/);
  });

  it('🔴 y NO toca el estado visual: ni `tip.mode` ni `staffId`', () => {
    expect(bloque).not.toMatch(/tip\.mode/);
    expect(bloque).not.toMatch(/staffId/);
  });
});
