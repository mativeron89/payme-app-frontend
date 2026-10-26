#!/usr/bin/env node
/**
 * D493 · ¿este push a main trae un árbol que YA pasó la CI completa en su PR?
 *
 * Lo corre el job `decidir` de `ci.yml` y escribe `probado=true|false` en
 * `$GITHUB_OUTPUT`. Con `true`, `checks` y `playwright` se saltean y `build`
 * sólo construye y publica; con `false`, corre la suite completa, como siempre.
 *
 * Responde `true` SÓLO si se cumplen todas:
 *   ① el evento es un push a `refs/heads/main`;
 *   ② hay una corrida de `pull_request` del MISMO workflow, con `head_sha`
 *      igual al SHA pusheado, terminada en `success`;
 *   ③ esa corrida dejó la marca `ci-probado-arbol-<árbol>-base-<base>` (la sube
 *      el job `build` del PR después de verificar todo en verde, ver
 *      `ci-marcar-probado.mjs`), sin vencer;
 *   ④ el árbol de la marca es el árbol del SHA pusheado, y la base de la marca
 *      es ancestro del SHA. El merge ref probado tiene entonces el mismo árbol
 *      que lo que se publica.
 *
 * 🔴 FALLA CERRADO: cualquier respuesta no 2xx, red caída, JSON raro, falta de
 * token, un `git` que falla o una duda cualquiera dan `false` (suite completa),
 * nunca `true`. Sale 0 en esos casos a propósito: la consulta que se cae no
 * debe frenar la CI, debe hacerla correr entera.
 *
 * Por qué la marca y no `pull_requests[].base.sha` de la corrida: medido el
 * 2026-10-26 sobre la corrida 40364386953 (PR #97), ese arreglo vuelve VACÍO
 * cuando el PR ya entró a main, que es justo el momento de este push.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const HEX40 = /^[0-9a-f]{40}$/;
const MARCA = /^ci-probado-arbol-([0-9a-f]{40})-base-([0-9a-f]{40})$/;

function responder(probado, motivo) {
  console.log(`probado=${probado} · ${motivo}`);
  const salida = process.env.GITHUB_OUTPUT;
  if (!salida) throw new Error('no hay GITHUB_OUTPUT donde escribir la respuesta');
  appendFileSync(salida, `probado=${probado}\n`);
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function esAncestro(base, sha) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', base, sha], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function decidir() {
  const env = process.env;
  if (env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF !== 'refs/heads/main') {
    return [false, `evento ${env.GITHUB_EVENT_NAME ?? '—'} en ${env.GITHUB_REF ?? '—'}: no es un push a main`];
  }
  const sha = env.GITHUB_SHA ?? '';
  const repo = env.GITHUB_REPOSITORY ?? '';
  const runId = env.GITHUB_RUN_ID ?? '';
  const api = env.GITHUB_API_URL ?? '';
  const token = env.GH_TOKEN ?? '';
  if (!HEX40.test(sha)) return [false, 'GITHUB_SHA no es un SHA'];
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return [false, 'GITHUB_REPOSITORY inválido'];
  if (!/^[0-9]+$/.test(runId)) return [false, 'GITHUB_RUN_ID inválido'];
  if (!/^https?:\/\//.test(api)) return [false, 'GITHUB_API_URL inválida'];
  if (!token) return [false, 'sin token para consultar'];

  const pedir = async (ruta) => {
    const r = await fetch(`${api}${ruta}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} en ${ruta}`);
    return r.json();
  };

  const actual = await pedir(`/repos/${repo}/actions/runs/${runId}`);
  const workflowId = actual?.workflow_id;
  if (!Number.isSafeInteger(workflowId)) return [false, 'la corrida actual no trae workflow_id'];

  const arbol = git(['rev-parse', `${sha}^{tree}`]);
  if (!HEX40.test(arbol)) return [false, 'no se pudo leer el árbol del SHA'];

  const lista = await pedir(
    `/repos/${repo}/actions/workflows/${workflowId}/runs?event=pull_request&status=success&head_sha=${sha}&per_page=100`,
  );
  if (!Array.isArray(lista?.workflow_runs)) return [false, 'la lista de corridas no es una lista'];
  const corridas = lista.workflow_runs.filter((r) =>
    r?.head_sha === sha && r?.event === 'pull_request' && r?.status === 'completed' &&
    r?.conclusion === 'success' && r?.workflow_id === workflowId && Number.isSafeInteger(r?.id),
  );
  if (corridas.length === 0) return [false, `ninguna CI de pull_request exitosa con head_sha ${sha}`];

  for (const corrida of corridas) {
    const marcas = await pedir(`/repos/${repo}/actions/runs/${corrida.id}/artifacts?per_page=100`);
    if (!Array.isArray(marcas?.artifacts)) continue;
    for (const a of marcas.artifacts) {
      if (a?.expired !== false || typeof a?.name !== 'string') continue;
      const m = MARCA.exec(a.name);
      if (!m) continue;
      const [, arbolProbado, base] = m;
      if (arbolProbado !== arbol) continue;
      if (!esAncestro(base, sha)) continue;
      return [true, `la corrida ${corrida.id} probó el árbol ${arbol} sobre la base ${base}, ancestro de ${sha}`];
    }
  }
  return [false, 'ninguna corrida de PR dejó la marca de este árbol con una base ancestro'];
}

let respuesta;
try {
  respuesta = await decidir();
} catch (e) {
  respuesta = [false, `consulta caída: ${e instanceof Error ? e.message : String(e)}`];
}
responder(...respuesta);
