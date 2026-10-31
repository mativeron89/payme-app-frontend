import { useMemo } from 'react';
import { codificarQr } from '../qr/codificarQr';

/** La zona de silencio que pide la norma: 4 módulos claros alrededor. */
const SILENCIO = 4;

/**
 * D622 · AF-3 · mejora 6 (§7 de la especificación) · el QR de «Compartir la
 * mesa» y de la hoja del engranaje.
 *
 * Codifica el MISMO link que «Copiar link» (D631) con el generador propio
 * (D630). Se dibuja del lado del cliente en un `<svg>`: fondo blanco con la
 * zona de silencio y los módulos oscuros como un solo `path`; sin imágenes, sin
 * `canvas` y sin pedidos de red. No se guarda ni se comparte la imagen.
 *
 * El nombre accesible dice para qué es («QR para unirse a la mesa …»), no el
 * link: el link con su credencial no va en el texto alternativo. El QR no es el
 * único camino; «Copiar link» sigue al lado.
 *
 * Sin texto, o con un link que no entra en la versión 10, no dibuja nada.
 */
export function CodigoQr({ texto, codigo, t }: {
  readonly texto: string;
  readonly codigo: string;
  readonly t: (s: string, ...a: unknown[]) => string;
}) {
  const dibujo = useMemo(() => {
    if (!texto) return null;
    const m = codificarQr(texto);
    if (!m) return null;
    let d = '';
    m.modulos.forEach((fila, r) => {
      for (let c = 0; c < fila.length;) {
        if (!fila[c]) {
          c++;
          continue;
        }
        let w = 1;
        while (c + w < fila.length && fila[c + w]) w++;
        d += `M${c + SILENCIO} ${r + SILENCIO}h${w}v1h-${w}z`;
        c += w;
      }
    });
    return { lado: m.tamano + 2 * SILENCIO, d };
  }, [texto]);
  if (!dibujo) return null;
  const { lado, d } = dibujo;
  return (
    <div className="codigo-qr">
      <svg
        className="codigo-qr-svg"
        role="img"
        aria-label={t('QR para unirse a la mesa {0}', codigo)}
        viewBox={`0 0 ${lado} ${lado}`}
        shapeRendering="crispEdges"
      >
        <rect width={lado} height={lado} fill="#fff" />
        <path d={d} fill="#000" />
      </svg>
      <p className="codigo-qr-ayuda">{t('Que lo escaneen con la cámara.')}</p>
    </div>
  );
}
