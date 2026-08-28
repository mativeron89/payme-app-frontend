import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { api } from './index';
import type { AppConfig } from './types';
import {
  applyNativeWalletsConfig,
  ensureNativeWalletCapabilities,
  nativeWalletAvailable,
  nativeWalletsSnapshot,
  readNativeWallets,
  resetNativeWalletsForTests,
  subscribeNativeWallets,
  type NativeWalletDiscovery,
} from './nativeWallets';

function config(apple: unknown = false, google: unknown = false): AppConfig {
  return {
    version: '2.74.1',
    currency: 'mxn',
    stripe_publishable_key: undefined,
    mesa_hold_seconds: 1_800,
    payment_hold_seconds: 300,
    invitation_expiry_seconds: 86_400,
    item_lock_seconds: 120,
    features: {
      apple_pay: apple,
      google_pay: google,
      stp_dispersal: false,
      ocr_real: false,
      wallet_rail: { enabled: false, account_activity: true },
      social_auth: {},
    },
  };
}

describe('capabilities nativas · independientes y fail-closed', () => {
  it('acepta únicamente booleanos exactos y tolera features ajenas', () => {
    const state = readNativeWallets(config(true, false));
    expect(state.apple.capabilityEnabled).toBe(true);
    expect(state.apple.capabilityStatus).toBe('authoritative');
    expect(state.google.capabilityEnabled).toBe(false);
    expect(state.google.capabilityStatus).toBe('authoritative');
    expect(state.apple.available).toBe(false);
    expect(state.google.available).toBe(false);
  });

  it.each([null, [], 'true', 'false', 1, {}])(
    'string truthy/tipo inválido %j no habilita Apple',
    (raw) => {
      const state = readNativeWallets(config(raw, true));
      expect(state.apple.capabilityEnabled).toBe(false);
      expect(state.apple.capabilityStatus).toBe('malformed');
      expect(state.google.capabilityEnabled).toBe(true);
    },
  );

  it('provider ausente apaga sólo ese provider', () => {
    const payload = config(true, true);
    delete (payload.features as Record<string, unknown>).apple_pay;
    const state = readNativeWallets(payload);
    expect(state.apple.capabilityStatus).toBe('absent');
    expect(state.apple.available).toBe(false);
    expect(state.google.capabilityEnabled).toBe(true);
  });

  it('config/features no plain-object apaga ambos', () => {
    for (const payload of [null, [], 'config', {}, { features: [] }, { features: null }]) {
      const state = readNativeWallets(payload);
      expect(state.apple.capabilityStatus).toBe('malformed');
      expect(state.google.capabilityStatus).toBe('malformed');
      expect(state.apple.available).toBe(false);
      expect(state.google.available).toBe(false);
    }
  });

  it('alias relacionado apaga Apple sin apagar Google', () => {
    const payload = config(true, true);
    Object.assign(payload.features, { apple_pay_enabled: true });
    const state = readNativeWallets(payload);
    expect(state.apple.capabilityStatus).toBe('malformed');
    expect(state.apple.offendingKeys).toEqual(['apple_pay_enabled']);
    expect(state.google.capabilityEnabled).toBe(true);
  });

  it.each(['ios_app', 'android_app', 'apple_sign_in', 'google_sign_in'])(
    'feature ajena legítima %s no apaga ninguna wallet',
    (key) => {
      const payload = config(true, true);
      Object.assign(payload.features, { [key]: { enabled: true } });
      const state = readNativeWallets(payload);
      expect(state.apple.capabilityStatus).toBe('authoritative');
      expect(state.google.capabilityStatus).toBe('authoritative');
      expect(state.apple.capabilityEnabled).toBe(true);
      expect(state.google.capabilityEnabled).toBe(true);
    },
  );

  it('alias por principal se denuncia y nunca habilita', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const payload = config(true, true);
    Object.assign(payload.features, { google_pay_for_restaurant: true });
    const state = applyNativeWalletsConfig(payload);
    expect(state.google.capabilityStatus).toBe('principal_scoped');
    expect(state.google.available).toBe(false);
    expect(state.apple.capabilityEnabled).toBe(true);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['apple-pay-enabled', 'malformed', 'apple'],
    ['applePayForUser', 'principal_scoped', 'apple'],
    ['google-pay-beta', 'malformed', 'google'],
    ['googlePayForRestaurant', 'principal_scoped', 'google'],
    ['gpay-for-merchant', 'principal_scoped', 'google'],
  ] as const)('normaliza alias %s y lo limita a %s', (key, status, provider) => {
    const payload = config(true, true);
    Object.assign(payload.features, { [key]: true });
    const state = readNativeWallets(payload);
    expect(state[provider].capabilityStatus).toBe(status);
    expect(state[provider].capabilityEnabled).toBe(false);
  });

  it.each([
    'user', 'account', 'role', 'restaurant', 'branch', 'sucursal',
    'principal', 'customer', 'merchant', 'tenant', 'per', 'for',
  ])('todos los tokens principal-scoped quedan fijados: %s', (principal) => {
    for (const [provider, alias] of [
      ['apple', `applepay_${principal}`],
      ['google', `googlepay_${principal}`],
      ['google', `gpay_${principal}`],
    ] as const) {
      const payload = config(true, true);
      Object.assign(payload.features, { [alias]: true });
      const state = readNativeWallets(payload);
      expect(state[provider].capabilityStatus).toBe('principal_scoped');
      expect(state[provider].capabilityEnabled).toBe(false);
      expect(state[provider === 'apple' ? 'google' : 'apple'].capabilityEnabled).toBe(true);
    }
  });
});

