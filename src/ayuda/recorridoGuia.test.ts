import { describe, expect, it } from 'vitest';
import { enElRecorrido, pasoDeLaGuia, saliendoVuelveAInicio, type DondeEsta } from './recorridoGuia';

const en = (d: Partial<DondeEsta>): DondeEsta => ({ fase: 'foto', pagina: 'home', param: null, subpaso: 0, division: null, ...d });
const t = (s: string) => s;

describe('D363 · el paso sale de la fase del ejemplo y de la ruta', () => {
  it('2a · en Inicio (o en Más, si se abrió desde Ayuda), arriba de Escanear, sin ✕ y con «otro momento»', () => {
    for (const pagina of ['home', 'mas'] as const) {
      expect(pasoDeLaGuia(en({ pagina }), t)).toMatchObject({
        id: 'apertura', ancla: 'camara', lado: 'arriba', senal: 'flecha', salida: 'enlace', pie: 'nada', negrita: true,
        textos: ['¿Cómo divido la cuenta?', 'Primero escaneamos el ticket en el siguiente botón.'],
      });
    }
  });

  it('2b · en la cámara, la flecha al disparador con el anillo claro y el texto de P1', () => {
    expect(pasoDeLaGuia(en({ pagina: 'scan' }), t)).toMatchObject({
      id: 'camara', ancla: 'foto', referencia: 'galeria', senal: 'flecha', anillo: 'claro', salida: 'equis', negrita: false,
      textos: ['Saca o elige una foto: te mostraremos un ticket de ejemplo.'],
    });
  });

  it('3a · dentro de la hoja del ticket, arriba, con punta y Siguiente sin contador', () => {
    expect(pasoDeLaGuia(en({ fase: 'ticket', pagina: 'scan' }), t)).toMatchObject({
      id: 'ticket', ancla: 'hoja-ticket', lado: 'arriba', senal: 'punta', pie: 'siguiente', contador: null, dentroDeLaHoja: true,
    });
  });

  it('2c no tiene burbuja de la guía', () => {
    expect(pasoDeLaGuia(en({ fase: 'dividir', pagina: 'scan' }), t)).toBeNull();
  });

  it('2d · dos subpasos: la tarjeta de invitar con «1 de 2» y Siguiente; después la flecha a Continuar con «2 de 2»', () => {
    expect(pasoDeLaGuia(en({ fase: 'compartir', pagina: 'scan' }), t)).toMatchObject({
      id: 'invitar', ancla: 'compartir', lado: 'abajo', senal: 'punta', pie: 'siguiente', contador: [1, 2],
    });
    expect(pasoDeLaGuia(en({ fase: 'compartir', pagina: 'scan', subpaso: 1 }), t)).toMatchObject({
      id: 'continuar', ancla: 'continuar', senal: 'flecha', pie: 'contador', contador: [2, 2],
      textos: ['Toca Continuar para elegir lo tuyo.'],
    });
  });

  it('2e · «Tus consumos», con flecha y sin pie; el texto depende de la forma de dividir (Q10)', () => {
    const consumo = pasoDeLaGuia(en({ fase: 'mesa', pagina: 'mesa', param: 'PA-1224', division: 'consumo' }), t);
    expect(consumo).toMatchObject({ id: 'consumos', ancla: 'consumos', senal: 'flecha', pie: 'nada' });
    expect(consumo?.textos[0]).toBe('Selecciona lo que consumiste únicamente.');
    for (const division of ['igual', 'total'] as const) {
      expect(pasoDeLaGuia(en({ fase: 'mesa', pagina: 'mesa', param: 'PA-1224', division }), t)?.textos).toEqual([
        'Marca lo que consumiste, si quieres.',
        'Si compartiste, selecciona cuánto del plato consumiste. Toca Listo para guardar lo que elegiste.',
      ]);
    }
  });

  it('4a · debajo de la mesa de ejemplo, con «Terminar guía» y el texto de D367', () => {
    expect(pasoDeLaGuia(en({ fase: 'listo', pagina: 'home' }), t)).toMatchObject({
      id: 'final', ancla: 'mesa-ejemplo', lado: 'abajo', senal: 'punta', pie: 'terminar',
      textos: ['Así queda tu mesa.', 'La tarjeta muestra cuánto ya se eligió de la cuenta. Esta es de ejemplo: se borra al terminar la guía.'],
    });
  });

  it('una fase en la pantalla equivocada no inventa un paso', () => {
    expect(pasoDeLaGuia(en({ fase: 'ticket', pagina: 'home' }), t)).toBeNull();
    expect(pasoDeLaGuia(en({ fase: 'mesa', pagina: 'home' }), t)).toBeNull();
    expect(pasoDeLaGuia(en({ fase: 'listo', pagina: 'mas' }), t)).toBeNull();
  });
});

describe('D363 · Q7 · irse del recorrido cierra la guía', () => {
  it('cada fase admite sus pantallas; Compartir y «Listo», también la mesa de ejemplo (la ruta y la fase no cambian juntas)', () => {
    expect(enElRecorrido({ fase: 'foto', pagina: 'home', param: null })).toBe(true);
    expect(enElRecorrido({ fase: 'foto', pagina: 'mas', param: null })).toBe(true);
    expect(enElRecorrido({ fase: 'foto', pagina: 'scan', param: null })).toBe(true);
    expect(enElRecorrido({ fase: 'dividir', pagina: 'scan', param: null })).toBe(true);
    expect(enElRecorrido({ fase: 'compartir', pagina: 'mesa', param: 'PA-1224' })).toBe(true);
    expect(enElRecorrido({ fase: 'mesa', pagina: 'mesa', param: 'pa-1224' })).toBe(true);
    expect(enElRecorrido({ fase: 'listo', pagina: 'home', param: null })).toBe(true);
    // «Listo» mueve la fase un instante antes de que la ruta deje la mesa.
    expect(enElRecorrido({ fase: 'listo', pagina: 'mesa', param: 'PA-1224' })).toBe(true);
  });

  it('otra pestaña, «Volver» después de la foto o una mesa de verdad, no', () => {
    expect(enElRecorrido({ fase: 'foto', pagina: 'mesas', param: null })).toBe(false);
    expect(enElRecorrido({ fase: 'ticket', pagina: 'home', param: null })).toBe(false);
    expect(enElRecorrido({ fase: 'dividir', pagina: 'home', param: null })).toBe(false);
    expect(enElRecorrido({ fase: 'compartir', pagina: 'mesa', param: 'PA-12240' })).toBe(false);
    expect(enElRecorrido({ fase: 'mesa', pagina: 'home', param: null })).toBe(false);
    expect(enElRecorrido({ fase: 'listo', pagina: 'mesas', param: null })).toBe(false);
  });

  it('al salir desde la cámara o la mesa de ejemplo se vuelve a Inicio; desde Inicio o Más, no se navega', () => {
    expect(saliendoVuelveAInicio({ pagina: 'scan', param: null })).toBe(true);
    expect(saliendoVuelveAInicio({ pagina: 'mesa', param: 'PA-1224' })).toBe(true);
    expect(saliendoVuelveAInicio({ pagina: 'mesa', param: 'PA-12240' })).toBe(false);
    expect(saliendoVuelveAInicio({ pagina: 'home', param: null })).toBe(false);
    expect(saliendoVuelveAInicio({ pagina: 'mas', param: null })).toBe(false);
  });
});
