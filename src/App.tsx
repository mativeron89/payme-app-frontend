import { IS_MOCK } from './api';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { BottomNav } from './components/BottomNav';
import { ToastProvider } from './components/ui';
import { allowsWalletRoute } from './api/releaseGates';
import { tokenForMesa } from './api/invitationLink';
import { useWalletRail } from './api/walletRail';
import { useRoute } from './router';
import { AvisosScreen } from './screens/AvisosScreen';
import { CreateMesaFlow } from './screens/CreateMesaFlow';
import { CuentaScreen } from './screens/CuentaScreen';
import { FriendsScreen } from './screens/FriendsScreen';
import { GroupsScreen } from './screens/GroupsScreen';
import { HomeScreen } from './screens/HomeScreen';
import { JoinMesaScreen } from './screens/JoinMesaScreen';
import { LoginScreen } from './screens/LoginScreen';
import { MesaScreen } from './screens/MesaScreen';
import { MesasScreen } from './screens/MesasScreen';
import { PerfilScreen } from './screens/PerfilScreen';
import { TopupScreen } from './screens/TopupScreen';
import { TransferScreen } from './screens/TransferScreen';

function Shell() {
  const { session } = useAuth();
  const route = useRoute();
  // OLA 5D · quién puede alcanzar el riel saldo lo declara el BACKEND. Se pide
  // antes de cualquier return temprano (regla de hooks) y arranca APAGADO, así
  // que mientras la capability viaja las rutas del riel siguen bloqueadas.
  const { walletRailEnabled } = useWalletRail();

  /**
   * CIERRE DEL PAGO SIN CUENTA (backend v2.32.0) · acá estaba el defecto.
   *
   * Este branch montaba `MesaScreen` en modo INVITADO —con o sin sesión— y le
   * pasaba el token del link. Con eso se veía la mesa, se tomaban ítems y se
   * PAGABA sin cuenta, porque las tres rutas aceptaban `guestOrAuth`. Ahora
   * exigen sesión y contestan **401**, y el token dejó de ser autorización: es
   * una CREDENCIAL que se canjea en `POST /invitations/accept-link`.
   *
   * Así que el link ya no lleva a la mesa: lleva a `JoinMesaScreen`, que
   * conserva el token, empuja al alta si hace falta, canjea, y recién después
   * navega a la mesa **sin `?t=`**.
   *
   * El respaldo en storage no es opcional: el tramo del alta es donde el token
   * se pierde, y perderlo deja a la persona registrada y afuera de la mesa a la
   * que la invitaron — peor que el defecto que se está cerrando.
   *
   * **`useMoneyActor(guestToken)` ya no se llama con el token**, y las ramas de
   * identidad monetaria de invitado (`guest:` en `idempotency.ts:240`) quedan
   * sin call site pero INTACTAS. Es el mismo criterio con el que el emisor dejó
   * `guestOrAuth` en pie con cero call sites: mezclar borrado de código con un
   * cambio de autorización sobre rutas de dinero es cómo se cuelan errores.
   */
  const linkToken = tokenForMesa(route.param ?? '', route.query.get('t'));
  if (route.page === 'mesa' && route.param && linkToken) {
    return <JoinMesaScreen key={route.param} code={route.param} token={linkToken} />;
  }

  if (!session) return <LoginScreen />;

  if (!allowsWalletRoute(walletRailEnabled, route.page)) {
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
