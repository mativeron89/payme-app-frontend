import { describe, expect, it } from 'vitest';
import { canUseCardRail, MONEY_RAIL_CERRADO, readMoneyRail } from './moneyRail';

/**
 * `readMoneyRail` · fail-closed sobre la SUPERFICIE DE TARJETA, no sobre el
 * cartel.
 *
 * 🔴 LA DECISIÓN QUE ESTOS TESTS FIJAN (Bibliotecario, 2026-08-11):
 *
 * Tratar esto como «mostrar o no mostrar el aviso» es la trampa, porque las dos
 * salidas son malas — mostrarlo con dinero real le dice a alguien que use una
 * tarjeta falsa, y ocultarlo con dinero de prueba hace que alguien tipee la
 * suya. **Elegir entre las dos es elegir cuál error cometer.**
 *
 * La salida es la de `wallet_rail`: **si no se determina, NO se habilita la
 * superficie.** Nadie escribe un número de tarjeta cuando no sabemos qué pasa
 * con él.
 */

const cfg = (money_rail: unknown) => ({ features: { money_rail } });

describe('🔴 los tres estados del contrato', () => {
  it('sandbox · pagos habilitados, dinero NO real → tarjeta SÍ, cartel SÍ', () => {
    const s = readMoneyRail(cfg({ mode: 'sandbox', payments_enabled: true, real_money: false }));
    expect(s).toMatchObject({
      puedeCargarTarjeta: true, mostrarAvisoDePrueba: true,
      mode: 'sandbox', status: 'authoritative',
    });
  });

  it('live · dinero real → tarjeta SÍ, cartel NO', () => {
    const s = readMoneyRail(cfg({ mode: 'live', payments_enabled: true, real_money: true }));
    expect(s).toMatchObject({ puedeCargarTarjeta: true, mostrarAvisoDePrueba: false });
  });

  it('disabled · pagos apagados → ni tarjeta ni cartel', () => {
    const s = readMoneyRail(cfg({ mode: 'disabled', payments_enabled: false, real_money: false }));
    expect(s).toMatchObject({ puedeCargarTarjeta: false, mostrarAvisoDePrueba: false });
  });
});

describe('🔴 FAIL-CLOSED · si no se determina, NO se ofrece tarjeta', () => {
  it.each([
    ['config no es objeto', 'malformed', 'no soy un objeto'],
    ['sin features', 'malformed', { features: null }],
    ['money_rail ausente · backend previo a D-FF-2', 'absent', { features: {} }],
    ['money_rail no es objeto', 'malformed', cfg('sandbox')],
    ['money_rail es un array', 'malformed', cfg(['sandbox'])],
    ['falta real_money', 'malformed', cfg({ mode: 'sandbox', payments_enabled: true })],
    ['falta payments_enabled', 'malformed', cfg({ mode: 'sandbox', real_money: false })],
    ['real_money es string', 'malformed', cfg({ mode: 'sandbox', payments_enabled: true, real_money: 'false' })],
    ['mode no es string', 'malformed', cfg({ mode: 7, payments_enabled: true, real_money: false })],
  ])('%s → cerrado (%s)', (_caso, status, entrada) => {
    const s = readMoneyRail(entrada);
    expect(s.puedeCargarTarjeta).toBe(false);
    expect(s.mostrarAvisoDePrueba).toBe(false);
    expect(s.status).toBe(status);
  });

  /**
   * 🔴 «falta payments_enabled» merece su propio párrafo: `real_money: false`
   * está presente y leído, así que la tentación es mostrar el cartel igual.
   * **Una respuesta a medias no acredita nada sobre la otra mitad**, y ofrecer
   * el formulario apoyándose en medio contrato es cómo alguien termina tipeando
   * una tarjeta sin que sepamos qué pasa con ella.
   */
  it('🔴 con `real_money:false` LEÍDO pero sin `payments_enabled`, igual CIERRA', () => {
    const s = readMoneyRail(cfg({ mode: 'sandbox', real_money: false }));
    expect(s.mostrarAvisoDePrueba).toBe(false);
    expect(s.puedeCargarTarjeta).toBe(false);
  });

  it('🔴 una clave DE MÁS cierra y la reporta · puede ser un permiso por principal', () => {
    const s = readMoneyRail(cfg({
      mode: 'sandbox', payments_enabled: true, real_money: false, restaurant_id: 'r_1',
    }));
    expect(s.puedeCargarTarjeta).toBe(false);
    expect(s.offendingKeys).toEqual(['restaurant_id']);
  });

  /**
   * 🔴 CONTROL, sin el cual nada de lo de arriba prueba nada: con la forma
   * BUENA sí abre. Un `return CERRADO` al tope pasaría los doce casos previos
   * y dejaría la app sin poder cobrar nunca.
   */
  it('🔴 CONTROL · con la forma buena SÍ abre · si no, el fail-closed es un apagón', () => {
    const s = readMoneyRail(cfg({ mode: 'sandbox', payments_enabled: true, real_money: false }));
    expect(s.puedeCargarTarjeta).toBe(true);
    expect(s.mostrarAvisoDePrueba).toBe(true);
  });
});

