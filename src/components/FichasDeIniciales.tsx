import type { FichaDeMiembro } from '../api/miembros';
import { colorDeFicha } from '../screens/quienEligioView';

/**
 * D622 · mejoras 2 y 3 · D628 · las fichas redondas de iniciales. Son
 * decorativas (`aria-hidden`): quién eligió o cuántos se sumaron lo dice el
 * texto de al lado, y el color —por orden de llegada— no significa nada.
 * - Quien mira es «Tú», con borde: nunca sus iniciales.
 * - `faltan`: un «?» de borde punteado por cada esperado que todavía no se sumó.
 * - `resto`: «+N» con los que no entran.
 */
export function FichasDeIniciales({ visibles, faltan = 0, resto, t }: {
  visibles: readonly FichaDeMiembro[];
  faltan?: number;
  resto: number;
  t: (s: string, ...a: unknown[]) => string;
}) {
  if (visibles.length === 0 && faltan === 0 && resto === 0) return null;
  return (
    <span className="qc-fichas" aria-hidden="true">
      {visibles.map((f) => (f.mine
        ? <span key={f.ordinal} className="qc-ficha qc-ficha--tu">{t('Tú')}</span>
        : <span key={f.ordinal} className="qc-ficha" style={{ background: colorDeFicha(f.ordinal) }}>{f.initials}</span>))}
      {Array.from({ length: faltan }, (_, i) => <span key={`falta-${i}`} className="qc-ficha qc-ficha--falta">?</span>)}
      {resto > 0 && <span className="qc-ficha qc-ficha--mas">+{resto}</span>}
    </span>
  );
}
