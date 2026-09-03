import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { esperaA, leerWorkflow, pasosDeWorkflow } from './yamlWorkflow';

it('PAYME_VERCEL_ARTIFACT queda en el proyecto Vercel y no entra al CI ni al bundle', () => {
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
  expect(workflow).not.toContain('PAYME_VERCEL_ARTIFACT');
  expect(readFileSync('vercel.ts', 'utf8')).toContain('process.env.PAYME_VERCEL_ARTIFACT');
});

/**
 * 🔴 QUÉ PRUEBA ESTE ARCHIVO AHORA, Y QUÉ DEJÓ DE PROBAR.
 *
 * Con `js-yaml` adentro, **el parseo dejó de ser nuestro**: anchors, tags, flow,
 * multi-documento y comillas los resuelve la librería, y probarlos acá sería
 * testear a `js-yaml`. Los casos de «FALLA CERRADO ante lo que no entiende» que
 * llenaban este archivo se fueron con el parser propio que los necesitaba.
 *
 * Lo que queda es **el MODELO**, que es lo único nuestro y es exactamente donde
 * el P65 encontró los tres agujeros:
 *
 *   población   ¿qué cuenta como camino ejecutable? (un reusable job lo es)
 *   causalidad  ¿qué acredita que algo corre ANTES? (`needs`, no la posición)
 *   frontera    ¿qué valores llegan al shell? (vive en `despliegue.test.ts`)
 *
 * Los dos contraejemplos del P60 —guion solo, segundo job— se conservan como
 * pruebas de REGRESIÓN: hoy los resuelve la librería, y el día que alguien
 * quiera volver a un lector propio, tiene que pasarlos.
 */
describe('modelo del workflow · la población de caminos ejecutables', () => {
  it('🔴 P65 · un REUSABLE JOB entra al censo, no se saltea', () => {
    const { jobs, problemas } = leerWorkflow(`
jobs:
  build:
    steps:
      - run: npm test
  publicador_reusable_no_adjudicado:
    uses: acme/deploy/.github/workflows/vercel.yml@main
    secrets: inherit
`);
    expect(problemas).toEqual([]);
    expect(jobs).toHaveLength(2);
    const reusable = jobs.find((j) => j.usa !== null);
    expect(reusable, 'el job reusable no llegó al modelo: quedaría sin adjudicar').toBeDefined();
    expect(reusable!.usa).toBe('acme/deploy/.github/workflows/vercel.yml@main');
    // Sus secretos también son parte de lo que hay que adjudicar.
    expect(reusable!.secretos).toBe('inherit');
  });

  it('🔴 un job SIN `steps` y SIN `uses` es indecidible, no un job vacío', () => {
    const { problemas } = leerWorkflow('jobs:\n  raro:\n    runs-on: ubuntu-latest\n');
    expect(problemas.join(' ')).toMatch(/no se puede adjudicar qué ejecuta/);
  });

  it('⭐ REGRESIÓN P60 · el guion solo y el segundo job siguen entrando', () => {
    const { pasos, indecidibles } = pasosDeWorkflow(`
jobs:
  build:
    steps:
      -
        run: npx vercel --prod
  colado:
    steps:
      - run: npm test
`);
    expect(indecidibles).toEqual([]);
    expect(pasos.map((p) => `${p.job}[${p.indice}]`)).toEqual(['build[0]', 'colado[0]']);
    expect(pasos[0]!.claves['run']).toBe('npx vercel --prod');
  });
});

/**
 * 🔴 EL BLOQUE QUE CIERRA EL SEGUNDO HALLAZGO DEL P65.
 *
 * «Está más abajo en el archivo» no significa «corre después». Dos jobs sin
 * `needs` corren EN PARALELO, así que el publicador podía estar textualmente
 * último y no esperar a ningún gate — con el focal en verde.
 */
describe('modelo del workflow · causalidad por `needs`, nunca por posición', () => {
  const wf = `
jobs:
  test:
    steps:
      - run: npm test
  build:
    needs: test
    steps:
      - run: npm run build
  publica:
    needs: [build]
    steps:
      - run: bash scripts/publicar-vercel.sh app "$HOOK_APP"
  suelto:
    steps:
      - run: bash scripts/publicar-vercel.sh app "$HOOK_APP"
`;
  const { jobs } = leerWorkflow(wf);

  it('🔴 la dependencia vale TRANSITIVA', () => {
    expect(esperaA(jobs, 'publica', 'build'), 'no vio la arista directa').toBe(true);
    expect(esperaA(jobs, 'publica', 'test'), 'no siguió la cadena publica→build→test').toBe(true);
  });

  it('🔴 un job SIN `needs` no espera a nadie, esté donde esté en el archivo', () => {
    // `suelto` es el ÚLTIMO del documento y no espera nada. Es exactamente la
    // sonda con la que Codex dejó el focal en 61/61.
    expect(esperaA(jobs, 'suelto', 'test')).toBe(false);
    expect(esperaA(jobs, 'suelto', 'build')).toBe(false);
  });

  it('⭐ y la relación no es simétrica: `test` no espera a `publica`', () => {
    expect(esperaA(jobs, 'test', 'publica')).toBe(false);
  });

  it('⭐ un ciclo no cuelga el recorrido', () => {
    const { jobs: ciclo } = leerWorkflow(`
jobs:
  a:
    needs: b
    steps:
      - run: npm test
  b:
    needs: a
    steps:
      - run: npm test
`);
    expect(esperaA(ciclo, 'a', 'inexistente')).toBe(false);
    expect(esperaA(ciclo, 'a', 'b')).toBe(true);
  });
});
