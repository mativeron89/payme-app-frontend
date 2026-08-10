import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * ⭐ LA COMPUERTA DE PUBLICACIÓN · que corte de verdad, no que lo diga.
 *
 * ## El defecto que la motivó, medido en `a79c6a3` (2026-08-10)
 *
 *     push                     06:01:05Z
 *     ÁPICE PUBLICADO (Vercel) 06:03:01Z   ← producción viva
 *     CI termina               06:05:56Z   ← 2 m 55 s DESPUÉS
 *
 * Producción salía antes de que terminara la verificación, y el único gate que
 * existía —el de Pages— **protegía la copia que nadie visita**.
 *
 * ## 🔴 Qué se acredita EJECUTANDO y qué sólo por LECTURA
 *
 * No las mezclo, porque valen distinto:
 *
 *   EJECUTANDO   el comportamiento de `publicar-vercel.sh` contra un servidor
 *                real que contesta 200, 500 y que se cae. Es la condición 3 de
 *                la orden —«si el curl falla, el job falla»— y es la que más
 *                importa, porque un curl que informa y no corta deja creyendo
 *                que se publicó.
 *
 *   POR LECTURA  el condicional del YAML (`success()`, `push`, `main`). Correr
 *                el workflow de verdad es una acción externa y además exigiría
 *                romper producción a propósito para ver el rojo. **Queda
 *                declarado como no ejecutado**, no disfrazado de verificación.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');
const SCRIPT = join(AQUI, 'publicar-vercel.sh');

/**
 * Corre el script como lo corre el CI y devuelve su veredicto crudo.
 *
 * 🔴 ASÍNCRONO, Y NO ES UN DETALLE. La primera versión usaba `spawnSync`, que
 * **bloquea el event loop de Node** — el mismo loop donde vive el servidor de
 * prueba de más abajo. Resultado: `curl` esperaba una respuesta que el servidor
 * no podía dar porque el loop estaba tomado, hasta agotar `--max-time` en cada
 * reintento. **La suite colgó más de 120 s; el script solo tarda 4.**
 *
 * Se deadlockeó mi propia sonda. Vale anotarlo porque el síntoma —«el gate es
 * lentísimo»— invita a subir el timeout, y el timeout no tenía nada que ver.
 */
function publicar(url: string): Promise<{ code: number; out: string }> {
  return new Promise((resolver) => {
    execFile('bash', [SCRIPT, 'app-de-prueba', url], { encoding: 'utf8' }, (err, out, errOut) => {
      const code = err && typeof err.code === 'number' ? err.code : err ? -1 : 0;
      resolver({ code, out: `${out}${errOut}` });
    });
  });
}

