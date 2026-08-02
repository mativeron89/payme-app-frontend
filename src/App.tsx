import { IS_MOCK, WALLET_RAIL_ENABLED } from './api';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { BottomNav } from './components/BottomNav';
import { ToastProvider } from './components/ui';
import { useMoneyActor } from './api/idempotency';
import { allowsWalletRoute } from './api/releaseGates';
import { useRoute } from './router';
import { AvisosScreen } from './screens/AvisosScreen';
import { CreateMesaFlow } from './screens/CreateMesaFlow';
import { CuentaScreen } from './screens/CuentaScreen';
import { FriendsScreen } from './screens/FriendsScreen';
import { GroupsScreen } from './screens/GroupsScreen';
import { HomeScreen } from './screens/HomeScreen';
import { LoginScreen } from './screens/LoginScreen';
import { MesaScreen } from './screens/MesaScreen';
import { MesasScreen } from './screens/MesasScreen';
import { PerfilScreen } from './screens/PerfilScreen';
import { TopupScreen } from './screens/TopupScreen';
import { TransferScreen } from './screens/TransferScreen';

function Shell() {
  const { session } = useAuth();
  const route = useRoute();

  // T3 — momento mágico: el invitado entra por link (#/mesa/:code?t=token)
  // con o sin sesión. guestOrAuth del contrato prioriza el token del link;
  // ignorarlo en real cuando hay sesión mezclaba identidades y dejaba al
  // invitado fuera de la mesa correcta.
  const guestToken = route.query.get('t');
  const { actor: guestActor, resolvedFor: guestResolvedFor } = useMoneyActor(guestToken ?? undefined);
  if (route.page === 'mesa' && route.param && guestToken) {
    // No se monta MesaScreen hasta resolver exactamente ESTE token. Sin este
    // gate, el primer render de B podía reutilizar el fingerprint/estado de A
    // mientras Web Crypto calculaba B. El token no entra al key ni storage.
    if (!guestActor || guestResolvedFor !== guestToken) {
      return <div className="screen"><div className="empty">Abriendo la mesa de invitación…</div></div>;
    }
    // El fingerprint fuerza remount al cambiar A→B y evita que una respuesta
    // tardía de A pinte la mesa de B.
    return <MesaScreen key={`${route.param}:${guestActor?.id ?? 'guest-pending'}`} code={route.param} guestToken={guestToken} />;
  }

  if (!session) return <LoginScreen />;

  if (!allowsWalletRoute(WALLET_RAIL_ENABLED, route.page)) {
    return <div className="screen"><div className="empty">El riel de saldo PayMe todavía no está habilitado para esta versión. No se inició ninguna operación.</div></div>;
  }

  const screen = (() => {
    switch (route.page) {
      case 'home':
        return <HomeScreen />;
      case 'mesas':
        return <MesasScreen />;
      case 'scan':
        return <CreateMesaFlow />;
      case 'mesa':
        return route.param ? <MesaScreen key={route.param} code={route.param} /> : <MesasScreen />;
      case 'cuenta':
        return <CuentaScreen />;
      case 'cargar':
        return <TopupScreen />;
      case 'transferir':
        return <TransferScreen preselectPaymeId={route.param ?? undefined} />;
      case 'amigos':
        return <FriendsScreen />;
      case 'grupos':
        return <GroupsScreen />;
      case 'perfil':
        return <PerfilScreen />;
      case 'avisos':
        return <AvisosScreen />;
    }
  })();

  // T-D3a: barra inferior solo en las cuatro pantallas hub.
  const showNav =
    route.page === 'home' ||
    route.page === 'cuenta' ||
    route.page === 'amigos' ||
    route.page === 'grupos' ||
    route.page === 'perfil';

  return (
    <>
      {screen}
      {showNav && <BottomNav active={route.page} />}
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <div className="app">
          {IS_MOCK && (
            <div className="demo-strip">
              Demo · datos de ejemplo, no se cobra dinero real
            </div>
          )}
          <Shell />
        </div>
      </ToastProvider>
    </AuthProvider>
  );
}
