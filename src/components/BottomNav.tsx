import { navigate, type PageId } from '../router';

/**
 * Barra inferior fija (T-D3a, mock del hermano de Mati): Inicio · Amigos ·
 * Grupos · Perfil. Solo se muestra en esas cuatro pantallas "hub" — los
 * flujos (mesa, pago, scan) siguen a pantalla completa.
 */

const TABS: Array<{ page: PageId; label: string; icon: string }> = [
  { page: 'home', label: 'Inicio', icon: '🏠' },
  { page: 'amigos', label: 'Amigos', icon: '👥' },
  { page: 'grupos', label: 'Grupos', icon: '👨‍👩‍👧' },
  { page: 'perfil', label: 'Perfil', icon: '⚙️' },
];

export function BottomNav({ active }: { active: PageId }) {
  return (
    <nav className="bottom-nav" aria-label="Navegación principal">
      {TABS.map((t) => (
        <button
          key={t.page}
          className={`nav-item ${active === t.page ? 'on' : ''}`}
          onClick={() => navigate(t.page)}
          aria-current={active === t.page ? 'page' : undefined}
        >
          <span className="ico" aria-hidden="true">
            {t.icon}
          </span>
          {t.label}
        </button>
      ))}
    </nav>
  );
}
