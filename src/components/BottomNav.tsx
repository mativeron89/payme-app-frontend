import { Icon, type IconName } from './Icon';
import { navigate, type PageId } from '../router';

/**
 * Barra inferior fija (T-D3a, mock del hermano de Mati): Inicio · Amigos ·
 * Grupos · Perfil. Solo se muestra en esas cuatro pantallas "hub" — los
 * flujos (mesa, pago, scan) siguen a pantalla completa.
 */

const TABS: Array<{ page: PageId; label: string; icon: IconName }> = [
  { page: 'home', label: 'Inicio', icon: 'home' },
  { page: 'amigos', label: 'Amigos', icon: 'users' },
  { page: 'grupos', label: 'Grupos', icon: 'users-group' },
  { page: 'perfil', label: 'Perfil', icon: 'settings' },
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
            <Icon name={t.icon} size={22} />
          </span>
          {t.label}
        </button>
      ))}
    </nav>
  );
}