describe('EJECUTANDO · el disparo corta cuando el hook no acepta', () => {
  let servidor: Server;
  let puerto = 0;
  /** Lo decide cada test antes de disparar. */
  let responder: 200 | 500 | 429 = 200;
  let recibidos = 0;

  beforeAll(async () => {
    servidor = createServer((_req, res) => {
      recibidos += 1;
      res.writeHead(responder).end();
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    const dir = servidor.address();
    puerto = typeof dir === 'object' && dir ? dir.port : 0;
    expect(puerto, 'el servidor de prueba no levantó: los tests medirían en vacío')
      .toBeGreaterThan(0);
  });

  afterAll(async () => {
    await new Promise<void>((ok) => servidor.close(() => ok()));
  });

  it('✅ CASO LEGÍTIMO · con 200 el script sale 0 y el CI sigue', async () => {
    responder = 200;
    const antes = recibidos;
    const r = await publicar(`http://127.0.0.1:${puerto}/hook`);
    expect(recibidos, 'el script no llegó a disparar nada').toBe(antes + 1);
    expect(r.code, `salió ≠0 con un hook sano:\n${r.out}`).toBe(0);
    expect(r.out).toContain('✅');
  });

  it('🔴 MUTANTE · con 500 el script SALE ≠0 · el job tiene que caer', async () => {
    responder = 500;
    const r = await publicar(`http://127.0.0.1:${puerto}/hook`);
    expect(r.code, `aprobó un hook que contestó 500:\n${r.out}`).not.toBe(0);
    expect(r.out).toContain('500');
    expect(r.out).toContain('NO se publicó');
  });

  it('🔴 MUTANTE · con 429 tampoco pasa: sólo 2xx publica', async () => {
    responder = 429;
    const r = await publicar(`http://127.0.0.1:${puerto}/hook`);
    expect(r.code, 'un 429 no es una publicación').not.toBe(0);
  });

  it('🔴 MUTANTE · si no hay nadie escuchando, el script SALE ≠0', async () => {
    // Puerto 1: privilegiado y sin servicio. `--retry-connrefused` reintenta y
    // después se rinde, que es justo lo que tiene que pasar.
    const r = await publicar('http://127.0.0.1:1/hook');
    expect(r.code, `un hook inalcanzable no puede dar por publicado:\n${r.out}`).not.toBe(0);
  });

  it('🔴 FAIL-CLOSED · con el secreto vacío no dispara y avisa', async () => {
    const antes = recibidos;
    const r = await publicar('');
    expect(r.code, 'un secreto ausente no puede pasar en silencio').not.toBe(0);
    expect(recibidos, 'disparó algo con la URL vacía').toBe(antes);
    expect(r.out).toContain('Deploy Hook');
  });

  it('🔴 el script NO imprime la URL del hook · es el secreto', async () => {
    responder = 200;
    const url = `http://127.0.0.1:${puerto}/hook-con-token-secretisimo`;
    const r = await publicar(url);
    expect(r.out, 'la URL del hook salió al log').not.toContain('hook-con-token-secretisimo');
    expect(r.out, 'tampoco el host').not.toContain(String(puerto));
  });
});

/**
 * 🔴 POR LECTURA, y lo digo: esto NO se ejecutó. Correr el workflow es acción
 * externa y ver su rojo exigiría romper producción a propósito. Lo que sigue
 * afirma sobre el TEXTO del YAML — vale para que nadie afloje el condicional
 * sin querer, no como prueba de que Actions se comporta así.
 */
describe('POR LECTURA · el condicional del workflow (no ejecutado)', () => {
  const ci = readFileSync(join(RAIZ, '.github', 'workflows', 'ci.yml'), 'utf8');

  it('🔴 el paso de publicar existe y es el ÚLTIMO', () => {
    // Por POSICIÓN, no por conteo desde un `indexOf`: la primera versión
    // cortaba con `slice(indexOf('- name: …'))`, que empieza DESPUÉS de la
    // sangría, así que el ancla `^ {6}` ya no matcheaba el propio paso y el
    // test se caía solo. El instrumento fallaba, no el workflow.
    const pasos = [...ci.matchAll(/^ {6}- (?:name|run|uses):.*$/gm)];
    expect(pasos.length, 'no se parsearon pasos: el barrido mide en vacío').toBeGreaterThan(5);

    const publicar = pasos.filter((p) => p[0].includes('Publicar en Vercel'));
    expect(publicar.length, 'no está el paso de publicación, o está dos veces').toBe(1);

    // Nada ejecutable después. Si alguien agrega un paso abajo, esto cae y hay
    // que decidir a conciencia si va antes o después de publicar — porque
    // después de publicar ya no protege nada.
    expect(
      pasos[pasos.length - 1]![0],
      'quedó un paso DESPUÉS de publicar: ya no lo gatea nada',
    ).toContain('Publicar en Vercel');
  });

  it('🔴 las tres condiciones están en el `if`', () => {
    const linea = ci.split('\n').find((l) => l.trim().startsWith('if:') && l.includes('success()'));
    expect(linea, 'el paso de publicar no condiciona por success()').toBeDefined();
    expect(linea).toContain("github.event_name == 'push'");
    expect(linea).toContain("github.ref == 'refs/heads/main'");
  });

  it('🔴 los hooks viajan por `secrets`, nunca escritos en el YAML', () => {
    expect(ci).toContain('${{ secrets.VERCEL_HOOK_APP }}');
    expect(ci).toContain('${{ secrets.VERCEL_HOOK_LANDING }}');
    expect(ci, 'hay una URL de hook escrita a mano').not.toMatch(/api\/deploy\/prj_/);
    expect(ci, 'hay un hook de vercel hardcodeado').not.toMatch(/vercel\.com\/v1\/integrations/);
  });
});

describe('vercel.json · el despliegue automático sigue apagado', () => {
  it('🔴 `main` NO despliega solo · si alguien lo enciende, esto cae', () => {
    const v = JSON.parse(readFileSync(join(RAIZ, 'vercel.json'), 'utf8')) as {
      git?: { deploymentEnabled?: Record<string, boolean> };
    };
    expect(
      v.git?.deploymentEnabled?.main,
      'volvió el despliegue automático: producción publicaría antes que el CI',
    ).toBe(false);
  });

  /**
   * `vercel.json` no puede llevar el motivo adentro —es JSON estricto y una
   * clave desconocida puede invalidar la configuración de despliegue entera—,
   * así que el motivo vive en un documento. **Esto exige que ese documento
   * exista y siga explicando lo que hay que saber**: sin él, el `false` de
   * arriba es un número sin historia que alguien flipea en seis meses.
   */
  it('🔴 y el porqué está escrito donde alguien lo va a buscar', () => {
    const doc = readFileSync(join(RAIZ, 'docs', 'DESPLIEGUE_GATEADO.md'), 'utf8');
    expect(doc).toContain('deploymentEnabled');
    expect(doc, 'el doc no trae la medición que motivó el gate').toContain('06:03:01');
    expect(doc, 'no advierte sobre los dos proyectos').toContain('Root Directory');
    expect(doc, 'no declara qué queda sin gatear').toContain('deploy-demo.yml');
  });
});
