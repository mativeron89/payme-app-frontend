import type { ReactNode } from 'react';
import { FilaDeTitulo, type IconoDeTarjeta } from '../components/TarjetaDeTitulo';

/**
 * D479/D482 · AF-1 · la cabecera de las cinco pantallas de «Mis estadísticas»
 * (Claude Design 0.261, decisión 1 del LEEME): tarjeta de título blanca con el
 * cuadro navy de 48 y el título visible de 22/800, y debajo el período. La misma
 * tarjeta en cargando, error, vacío y lista: nada salta.
 */
export function CabeceraDeEstadisticas({ icono, titulo, children }: {
  icono: IconoDeTarjeta;
  titulo: string;
  /** El período (el selector, o el texto fijo de Evolución). */
  children: ReactNode;
}) {
  return (
    <div className="title-card est-cabecera">
      <FilaDeTitulo icono={icono}>
        <h1 className="title-card-title">{titulo}</h1>
      </FilaDeTitulo>
      {children}
    </div>
  );
}

/**
 * 1e · el esqueleto con la forma de la pantalla: resumen, cocinas y accesos. Sin
 * números: no afirma nada mientras carga.
 */
export function EsqueletoDeEstadisticas({ etiqueta }: { etiqueta: string }) {
  return (
    <div className="est-esqueleto" aria-busy="true" aria-label={etiqueta}>
      {[0, 1, 2].map((i) => (
        <div key={i} className="est-panel est-esqueleto-panel" aria-hidden="true">
          <span className="sk-line w40" />
          <span className="sk-line w70 tall" />
          <span className="sk-line w40" />
        </div>
      ))}
    </div>
  );
}
