import type { ReactNode } from 'react';
import { GROSOR_ANILLO, RADIO_ANILLO, type PorcionAnillo } from '../utils/anillo';

/**
 * El anillo de «Mis estadísticas», compartido por 2a (cocinas) y 2c (platos):
 * `<circle>` + `stroke-dasharray`, sin librería ni animación. La aritmética vive
 * en `utils/anillo.ts`; acá sólo se dibuja.
 *
 * `etiqueta` es el `aria-label` del SVG, que dice lo mismo que el color: nunca
 * el color solo. `centro` va encima, oculto para lectores de pantalla porque
 * repite lo que ya dice la etiqueta o la burbuja.
 *
 * E173-4 · `forma` cambia el tamaño, la caja, el radio y el grosor, y `pista`
 * dibuja el aro de fondo. Sin ellos es el de 2c, que no se toca: 188 px, caja
 * 140, radio 54, grosor 17, sin pista.
 */
export interface FormaAnillo {
  readonly tamano: number;
  readonly caja: number;
  readonly radio: number;
  readonly grosor: number;
  readonly pista?: string;
}

const FORMA_2A: FormaAnillo = { tamano: 188, caja: 140, radio: RADIO_ANILLO, grosor: GROSOR_ANILLO };

export function AnilloSvg({
  porciones,
  etiqueta,
  centro,
  forma = FORMA_2A,
}: {
  porciones: readonly PorcionAnillo[];
  etiqueta: string;
  centro: ReactNode;
  forma?: FormaAnillo;
}) {
  const c = forma.caja / 2;
  return (
    <div className="stat-anillo">
      <svg width={forma.tamano} height={forma.tamano} viewBox={`0 0 ${forma.caja} ${forma.caja}`} role="img" aria-label={etiqueta}>
        {forma.pista && (
          <circle className="anillo-pista" cx={c} cy={c} r={forma.radio} fill="none" stroke={forma.pista} strokeWidth={forma.grosor} />
        )}
        <g transform={`rotate(-90 ${c} ${c})`} fill="none" strokeWidth={forma.grosor} strokeLinecap="butt">
          {porciones.map((p, i) => (
            <circle
              key={i}
              cx={c}
              cy={c}
              r={forma.radio}
              stroke={p.color}
              strokeDasharray={`${p.trazo.toFixed(1)} ${p.hueco.toFixed(1)}`}
              strokeDashoffset={p.desde.toFixed(1)}
            />
          ))}
        </g>
      </svg>
      <div className="stat-anillo-centro" aria-hidden="true">{centro}</div>
    </div>
  );
}