describe('🔴 `real_money` se LEE, jamás se deduce de `mode`', () => {
  /**
   * El emisor documenta la versión negativa de este error: *«un
   * `!== "disabled"` habilitaría cualquier basura»*. Acá se fija la positiva:
   * un modo desconocido con `real_money: true` **no muestra cartel**, aunque su
   * nombre no esté en ninguna lista que este front conozca.
   */
  it('un modo FUTURO con dinero real no muestra cartel · no hay lista hardcodeada', () => {
    const s = readMoneyRail(cfg({ mode: 'staging-que-nadie-enseñó', payments_enabled: true, real_money: true }));
    expect(s.mostrarAvisoDePrueba).toBe(false);
    expect(s.puedeCargarTarjeta).toBe(true);
  });

  it('y un modo futuro con dinero de prueba SÍ lo muestra · manda el campo, no el nombre', () => {
    const s = readMoneyRail(cfg({ mode: 'preview', payments_enabled: true, real_money: false }));
    expect(s.mostrarAvisoDePrueba).toBe(true);
  });

  it('🔴 SONDA · el módulo no nombra ningún modo para decidir', async () => {
    // Si alguien mete `mode === 'sandbox'` en la lógica, la decisión vuelve a
    // depender de una lista que envejece. Los nombres pueden estar en los
    // comentarios; en el código ejecutable, no.
    const fuente = (await import('./moneyRail.ts?raw')).default as string;
    const codigo = fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const modo of ['sandbox', 'live', 'disabled']) {
      expect(codigo, `el código compara contra '${modo}'`).not.toContain(`'${modo}'`);
    }
  });
});

describe('AF-02 · inicio nuevo versus continuidad acreditada', () => {
  const closed = [
    ['pending', MONEY_RAIL_CERRADO],
    ['absent', readMoneyRail({ features: {} })],
    ['malformed', readMoneyRail({ features: { money_rail: { mode: 'sandbox' } } })],
    ['disabled', readMoneyRail(cfg({ mode: 'disabled', payments_enabled: false, real_money: false }))],
  ] as const;

  it.each(closed)('%s no permite iniciar otra operación de tarjeta', (_case, rail) => {
    expect(canUseCardRail(rail, false)).toBe(false);
  });

  it.each([
    ['sandbox', readMoneyRail(cfg({ mode: 'sandbox', payments_enabled: true, real_money: false }))],
    ['live', readMoneyRail(cfg({ mode: 'live', payments_enabled: true, real_money: true }))],
  ] as const)('%s permite iniciar una operación nueva', (_case, rail) => {
    expect(canUseCardRail(rail, false)).toBe(true);
  });

  it.each(closed)('%s no oculta una continuidad ya acreditada', (_case, rail) => {
    expect(canUseCardRail(rail, true)).toBe(true);
  });

  it('no usa el cartel como permiso: live abre aunque no muestre aviso', () => {
    const live = readMoneyRail(cfg({ mode: 'live', payments_enabled: true, real_money: true }));
    expect(live.mostrarAvisoDePrueba).toBe(false);
    expect(canUseCardRail(live, false)).toBe(true);
  });
});