describe('composición capability AND discovery', () => {
  const supported: NativeWalletDiscovery = { status: 'authoritative', supported: true };
  const unsupported: NativeWalletDiscovery = { status: 'authoritative', supported: false };

  it('control positivo: true AND discovery soportada sí compone available', () => {
    expect(nativeWalletAvailable(true, supported)).toBe(true);
  });

  it.each([
    [false, supported],
    [true, unsupported],
    [true, { status: 'pending', supported: false }],
    [true, { status: 'absent', supported: false }],
    [true, { status: 'malformed', supported: false }],
    [true, { status: 'error', supported: false }],
  ] as const)('capability=%s discovery=%j queda dark', (capability, discovery) => {
    expect(nativeWalletAvailable(capability, discovery)).toBe(false);
  });

  it.each(['pending', 'absent', 'malformed', 'error'] as const)(
    'supported=true adversarial con status=%s nunca habilita',
    (status) => {
      const adversarial = { status, supported: true } as unknown as NativeWalletDiscovery;
      expect(nativeWalletAvailable(true, adversarial)).toBe(false);
    },
  );

  it('Dark A no traslada un OR Apple/Google: cada provider conserva su capability', () => {
    const state = readNativeWallets(config(true, false));
    expect(state.apple.capabilityEnabled).toBe(true);
    expect(state.google.capabilityEnabled).toBe(false);
    expect(state.apple.available).toBe(false);
    expect(state.google.available).toBe(false);
  });
});

describe('store y loader reintentable', () => {
  beforeEach(() => resetNativeWalletsForTests());
  afterEach(() => {
    resetNativeWalletsForTests();
    vi.restoreAllMocks();
  });

  it('arranca seguro y notifica una config', () => {
    const seen: string[] = [];
    const off = subscribeNativeWallets(() => seen.push(nativeWalletsSnapshot().apple.capabilityStatus));
    applyNativeWalletsConfig(config(true, true));
    off();
    expect(seen).toEqual(['authoritative']);
    expect(nativeWalletsSnapshot().apple.available).toBe(false);
  });

  it('dos loads concurrentes comparten request', async () => {
    let resolve!: (value: ReturnType<typeof config>) => void;
    const request = new Promise<ReturnType<typeof config>>((done) => { resolve = done; });
    const getConfig = vi.spyOn(api, 'getConfig').mockReturnValue(request);
    const first = ensureNativeWalletCapabilities();
    const second = ensureNativeWalletCapabilities();
    expect(first).toBe(second);
    expect(getConfig).toHaveBeenCalledTimes(1);
    resolve(config(true, true));
    await first;
    expect(nativeWalletsSnapshot().apple.available).toBe(false);
  });

  it('red fallida conserva pending seguro y permite retry', async () => {
    const getConfig = vi.spyOn(api, 'getConfig')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(config(true, true));
    await ensureNativeWalletCapabilities();
    expect(nativeWalletsSnapshot().apple.capabilityStatus).toBe('pending');
    expect(nativeWalletsSnapshot().apple.available).toBe(false);
    await ensureNativeWalletCapabilities();
    expect(getConfig).toHaveBeenCalledTimes(2);
    expect(nativeWalletsSnapshot().apple.capabilityStatus).toBe('authoritative');
    expect(nativeWalletsSnapshot().apple.available).toBe(false);
  });
});

