import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EN_VIAJES_AVISOS } from './avisos';
import { EN_VIAJES_CERRADO } from './cerrado';
import { EN_VIAJES_COMUN } from './comun';
import { EN_VIAJES_CREAR } from './crear';
import { EN_VIAJES_LISTAS } from './listas';
import { EN_VIAJES_TICKET } from './ticket';
import { EN_VIAJES_VIAJE } from './viaje';

/**
 * AF-VIAJES · el EN de Viajes vive en archivos por pantalla y se esparce al
 * final de `EN`. Un spread no avisa si pisa: esto sí. Ninguna clave de Viajes
 * puede estar ya en `en.ts` (la de Viajes ganaría en silencio y cambiaría otra
 * pantalla) ni repetirse entre archivos. Y nunca «saldo» (D242, el contrato).
 */
const PARTES = {
  comun: EN_VIAJES_COMUN, listas: EN_VIAJES_LISTAS, crear: EN_VIAJES_CREAR, viaje: EN_VIAJES_VIAJE,
  ticket: EN_VIAJES_TICKET, avisos: EN_VIAJES_AVISOS, cerrado: EN_VIAJES_CERRADO,
};
const BASE = readFileSync(new URL('../en.ts', import.meta.url), 'utf8');
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('AF-VIAJES · el EN de Viajes', () => {
  it('🔴 ninguna clave de Viajes ya estaba en en.ts', () => {
    const pisadas = Object.values(PARTES).flatMap((p) => Object.keys(p))
      .filter((k) => new RegExp(`["']${esc(k)}["']\\s*:`).test(BASE));
    expect(pisadas).toEqual([]);
  });

  it('🔴 ninguna clave se repite entre archivos', () => {
    const vistas = new Map<string, string>();
    const repetidas: string[] = [];
    for (const [parte, dic] of Object.entries(PARTES)) {
      for (const k of Object.keys(dic)) {
        if (vistas.has(k)) repetidas.push(`${k} (${vistas.get(k)} y ${parte})`);
        vistas.set(k, parte);
      }
    }
    expect(repetidas).toEqual([]);
  });

  it('nunca «saldo», ni en español ni en la traducción', () => {
    const todo = Object.values(PARTES).flatMap((p) => Object.entries(p).flat()).join('\n');
    expect(todo).not.toMatch(/saldo/i);
  });
});
