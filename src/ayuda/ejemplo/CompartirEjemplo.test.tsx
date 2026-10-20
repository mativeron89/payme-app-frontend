import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AccionesDeCompartirEjemplo, AmigosDeEjemplo } from './CompartirEjemplo';
import { AMIGOS_DE_EJEMPLO } from './fixtureEjemplo';
import { pasoDeLaGuia } from '../recorridoGuia';

const t = (s: string) => s;

describe('D429 · compartir explica con controles y amigos inventados', () => {
  it('usa botones habilitados, sin anclas, imágenes, formulario, credenciales ni link', () => {
    const html = renderToStaticMarkup(<><AccionesDeCompartirEjemplo t={t} /><AmigosDeEjemplo t={t} /></>);
    expect(html.match(/<button /g)).toHaveLength(5);
    expect(html).toContain('Copiar link');
    expect(html).toContain('WhatsApp');
    expect(html).toContain('Amigos de ejemplo');
    for (const amigo of AMIGOS_DE_EJEMPLO) expect(html).toContain(amigo.nombre);
    expect(html).not.toMatch(/href=|<a\s|<img\s|<form\s|disabled|https?:|payme_id|blob:/);
  });

  it('cada acción señala su control y explica; cerrar vuelve al mismo subpaso sin avanzar', () => {
    for (const subpaso of [0, 1] as const) {
      const donde = { fase: 'compartir', pagina: 'scan', param: null, subpaso, division: 'consumo' } as const;
      const base = pasoDeLaGuia(donde, t);
      if (subpaso === 0) expect(base?.lado).toBe('arriba');
      for (const accion of ['copiar', 'whatsapp', ...AMIGOS_DE_EJEMPLO.map((a) => a.id)] as const) {
        const paso = pasoDeLaGuia({ ...donde, explicacionCompartir: accion }, t);
        expect(paso).toMatchObject({ id: 'explicacion-compartir', ancla: `ejemplo-${accion}`, pie: 'nada', salida: 'equis', contador: null });
        expect(paso?.textos[0]).toContain('En tu mesa,');
        expect(paso?.textos[0]).toContain('Aquí');
      }
      expect(pasoDeLaGuia({ ...donde, explicacionCompartir: null }, t)).toEqual(base);
    }
  });
});
