import { AuthProvider, useAuth } from './auth/AuthContext';
import { useRoute, type PageId } from './router';
import { HomeScreen } from './screens/HomeScreen';
import { LoginScreen } from './screens/LoginScreen';
import { StubScreen } from './screens/StubScreen';

/** Pantallas de tiers futuros (título · emoji · tier en que llegan). */
const STUBS: Record<Exclude<PageId, 'home'>, { title: string; emoji: string; tier: string }> = {
  cuenta: { title: 'Mi Cuenta', emoji: '💳', tier: 'Tier 5' },
  cargar: { title: 'Cargar saldo', emoji: '➕', tier: 'Tier 5' },
  transferir: { title: 'Transferir', emoji: '↗️', tier: 'Tier 5' },
  amigos: { title: 'Amigos', emoji: '👥', tier: 'Tier 5' },
  grupos: { title: 'Grupos', emoji: '👨‍👩‍👧', tier: 'Tier 5' },
  mesas: { title: 'Mesas Abiertas', emoji: '🍽️', tier: 'Tier 2' },
  scan: { title: 'Escanear ticket', emoji: '📷', tier: 'Tier 2' },
  perfil: { title: 'Perfil', emoji: '⚙️', tier: 'Tier 5' },
  mesa: { title: 'Mesa', emoji: '🍽️', tier: 'Tier 2' },
};

function Shell() {
  const { session } = useAuth();
  const route = useRoute();

  if (!session) return <LoginScreen />;
  if (route.page === 'home') return <HomeScreen />;
  const stub = STUBS[route.page];
  return <StubScreen title={stub.title} emoji={stub.emoji} tier={stub.tier} />;
}

export default function App() {
  return (
    <AuthProvider>
      <div className="app">
        <Shell />
      </div>
    </AuthProvider>
  );
}
