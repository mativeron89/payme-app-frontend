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

/**
 * Desde el rótulo hasta lo que viene después de la tarjeta del stepper (la hoja
 * del ticket). D377 · antes el corte era el monto de al lado, que ya no existe.
 */
function bloqueStepper(): string {
  const source = pantalla();
  const start = source.indexOf('className="sectlabel division-stepper-title"');
  const end = source.indexOf('{ticketVisible && (', start);
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

/**
 * D377 · «Como el diseño» (Mati): en las tres formas el contador es sólo −, el
 * número y +, sin el monto de al lado. Sin esta guarda, la ausencia sólo la
 * vigilaría el e2e.
 */
describe('D377 · el contador no lleva monto al lado', () => {
  it('🔴 el bloque del stepper no calcula ni muestra un importe', () => {
    const stepper = bloqueStepper();
    // Control positivo: el corte toma el grupo entero, con sus dos botones y el número.
    expect(stepper).toContain("aria-label={t('Un comensal menos')}");
    expect(stepper).toContain("aria-label={t('Un comensal más')}");
    expect(stepper).toContain("{participants ?? '—'}");
    // Lo que tenía el monto, como código (no las palabras de un comentario).
    for (const prohibido of ['formatMXN(', "t('c/u')", 'split-amt', 'reserva-monto', 'reservaDelMonto(', 'marcador-monto', 'marcador-rotulo', 'division-stepper-monto', 'perSlot', 'splitEqual(']) {
      expect(stepper, prohibido).not.toContain(prohibido);
    }
  });
});
