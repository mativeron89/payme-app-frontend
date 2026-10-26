#!/usr/bin/env node
/**
 * D493 · el primer paso del job `build`, que corre con `if: always()`.
 *
 * `build` es el check obligatorio de main. Corre siempre para que un shard rojo
 * no lo deje «skipped» (GitHub cuenta un check requerido salteado como
 * aprobado), y por eso ESTE paso tiene que fallar cuando algo no está en verde.
 * Lee `NEEDS` (el `toJSON(needs)` del job) y sale ≠0 salvo que:
 *
 *   · `decidir` terminó en success, y
 *   · con `probado=false`: `checks` y `playwright` terminaron en success
 *     (con la matriz, `playwright` es success sólo si los 4 shards lo son);
 *   · con `probado=true`: es un push a main y `checks`/`playwright` no fallaron
 *     (salteados, o success si corrieron igual).
 *
 * Cualquier otra cosa —un job de más o de menos, un valor de `probado` raro,
 * `cancelled`, `failure`— es rojo. Los pasos que siguen en `build`, incluido el
 * publicador, sólo corren si éste sale 0.
 */
const ESPERADOS = ['checks', 'decidir', 'playwright'];

function verificar(env) {
  let needs;
  try {
    needs = JSON.parse(env.NEEDS ?? '');
  } catch {
    return 'NEEDS no es JSON';
  }
  if (typeof needs !== 'object' || needs === null || Array.isArray(needs)) return 'NEEDS no es un objeto';
  const claves = Object.keys(needs).sort();
  if (claves.join(',') !== ESPERADOS.join(',')) return `los needs no son exactamente ${ESPERADOS.join(', ')}: ${claves.join(', ')}`;
  const resultado = (j) => needs[j]?.result;

  if (resultado('decidir') !== 'success') return `decidir terminó en ${resultado('decidir')}`;
  const probado = needs.decidir?.outputs?.probado;

  if (probado === 'false') {
    for (const j of ['checks', 'playwright']) {
      if (resultado(j) !== 'success') return `${j} terminó en ${resultado(j)}`;
    }
    return null;
  }
  if (probado === 'true') {
    if (env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF !== 'refs/heads/main') {
      return 'probado=true fuera de un push a main';
    }
    for (const j of ['checks', 'playwright']) {
      if (resultado(j) !== 'skipped' && resultado(j) !== 'success') return `${j} terminó en ${resultado(j)}`;
    }
    return null;
  }
  return `decidir devolvió probado=${JSON.stringify(probado)}`;
}

const falla = verificar(process.env);
if (falla !== null) {
  console.error(`🔴 no está todo en verde: ${falla}`);
  process.exit(1);
}
console.log('✅ todo en verde para seguir');
