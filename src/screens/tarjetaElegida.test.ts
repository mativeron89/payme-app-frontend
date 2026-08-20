import { describe, expect, it } from 'vitest';
import { metodoSinElegir, SIN_TARJETA_ELEGIDA } from './tarjetaElegida';

/**
 * §1.5 bis · «El selector de método de pago» (`diseno/SPEC_APP.md`), y la
 * ORDEN 1-B que le presta el sentinela.
 *
 * La regla vive acá, pura, por el mismo motivo que `pisoDe` o `payGate`: si
 * viviera en el JSX de `MesaScreen` sólo se podría ejercitar montando la
 * pantalla entera, y el caso que más importa —el frozen— no se alcanza en la
 * suite mock.
 */
describe('§1.5 bis · el método sin elegir', () => {
  it('🔴 el sentinela NO es `new` ni un uuid: los dos afirman algo', () => {
    // `'new'` significa «voy a tipear otra», que es una ELECCIÓN. Que el
    // sentinela valga `''` es lo que permite distinguir «no elegí» de «elegí
    // tipear una», y esa distinción es la sección entera.
    expect(SIN_TARJETA_ELEGIDA).toBe('');
    expect(SIN_TARJETA_ELEGIDA).not.toBe('new');
  });

  it('con guardadas y ninguna elegida: pendiente', () => {
    expect(metodoSinElegir('card', 2, SIN_TARJETA_ELEGIDA)).toBe(true);
  });

  it('🔴 SIN guardadas NO es pendiente: no es «no elegiste», es «no hay qué elegir»', () => {
    // El caso que convierte la guarda en un callejón sin salida si se olvida:
    // sin tarjetas el único camino es tipear una, y frenar el pago ahí pediría
    // una acción que la pantalla no ofrece.
    expect(metodoSinElegir('card', 0, SIN_TARJETA_ELEGIDA)).toBe(false);
  });

  it('elegir «usar otra tarjeta» YA es elegir', () => {
    expect(metodoSinElegir('card', 2, 'new')).toBe(false);
  });

  it('una guardada elegida tampoco es pendiente', () => {
    expect(metodoSinElegir('card', 2, 'pm_abc')).toBe(false);
  });

  it('🔴 con otro método el selector de tarjeta no opina', () => {
    // Los rieles hermanos están dormidos hoy, pero la regla no puede frenar un
    // pago por saldo o wallet nativo porque no se eligió una TARJETA.
    expect(metodoSinElegir('wallet', 2, SIN_TARJETA_ELEGIDA)).toBe(false);
    expect(metodoSinElegir('apple_pay', 2, SIN_TARJETA_ELEGIDA)).toBe(false);
  });
});
