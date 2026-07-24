import { Icon, type IconName } from './Icon';
import { navigate, type PageId } from '../router';

/**
 * Barra inferior fija (T-F1, feedback del hermano 2026-07-24): Inicio ·
 * Cuenta · Amigos · Perfil. Amigos y Grupos son UNA sección (tabs internas);
 * la pestaña Amigos queda activa en ambas páginas. Los flujos (mesa, pago,
 * scan) siguen a pantalla completa.
 */

const TABS: Array<{ page: PageId; label: string; icon: IconName }> = [
  { page: 'home', label: 'Inicio', icon: 'home' },
  { page: 'cuenta', label: 'Cuenta', icon: 'wallet' },
  { page: 'amigos', label: 'Amigos', icon: 'users' },
  { page: 'perfil', label: 'Perfil', icon: 'settings' },
];

export function BottomNav({ active }: { active: PageId }) {
  // 'grupos' vive dentro de la sección Amigos: misma pestaña encendida.
  const activeTab: PageId = active === 'grupos' ? 'amigos' : active;
  return (
    <nav className="bottom-nav" aria-label="Navegación principal">
      {TABS.map((t) => (
        <button
          key={t.page}
          className={`nav-item ${activeTab === t.page ? 'on' : ''}`}
          onClick={() => navigate(t.page)}
          aria-current={activeTab === t.page ? 'page' : undefined}
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
