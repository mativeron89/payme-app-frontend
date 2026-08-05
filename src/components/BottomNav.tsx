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
  /**
   * Inicio ya adoptó la barra de CINCO posiciones (`AppBottomBar`, §5 bis · C)
   * y la monta ella misma, como ya hacían `scan`, `mesa` y `avisos`. Esta vieja
   * no se dibuja encima: serían dos barras superpuestas.
   *
   * Se resuelve acá y no sacando `home` del `showNav` de `App.tsx` porque este
   * componente ES el punto donde `App.tsx` delega toda la navegación inferior,
   * y `App.tsx` tiene una batería de tests de rutas wallet que no conviene
   * mover por un cambio de diseño. Cuando §1.9 convierta a Amigos, Grupos y
   * Perfil, este archivo se queda sin razón de existir y se retira entero.
   */
  if (active === 'home') return null;

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
