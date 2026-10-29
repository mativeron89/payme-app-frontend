import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EN_AGENTE } from './agente';

/**
 * D554 · el EN del agente vive aparte y se esparce al final de `EN`, como el de Viajes. Un spread no avisa si pisa:
 * esto sí. Ninguna clave del agente puede estar ya en `en.ts` (ganaría en silencio y cambiaría otra pantalla) ni en
 * los archivos de Viajes. Y el texto del usuario es español de México, sin voseo (`registroMexicano.test.ts`).
 */
const BASE = readFileSync(new URL('./en.ts', import.meta.url), 'utf8');
const VIAJES = ['avisos', 'cerrado', 'comun', 'crear', 'listas', 'notas', 'ticket', 'viaje']
  .map((f) => readFileSync(new URL(`./viajes/${f}.ts`, import.meta.url), 'utf8')).join('\n');
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('D554 · el EN del agente', () => {
  it('🔴 ninguna clave del agente ya estaba en en.ts ni en Viajes', () => {
    const pisadas = Object.keys(EN_AGENTE).filter((k) => new RegExp(`["']${esc(k)}["']\\s*:`).test(`${BASE}\n${VIAJES}`));
    expect(pisadas).toEqual([]);
  });

  it('cada clave tiene una traducción que no es el español', () => {
    for (const [es, en] of Object.entries(EN_AGENTE)) {
      expect(en.trim(), es).not.toBe('');
      expect(en, es).not.toBe(es);
    }
  });

  it('las plantillas conservan sus marcadores', () => {
    for (const [es, en] of Object.entries(EN_AGENTE)) {
      const marcas = (s: string) => (s.match(/\{\d\}/g) ?? []).sort().join();
      expect(marcas(en), es).toBe(marcas(es));
    }
  });
});
