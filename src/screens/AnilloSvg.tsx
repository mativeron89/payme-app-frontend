import type { ReactNode } from 'react';
import { GROSOR_ANILLO, RADIO_ANILLO, type PorcionAnillo } from '../utils/anillo';

/**
 * El anillo de «Mis estadísticas», compartido por 2a (cocinas) y 2c (platos):
 * `<circle>` + `stroke-dasharray`, radio 54, grosor 17, sin librería ni
 * animación. La aritmética vive en `utils/anillo.ts`; acá sólo se dibuja.
 *
 * `etiqueta` es el `aria-label` del SVG, que dice lo mismo que el color: nunca
 * el color solo. `centro` va encima, oculto para lectores de pantalla porque
 * repite lo que ya dice la etiqueta o la burbuja.
 */
export function AnilloSvg({
  porciones,
  etiqueta,
  centro,
}: {
  porciones: readonly PorcionAnillo[];
  etiqueta: string;
  centro: ReactNode;
}) {
  const c = 70;
  return (
    <div className="stat-anillo">
      <svg width="188" height="188" viewBox="0 0 140 140" role="img" aria-label={etiqueta}>
        <g transform={`rotate(-90 ${c} ${c})`} fill="none" strokeWidth={GROSOR_ANILLO} strokeLinecap="butt">
          {porciones.map((p, i) => (
            <circle
              key={i}
              cx={c}
              cy={c}
              r={RADIO_ANILLO}
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
