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

/**
 * Quién dibuja esta barra y quién no lo decide `App.tsx` con `showNav`, no este
 * archivo: las pantallas ya convertidas a §5 bis · C montan `AppBottomBar`
 * ellas mismas y por eso salieron de esa lista.
 *
 * Se probó al revés —que este componente devolviera `null` en las rutas
 * convertidas— para no tocar `App.tsx`. Funcionaba, pero escondía en un
 * componente de presentación una decisión de ruteo que ya tenía su lugar.
 */
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
