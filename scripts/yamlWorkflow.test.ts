import { describe, expect, it } from 'vitest';
import { parsearYaml, pasosDeWorkflow } from './yamlWorkflow';

/**
 * Los contraejemplos del dictamen P60, uno por uno, más los controles.
 *
 * 🔴 Este archivo prueba **el instrumento**, no el workflow. Es la lección de
 * las tres vueltas anteriores: cada vez que el centinela falló, falló porque su
 * LECTOR no veía algo, y el lector nunca tuvo pruebas propias — se lo probaba
 * de refilón a través del `ci.yml` real, que por definición sólo contiene las
 * formas que ya usamos. Un lector probado sólo contra la entrada que ya
 * funciona no tiene cómo fallar en el test y sí en la realidad.
 */
describe('parser YAML · los contraejemplos que dejaron 49/49 verde', () => {
  it('🔴 ① el guion SOLO en su renglón abre un ítem igual', () => {
    const { pasos, indecidibles } = pasosDeWorkflow(`
name: CI
jobs:
  build:
    steps:
      -
        run: npx vercel --prod
      - uses: actions/checkout@v4
`);
    expect(indecidibles).toEqual([]);
    expect(pasos).toHaveLength(2);
    // El publicador estaba PRIMERO, que es justo donde desaparecía.
    expect(pasos[0]!.claves['run']).toBe('npx vercel --prod');
    expect(pasos[1]!.claves['uses']).toBe('actions/checkout@v4');
  });

  it('🔴 ② un SEGUNDO job con pasos también se recorre', () => {
    const { pasos, indecidibles } = pasosDeWorkflow(`
jobs:
  build:
    steps:
      - run: npm test
  colado:
    steps:
      - run: npx vercel --prod
`);
    expect(indecidibles).toEqual([]);
    expect(pasos.map((p) => p.job)).toEqual(['build', 'colado']);
    expect(pasos[1]!.claves['run']).toBe('npx vercel --prod');
  });

  it('⭐ el mapping se lee entero, venga la clave que venga primero', () => {
    const { pasos } = pasosDeWorkflow(`
jobs:
  build:
    steps:
      - continue-on-error: false
        name: publicar
        run: npx vercel --prod
`);
    expect(pasos[0]!.claves).toMatchObject({
      'continue-on-error': 'false',
      name: 'publicar',
      run: 'npx vercel --prod',
    });
  });

  it('⭐ los `run:` de bloque conservan sus renglones', () => {
    const { pasos } = pasosDeWorkflow(`
jobs:
  build:
    steps:
      - run: |
          echo uno
          echo dos
`);
    expect(pasos[0]!.claves['run']).toBe('echo uno\necho dos');
  });
});

describe('parser YAML · FALLA CERRADO ante lo que no entiende', () => {
  /**
   * 🔴 ESTE BLOQUE ES EL DISEÑO, no una lista de casos raros.
   *
   * Las tres vueltas anteriores fallaron porque lo no reconocido DESAPARECÍA.
   * Acá se denuncia, y el centinela que consume esto trata un `indecidible`
   * como rojo. Un lector incompleto que calla es un falso verde; uno que grita
   * es una limitación honesta.
   */
  const fuera: ReadonlyArray<readonly [string, string]> = [
    ['flow collection', 'jobs:\n  b:\n    steps: [{ run: npx vercel --prod }]\n'],
    ['anchor', 'jobs:\n  b:\n    steps:\n      - &x\n        run: npx vercel --prod\n'],
    ['tag', 'jobs:\n  b:\n    steps:\n      - run: !!str npx vercel --prod\n'],
    ['tab en la indentación', 'jobs:\n  b:\n    steps:\n\t      - run: npx vercel\n'],
    ['varios documentos', '---\njobs:\n  b:\n    steps:\n      - run: npm test\n'],
    ['clave explícita', 'jobs:\n  b:\n    steps:\n      - ? complejo\n'],
  ];

  for (const [nombre, yml] of fuera) {
    it(`🔴 ${nombre} → INDECIDIBLE, nunca invisible`, () => {
      const { indecidibles } = pasosDeWorkflow(yml);
      expect(
        indecidibles.length,
        `«${nombre}» pasó sin denuncia: el parser lo ignoró en vez de denunciarlo`,
      ).toBeGreaterThan(0);
    });
  }

  it('⭐ CONTROL · el subconjunto declarado NO produce indecidibles', () => {
    const { indecidibles } = parsearYaml(`
name: CI
on:
  push:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: correr
        run: |
          npm ci
          npm test
`);
    expect(indecidibles).toEqual([]);
  });

  /**
   * 🔴 EL CORTE DEL FLOW NO ES ARBITRARIO, y este par de casos ES el corte.
   *
   * `branches: [main]` se acepta —el `ci.yml` real lo usa, y un gate que no se
   * puede correr se termina aflojando—; `steps: [{ run: … }]` sigue indecidible,
   * porque un mapping adentro del flow es **la forma con la que se colaría un
   * paso sin que el censo lo vea**. Se cortan las llaves y el anidamiento, no
   * los corchetes.
   *
   * Los dos juntos, porque uno solo no dice dónde está la línea.
   */
  it('⭐ el flow de escalares pasa · el flow con mapping NO', () => {
    expect(parsearYaml('branches: [main, next]\n').indecidibles).toEqual([]);
    expect(parsearYaml('branches: [main, next]\n').raiz).toEqual({ branches: ['main', 'next'] });

    const conMapping = pasosDeWorkflow('jobs:\n  b:\n    steps: [{ run: npx vercel --prod }]\n');
    expect(conMapping.indecidibles.length).toBeGreaterThan(0);
    expect(conMapping.pasos, 'un paso escondido en flow NO puede entrar al censo').toEqual([]);
  });
});