describe('censo de fuente · no hay bypass de Dark A', () => {
  const mesa = readFileSync(new URL('../screens/MesaScreen.tsx', import.meta.url), 'utf8');
  const native = readFileSync(new URL('./nativeWallets.ts', import.meta.url), 'utf8');
  const mesaAst = ts.createSourceFile('MesaScreen.tsx', mesa, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  function descendants(root: ts.Node): ts.Node[] {
    const nodes: ts.Node[] = [];
    const visit = (node: ts.Node) => { nodes.push(node); ts.forEachChild(node, visit); };
    visit(root);
    return nodes;
  }

  function isSetter(node: ts.Node, value: string): node is ts.CallExpression {
    return ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'setPayType'
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])
      && node.arguments[0].text === value;
  }

  function contains(root: ts.Node, predicate: (node: ts.Node) => boolean): boolean {
    return descendants(root).some(predicate);
  }

  function ancestors(node: ts.Node, stop?: ts.Node): ts.Node[] {
    const found: ts.Node[] = [];
    for (let current = node.parent; current && current !== stop; current = current.parent) {
      found.push(current);
    }
    return found;
  }

  function unwrap(node: ts.Expression): ts.Expression {
    let current = node;
    while (ts.isParenthesizedExpression(current)
      || ts.isAsExpression(current)
      || ts.isTypeAssertionExpression(current)
      || ts.isNonNullExpression(current)) current = current.expression;
    return current;
  }

  function memberName(node: ts.Expression): string | null {
    const current = unwrap(node);
    if (ts.isPropertyAccessExpression(current)) return current.name.text;
    if (ts.isElementAccessExpression(current)
      && current.argumentExpression
      && (ts.isStringLiteral(current.argumentExpression)
        || ts.isNoSubstitutionTemplateLiteral(current.argumentExpression))) {
      return current.argumentExpression.text;
    }
    return null;
  }

  function bindingMemberName(element: ts.BindingElement): string | null {
    if (!element.propertyName) return ts.isIdentifier(element.name) ? element.name.text : null;
    if (ts.isComputedPropertyName(element.propertyName)) {
      const expression = unwrap(element.propertyName.expression);
      return ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)
        ? expression.text
        : null;
    }
    return ts.isIdentifier(element.propertyName) || ts.isStringLiteral(element.propertyName)
      ? element.propertyName.text
      : null;
  }

  function rawWalletReads(source: string, path = 'synthetic.ts'): ts.Node[] {
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true,
      path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    return descendants(ast).filter((node) => {
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const name = memberName(node);
        return name === 'apple_pay' || name === 'google_pay';
      }
      if (!ts.isBindingElement(node)) return false;
      const name = bindingMemberName(node);
      return name === 'apple_pay' || name === 'google_pay';
    });
  }

  function productionSources(): Array<{ path: string; source: string }> {
    const apiDir = dirname(fileURLToPath(import.meta.url));
    const srcDir = join(apiDir, '..');
    const found: Array<{ path: string; source: string }> = [];
    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const absolute = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (absolute === join(srcDir, 'api', 'mock')) continue;
          walk(absolute);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
        const path = relative(srcDir, absolute).replaceAll('\\', '/');
        if (path === 'api/types.ts' || path === 'api/nativeWallets.ts') continue;
        found.push({ path, source: readFileSync(absolute, 'utf8') });
      }
    }
    walk(srcDir);
    return found;
  }

  it('la constante vieja desapareció, no fue renombrada', () => {
    const offenders = productionSources()
      .filter((file) => file.source.includes('WALLET_PAY_ENABLED'))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
    expect(native).not.toContain('WALLET_PAY_ENABLED');
  });

  it('payType nace y resetea a card', () => {
    const declarations = descendants(mesaAst).filter(ts.isVariableDeclaration);
    const initializer = declarations.filter((declaration) =>
      declaration.name.getText(mesaAst) === '[payType, setPayType]'
      && declaration.initializer
      && ts.isCallExpression(declaration.initializer)
      && declaration.initializer.expression.getText(mesaAst) === 'useState'
      && declaration.initializer.typeArguments?.[0]?.getText(mesaAst) === 'PaymentType'
      && declaration.initializer.arguments.length === 1
      && ts.isStringLiteral(declaration.initializer.arguments[0])
      && declaration.initializer.arguments[0].text === 'card');
    expect(initializer).toHaveLength(1);

    const identityEffects = descendants(mesaAst)
      .filter(ts.isCallExpression)
      .filter((call) => call.expression.getText(mesaAst) === 'useEffect')
      .filter((call) => call.arguments[1] && ts.isArrayLiteralExpression(call.arguments[1]))
      .filter((call) => call.arguments[1].getText(mesaAst) === '[guestToken, code]')
      .filter((call) => call.arguments[0].getText(mesaAst).includes('identityEpochRef.current.next()'));
    expect(identityEffects).toHaveLength(1);
    const resetSetters = descendants(identityEffects[0].arguments[0])
      .filter((node): node is ts.CallExpression => ts.isCallExpression(node)
        && ts.isIdentifier(node.expression)
        && node.expression.text === 'setPayType');
    expect(resetSetters).toHaveLength(1);
    expect(isSetter(resetSetters[0], 'card')).toBe(true);
  });

  it.each([
    ['apple', "setPayType('apple_pay')"],
    ['google', "setPayType('google_pay')"],
  ] as const)('el único setter %s vive bajo su available', (provider, setter) => {
    expect(mesa.split(setter)).toHaveLength(2);
    const value = `${provider}_pay`;
    const allSetters = descendants(mesaAst).filter((node) => isSetter(node, value));
    expect(allSetters).toHaveLength(1);
    const button = ancestors(allSetters[0]).find(ts.isJsxElement);
    expect(button?.openingElement.tagName.getText(mesaAst)).toBe('button');
    const externalGates = ancestors(button as ts.JsxElement)
      .filter(ts.isBinaryExpression)
      .filter((node) => node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)
      .filter((node) => node.left.getText(mesaAst) === `nativeWallets.${provider}.available`)
      .filter((node) => contains(node.right, (child) => child === button));
    expect(externalGates).toHaveLength(1);
  });

  it.each([
    ['apple', 'Apple Pay'],
    ['google', 'Google Pay'],
  ] as const)('el copy guest de %s depende sólo de available', (provider, label) => {
    const guestNotes = descendants(mesaAst)
      .filter(ts.isJsxElement)
      .filter((node) => node.openingElement.attributes.getText(mesaAst).includes('note note-orange'))
      .filter((node) => node.getText(mesaAst).includes('Sin iniciar sesión pagas con tarjeta'));
    expect(guestNotes).toHaveLength(1);
    const occurrences = descendants(guestNotes[0]).filter((node) =>
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node))
      && node.text.includes(label));
    expect(occurrences).toHaveLength(1);
    for (const occurrence of occurrences) {
      const governingConditionals = ancestors(occurrence, guestNotes[0])
        .filter(ts.isConditionalExpression)
        .filter((node) => node.condition.getText(mesaAst) === `nativeWallets.${provider}.available`)
        .filter((node) => contains(node.whenTrue, (child) => child === occurrence));
      expect(governingConditionals).toHaveLength(1);
    }
  });

  it.each([
    "config.features.apple_pay",
    "config['features']['apple_pay']",
    "(config.features)['google_pay']",
    "const { apple_pay } = config.features",
    "const { google_pay: wallet } = config['features']",
    "const { features: { apple_pay: wallet } } = config",
    "const { ['apple_pay']: raw } = config.features",
    'const features = config.features; const raw = features.apple_pay',
    'const { features } = config; const { google_pay } = features',
  ])('el detector propio reconoce lectura raw: %s', (source) => {
    expect(rawWalletReads(source)).not.toHaveLength(0);
  });

  it('el detector conserva lecturas posteriores a JSX en TSX', () => {
    const source = "const view = <div />; const raw = config['features']['google_pay'];";
    expect(rawWalletReads(source, 'synthetic.tsx')).not.toHaveLength(0);
  });

  it.each([
    'config.features.apple_sign_in',
    "config['features']['ios_app']",
    'const { google_sign_in } = config.features',
    'source.payment_type',
    "source['payment_type']",
  ])('el detector propio no acusa feature ajena: %s', (source) => {
    expect(rawWalletReads(source)).toHaveLength(0);
  });

  it('ningún consumidor productivo lee flags crudos fuera del decoder', () => {
    const offenders = productionSources()
      .filter((file) => {
        return rawWalletReads(file.source, file.path).length > 0;
      })
      .map((file) => file.path);
    expect(offenders).toEqual([]);
    expect(native).toContain("apple: 'apple_pay'");
    expect(native).toContain("google: 'google_pay'");
  });
});
