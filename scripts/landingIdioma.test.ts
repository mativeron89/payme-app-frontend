import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

it('D785: ES → EN → ES conserva los otros perks y no sirve la promesa retirada', () => {
  const html = readFileSync(new URL('../landing/index.html', import.meta.url), 'utf8');
  expect(html).not.toMatch(/comensal\.perk5|Nadie en la mesa ve qué pediste|sees what you ordered/i);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  expect(script).toBeDefined();
  const nodes = [...html.matchAll(/<p data-i18n="(comensal\.perk\d+)">([^<]*)<\/p>/g)].map((match) => ({
    key: match[1]!, textContent: match[2]!, getAttribute: () => match[1]!,
  }));
  expect(nodes.map((node) => node.key)).toEqual([1, 2, 3, 4, 6].map((n) => `comensal.perk${n}`));
  const attributes = new Map<string, string>();
  const callbacks = new Map<string, () => void>();
  const toggle = { textContent: '', setAttribute() {}, addEventListener: (event: string, fn: () => void) => callbacks.set(event, fn) };
  const inert = { classList: { toggle() {}, remove() {} }, style: {}, setAttribute() {}, addEventListener() {} };
  const document = {
    querySelectorAll: () => nodes,
    getElementById: (id: string) => id === 'lang-toggle' ? toggle : inert,
    documentElement: { scrollTop: 0, scrollHeight: 844, setAttribute: (k: string, v: string) => attributes.set(k, v), getAttribute: (k: string) => attributes.get(k) },
    addEventListener() {},
  };
  runInNewContext(script!, { document, window: { scrollY: 0, innerHeight: 844, addEventListener() {} }, localStorage: { getItem: () => null, setItem() {} } });
  const es = nodes.map((node) => node.textContent);
  expect(attributes.get('lang')).toBe('es');
  callbacks.get('click')!();
  expect(attributes.get('lang')).toBe('en');
  expect(nodes.map((node) => node.textContent)).toEqual([
    'You only take your own dishes off the bill', 'You choose how much tip to leave',
    'Pay with your card, right from your phone', "You can pay more than one share, if it's on you",
    "You keep a history of what you've paid",
  ]);
  callbacks.get('click')!();
  expect(attributes.get('lang')).toBe('es');
  expect(nodes.map((node) => node.textContent)).toEqual(es);
});
