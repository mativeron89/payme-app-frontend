import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * D341-M2 · condición 2 de la enmienda: el aviso a la guía va DESPUÉS del guardado exitoso, en su propio
 * try/catch, sin red ni persistencia, y sólo con ids. Un e2e con el mock (que siempre guarda bien) no vería un
 * aviso movido antes del `await` o copiado al `catch`: esta guarda lo mira en el código.
 */
const FUENTES = import.meta.glob('../screens/**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const CAMPOS_PERMITIDOS = new Set(['tipo', 'mesa', 'viaje', 'cerrada']);

interface Sitio { ruta: string; linea: number; problemas: string[]; campos: string[] }

function sitios(): Sitio[] {
  const out: Sitio[] = [];
  for (const [ruta, src] of Object.entries(FUENTES)) {
    if (/\.test\.tsx$/.test(ruta) || !src.includes('avisarALaGuia(')) continue;
    const sf = ts.createSourceFile(ruta, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visitar = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'avisarALaGuia') {
        const problemas: string[] = [];
        // Su propio try/catch: la llamada es la única sentencia de un `try` con `catch`.
        const sentencia = n.parent;
        const propio = sentencia?.parent && ts.isBlock(sentencia.parent) && sentencia.parent.statements.length === 1
          && ts.isTryStatement(sentencia.parent.parent) ? sentencia.parent.parent : null;
        if (!ts.isExpressionStatement(sentencia) || !propio || !propio.catchClause) problemas.push('sin try/catch propio');
        // El try del guardado: el que contiene al try propio, con un `await api.*` ANTES en el mismo bloque.
        let q: ts.Node | undefined = propio?.parent;
        let guardado: ts.TryStatement | null = null;
        for (; q; q = q.parent) {
          if (ts.isCatchClause(q)) { problemas.push('dentro de un catch'); break; }
          if (ts.isTryStatement(q)) { guardado = q; break; }
        }
        if (!guardado) problemas.push('fuera del try del guardado');
        else {
          const awaits: number[] = [];
          const buscarAwait = (m: ts.Node) => {
            if (ts.isAwaitExpression(m) && ts.isCallExpression(m.expression)
              && ts.isPropertyAccessExpression(m.expression.expression)
              && ts.isIdentifier(m.expression.expression.expression) && m.expression.expression.expression.text === 'api') awaits.push(m.getStart(sf));
            ts.forEachChild(m, buscarAwait);
          };
          buscarAwait(guardado.tryBlock);
          if (!awaits.some((pos) => pos < n.getStart(sf))) problemas.push('antes del guardado');
        }
        const arg = n.arguments[0];
        const campos = arg && ts.isObjectLiteralExpression(arg)
          ? arg.properties.map((p) => (p.name && ts.isIdentifier(p.name) ? p.name.text : '?'))
          : ['?'];
        out.push({ ruta, linea: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, problemas, campos });
      }
      ts.forEachChild(n, visitar);
    };
    visitar(sf);
  }
  return out;
}

describe('D341-M2 · los avisos de guardado a la guía', () => {
  const todos = sitios();

  it('están exactamente en las cuatro pantallas de la enmienda (MesaScreen dos veces: lock y PUT de iguales)', () => {
    const porArchivo = todos.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.ruta.split('/').pop()!]: (acc[s.ruta.split('/').pop()!] ?? 0) + 1 }), {});
    expect(porArchivo).toEqual({ 'MesaScreen.tsx': 2, 'TicketNuevoScreen.tsx': 1, 'TicketScreen.tsx': 1, 'CargaManualScreen.tsx': 1 });
  });

  it('cada uno va después del `await api.*` exitoso, dentro de su try (nunca en el catch) y con su propio try/catch', () => {
    expect(todos.filter((s) => s.problemas.length).map((s) => `${s.ruta}:${s.linea} ${s.problemas.join(', ')}`)).toEqual([]);
  });

  it('llevan sólo ids y el tipo: nunca importes ni datos de personas', () => {
    expect(todos.filter((s) => s.campos.some((c) => !CAMPOS_PERMITIDOS.has(c))).map((s) => `${s.ruta}:${s.linea} ${s.campos.join(',')}`)).toEqual([]);
  });

  it('🔴 SONDA · la guarda distingue un aviso bien puesto de uno en el catch o antes del guardado', () => {
    const revisar = (codigo: string) => {
      const viejo = { ...FUENTES };
      for (const k of Object.keys(FUENTES)) delete FUENTES[k];
      FUENTES['./Sonda.tsx'] = codigo;
      try { return sitios()[0]?.problemas ?? ['no encontrado']; } finally {
        delete FUENTES['./Sonda.tsx'];
        Object.assign(FUENTES, viejo);
      }
    };
    const bien = `async function f() { try { await api.guardar(); try { avisarALaGuia({ tipo: 'viaje-guardado', viaje: id }); } catch { } } catch (e) { } }`;
    const enCatch = `async function f() { try { await api.guardar(); } catch (e) { try { avisarALaGuia({ tipo: 'viaje-guardado', viaje: id }); } catch { } } }`;
    const antes = `async function f() { try { try { avisarALaGuia({ tipo: 'viaje-guardado', viaje: id }); } catch { } await api.guardar(); } catch (e) { } }`;
    const suelto = `async function f() { try { await api.guardar(); avisarALaGuia({ tipo: 'viaje-guardado', viaje: id }); } catch (e) { } }`;
    expect(revisar(bien)).toEqual([]);
    expect(revisar(enCatch)).toContain('dentro de un catch');
    expect(revisar(antes)).toContain('antes del guardado');
    expect(revisar(suelto)).toContain('sin try/catch propio');
  });
});
