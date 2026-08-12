import { describe, expect, it } from 'vitest';

const FUENTES = import.meta.glob(['/src/**/*.ts', '/src/**/*.tsx'], {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

function src(path: string): string {
  const value = FUENTES[`/src/${path}`];
  if (typeof value !== 'string') throw new Error(`fuente no encontrada: ${path}`);
  return value;
}

function body(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  if (start < 0 || end < 0) throw new Error(`no se pudo acotar ${from} → ${to}`);
  return source.slice(start, end);
}

describe('AF-02 · los tres inicios nuevos consumen la capability', () => {
  const cardField = src('components/CardField.tsx');
  const cardsPanel = src('components/CardsPanel.tsx');
  const createMesa = src('screens/CreateMesaFlow.tsx');
  const mesa = src('screens/MesaScreen.tsx');

  it('CardField falla cerrado antes de cargar Stripe', () => {
    expect(cardField).toContain('puedeCargarTarjeta');
    expect(cardField).toContain('canUseCardRail');
    expect(cardField.indexOf('if (!cardRailAvailable)')).toBeGreaterThan(-1);
    expect(cardField.indexOf('if (!cardRailAvailable)')).toBeLessThan(cardField.indexOf('const stripe = await getStripe()'));
    expect(cardField.slice(
      cardField.indexOf('if (!cardRailAvailable)'),
      cardField.indexOf('const stripe = await getStripe()'),
    )).toContain('return;');
  });

  it('alta: consulta capability antes de crear key, SetupIntent o attach fresco', () => {
    const addCard = body(cardsPanel, 'async function addCard()', '\n  return (');
    expect(cardsPanel).toContain('const moneyRail = useMoneyRail();');
    expect(cardsPanel).toContain("const cardRailContinuation = cardRetryStage !== 'none';");
    expect(cardsPanel).toContain('canUseCardRail(moneyRail, cardRailContinuation)');
    expect(addCard).toContain('if (!cardRailAvailable)');
    expect(addCard.indexOf('if (!cardRailAvailable)')).toBeLessThan(addCard.indexOf('newIdempotencyKey()'));
    expect(addCard.indexOf('if (!cardRailAvailable)')).toBeLessThan(addCard.indexOf('api.createSetupIntent('));
    expect(addCard.slice(
      addCard.indexOf('if (!cardRailAvailable)'),
      addCard.indexOf('newIdempotencyKey()'),
    )).toContain('return;');
    expect(cardsPanel).toContain('cardRailAvailable ? (');
  });

  it('garantía: el gate no depende de si la tarjeta nueva es guardada o tipeada', () => {
    const create = body(createMesa, 'async function createMesa()', '\n  async function confirm3ds');
    expect(createMesa).toContain('const moneyRail = useMoneyRail();');
    expect(createMesa).toContain('canUseCardRail(moneyRail, !!frozen)');
    expect(create).toContain("if (method === 'card' && !cardRailAvailable)");
    expect(create.indexOf("if (method === 'card' && !cardRailAvailable)")).toBeLessThan(create.indexOf('acquireMonetaryIntent('));
    expect(create.slice(
      create.indexOf("if (method === 'card' && !cardRailAvailable)"),
      create.indexOf('acquireMonetaryIntent('),
    )).toContain('return;');
    expect(createMesa).toContain("!frozen && method === 'card' && !cardRailAvailable");
    expect(createMesa).toContain('cardRailAvailable ? (');
  });

  it('pago: el gate cubre guardada y tipeada antes de crear journal', () => {
    const pay = body(mesa, 'async function doPay()', '\n  if (!mesa)');
    expect(mesa).toContain('const moneyRail = useMoneyRail();');
    expect(mesa).toContain('canUseCardRail(moneyRail, !!frozenScope)');
    expect(pay).toContain("if (payType === 'card' && !cardRailAvailable)");
    expect(pay.indexOf("if (payType === 'card' && !cardRailAvailable)")).toBeLessThan(pay.indexOf('acquireMonetaryIntent('));
    expect(pay.slice(
      pay.indexOf("if (payType === 'card' && !cardRailAvailable)"),
      pay.indexOf('acquireMonetaryIntent('),
    )).toContain('return;');
    expect(mesa).toContain("!frozenScope && payType === 'card' && !cardRailAvailable");
    expect(mesa).toContain('cardRailAvailable ? (');
  });
});

describe('AF-02 · lo ya emitido no queda bloqueado por el gate de inicio', () => {
  it('Stripe 3DS y el polling de garantía no consultan moneyRail', () => {
    const stripe = src('api/stripe.ts');
    const api = src('api/index.ts');
    expect(stripe).toContain('confirmCardPayment');
    expect(api).toContain('confirmGuarantee3ds');
    expect(stripe).not.toContain('useMoneyRail');
    expect(stripe).not.toContain('puedeCargarTarjeta');
    expect(api).not.toContain('useMoneyRail');
    expect(api).not.toContain('puedeCargarTarjeta');
  });

  it('los call-sites conservan 3DS, replay congelado y diagnóstico', () => {
    const create = src('screens/CreateMesaFlow.tsx');
    const mesa = src('screens/MesaScreen.tsx');
    expect(create).toContain('async function confirm3ds()');
    expect(create).toContain('api.confirmGuarantee3ds(');
    expect(create).toContain('reconcileMonetaryIntent(');
    expect(mesa).toContain('if (frozen?.payload)');
    expect(mesa).toContain('confirmCardPayment(clientSecret');
    expect(mesa).toContain('reconcileMonetaryIntent(');
  });

  it('listar, quitar y elegir principal no se subordinan a la capability', () => {
    const panel = src('components/CardsPanel.tsx');
    for (const [from, to] of [
      ['function loadPms()', '\n\n  // Tarjetas'],
      ['async function setDefault', '\n\n  async function removePm'],
      ['async function removePm', '\n\n  /**'],
    ] as const) {
      const operation = body(panel, from, to);
      expect(operation).not.toContain('cardRailAvailable');
      expect(operation).not.toContain('puedeCargarTarjeta');
    }
  });

  it('la copy de cierre no nombra ni deduce un modo', () => {
    const cardField = src('components/CardField.tsx');
    expect(cardField).toContain('CARD_RAIL_UNAVAILABLE_COPY');
    const declaration = body(cardField, 'export const CARD_RAIL_UNAVAILABLE_COPY', ';');
    expect(declaration).not.toMatch(/sandbox|live|disabled/i);
  });
});
