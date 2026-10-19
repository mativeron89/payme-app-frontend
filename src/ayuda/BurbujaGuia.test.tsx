import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BurbujaGuia } from './BurbujaGuia';
import { pasoDeLaGuia, type DondeEsta } from './recorridoGuia';

const t = (s: string, ...a: unknown[]) => s.replace('{0}', String(a[0])).replace('{1}', String(a[1]));
const en = (d: Partial<DondeEsta>): DondeEsta => ({ fase: 'foto', pagina: 'home', param: null, subpaso: 0, division: 'consumo', ...d });
const nada = () => undefined;

function dibujar(d: Partial<DondeEsta>, lado: 'arriba' | 'abajo' = 'arriba'): string {
  const paso = pasoDeLaGuia(en(d), t)!;
  return renderToStaticMarkup(
    <BurbujaGuia
      paso={paso}
      posicion={{ left: 16, top: 400, lado, maxAlto: 300, centro: 179 }}
      objetivo={{ left: 167, top: 754, right: 223, bottom: 810 }}
      radio="50%"
      zoom={1}
      ancho={358}
      t={t}
      burbujaRef={null}
      onSalir={nada}
      onSiguiente={nada}
      onTerminar={nada}
    />,
  );
}

describe('D363 · la burbuja del tutorial', () => {
  it('es un diálogo NO modal nombrado por su primera frase, que va en 700', () => {
    const html = dibujar({});
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="false"');
    const id = /aria-labelledby="([^"]+)"/.exec(html)![1]!;
    expect(html).toContain(`<p id="${id}" class="guia-primera">¿Cómo divido la cuenta?</p>`);
  });

  it('2a · sin ✕ y con «Realizar el tutorial en otro momento»; con flecha y sin pie', () => {
    const html = dibujar({});
    expect(html).not.toContain('aria-label="Cerrar guía"');
    expect(html).toContain('>Realizar el tutorial en otro momento<');
    expect(html).toContain('class="guia-flecha"');
    expect(html).not.toContain('guia-pie');
  });

  it('3a · ✕, punta y Siguiente sin contador', () => {
    const html = dibujar({ fase: 'ticket', pagina: 'scan' });
    expect(html).toContain('aria-label="Cerrar guía"');
    expect(html).toContain('class="guia-punta"');
    expect(html).toContain('>Siguiente<');
    expect(html).not.toContain('guia-contador');
    expect(html).not.toContain('guia-flecha');
  });

  it('2d · «1 de 2» con Siguiente; «2 de 2» sólo con el contador', () => {
    const uno = dibujar({ fase: 'compartir', pagina: 'scan' }, 'abajo');
    expect(uno).toContain('>1 de 2<');
    expect(uno).toContain('>Siguiente<');
    const dos = dibujar({ fase: 'compartir', pagina: 'scan', subpaso: 1 });
    expect(dos).toContain('>2 de 2<');
    expect(dos).not.toContain('>Siguiente<');
  });

  it('4a · «Terminar guía» centrado, sin contador ni Siguiente', () => {
    const html = dibujar({ fase: 'listo', pagina: 'home' }, 'abajo');
    expect(html).toContain('guia-pie guia-pie--final');
    expect(html.match(/class="guia-pie/g)).toHaveLength(1);
    expect(html).toContain('>Terminar guía<');
    expect(html).not.toContain('>Siguiente<');
    expect(html).not.toContain('guia-contador');
  });

  it('el anillo rodea el control con 4 de aire, y la flecha va entre la burbuja y el anillo', () => {
    const html = dibujar({});
    expect(html).toContain('left:163px;top:750px;width:64px;height:64px;border-radius:50%');
    // Arriba del control: 754 − 8 (anillo) − 4 − 28 = 714; centrada en el control (195 − 14).
    expect(html).toContain('class="guia-flecha" data-lado="arriba" aria-hidden="true" style="left:181px;top:714px"');
  });

  it('2b · la flecha va al costado del disparador, no entre la burbuja y él', () => {
    const html = dibujar({ pagina: 'scan' });
    // 167 − 8 − 4 − 28 = 127; a la altura del centro del control (782 − 14).
    expect(html).toContain('data-lado="costado" aria-hidden="true" style="left:127px;top:768px"');
  });
});
