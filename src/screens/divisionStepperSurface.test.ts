import { describe, expect, it } from 'vitest';

const FUENTE = import.meta.glob('/src/screens/CreateMesaFlow.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function pantalla(): string {
  const source = FUENTE['/src/screens/CreateMesaFlow.tsx'];
  expect(source, 'no se pudo leer CreateMesaFlow.tsx').toBeTruthy();
  return source!;
}

function bloqueStepper(): string {
  const source = pantalla();
  const start = source.indexOf('className="sectlabel division-stepper-title"');
  const end = source.indexOf('{participants !== null && (', start);
  expect(start, 'no se encontró el rótulo del stepper').toBeGreaterThan(-1);
  expect(end, 'no se encontró el final del stepper').toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('la pregunta del stepper sigue el significado de N', () => {
  it('deriva una sola pregunta desde divisionModo', () => {
    const source = pantalla();
    expect(source).toContain("tituloStepper(division) === '¿Cuántos pagan?'");
    expect(source).toContain("? t('¿Cuántos pagan?')");
    expect(source).toContain(": t('¿Cuántos son en la mesa?')");
  });

  it('usa la misma pregunta en texto visible y nombre accesible', () => {
    const stepper = bloqueStepper();
    expect(stepper.match(/preguntaStepper/g) ?? []).toHaveLength(2);
    expect(stepper).toContain('{preguntaStepper}');
    expect(stepper).toContain('aria-label={preguntaStepper}');
  });

  it('no vuelve a hardcodear la pregunta de pagadores en la superficie', () => {
    expect(bloqueStepper()).not.toContain("t('¿Cuántos pagan?')");
  });
});
