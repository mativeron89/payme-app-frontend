#!/usr/bin/env node
/**
 * GATE DEL ALIAS Y SU HERRAMIENTA · **el entrypoint, y lo único con efectos.**
 *
 * Toda la lógica vive en `./aliasesLib.mjs`, que se puede importar sin que pase
 * nada. Este archivo existe para una sola cosa: despachar el modo pedido y
 * reportar. **Nadie lo importa** — el workflow lo invoca con `node`.
 *
 * 🔴 P99 · POR QUÉ ESTÁN SEPARADOS, y por qué eso reemplaza al guard de `main`.
 *
 * Hasta la v0.129.0 esto era un solo archivo con un guard que decidía en runtime
 * si actuaba como CLI o como módulo. El guard funcionaba —sus mutantes morían—
 * pero **la superficie importable seguía conteniendo el dispatcher**, así que la
 * garantía dependía de una condición y no de la estructura. Codex mostró que un
 * efecto que no pasa por `npx` —`invalidar('corrida')`, `invalidar('build')`,
 * `adjudicarAliases()`— dejaba el centinela **3/3 verde** desde la rama
 * importada, y dos de esos sinks son los que usa el workflow.
 *
 * **La separación no mejora el guard: lo vuelve innecesario.** No hay rama
 * importada capaz de ejecutar nada porque el código que ejecuta **no está en el
 * archivo que se importa**.
 *
 * ## Los modos
 *
 *   --aliases     El CONJUNTO COMPLETO de `scripts` es el adjudicado —así no
 *                 puede existir un `pretest`—, no hay config versionada que
 *                 cambie el ejecutor, los proyectos de TypeScript cubren todo el
 *                 disco, y la colección declarada de Vitest y Playwright también.
 *   --corrida     DESPUÉS de la suite: lee el reporte que Vitest escribió y
 *                 acredita QUÉ SE EJECUTÓ, no qué se iba a ejecutar.
 *   --invalidar   BORRA el resultado de una herramienta antes de correrla, para
 *                 que su reaparición sea la acreditación.
 *   --artefacto   DESPUÉS del build: `dist` existe y tiene sustancia — y como se
 *                 borró antes, existir significa que ESTE build lo escribió.
 */
import {
  acreditarArtefacto,
  acreditarCorrida,
  adjudicarAliases,
  adjudicarPoblacion,
  adjudicarProyectosTs,
  fallas,
  invalidar,
} from './aliasesLib.mjs';

const modo = process.argv[2] ?? '--aliases';
if (modo === '--aliases') {
  adjudicarAliases();
  adjudicarProyectosTs();
  adjudicarPoblacion();
} else if (modo === '--corrida') {
  acreditarCorrida();
} else if (modo === '--invalidar') {
  invalidar(process.argv[3] ?? '(sin nombre)');
} else if (modo === '--artefacto') {
  acreditarArtefacto(process.argv[3] ?? '(sin destino)');
} else {
  console.error(`modo desconocido: ${modo} (usar --aliases, --corrida, --invalidar o --artefacto)`);
  process.exit(2);
}

if (fallas.length > 0) {
  console.error('❌ el alias no acredita su herramienta:\n');
  for (const f of fallas) console.error(`  · ${f}`);
  console.error(
    '\n  Un gate que sale 0 sin ejecutar su herramienta deja publicar sobre una ' +
      'verificación que no verificó.',
  );
  process.exit(1);
}
console.log(
  {
    '--aliases':
      '── aliases OK: el conjunto de scripts es el adjudicado y la colección declarada cubre ' +
      'todo lo que existe en disco.',
    '--corrida': '── corrida OK: la suite EJECUTÓ todos los archivos de test que existen en disco.',
    '--invalidar':
      '── invalidado: el resultado anterior se borró, así que reaparecer lo acredita.',
    '--artefacto': '── artefacto OK: `dist` lo escribió ESTA ejecución, no un build anterior.',
  }[modo],
);
