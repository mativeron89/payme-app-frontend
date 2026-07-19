import { IS_MOCK } from './api';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { ToastProvider } from './components/ui';
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
  // SIN cuenta ni login. guestOrAuth del contrato: token en query.
  // En la demo, el link abre la vista de invitado AUNQUE haya sesión: si no,
  // quien está evaluando (siempre logueado en su teléfono) nunca la vería.
  const guestToken = route.query.get('t');
  if (route.page === 'mesa' && route.param && guestToken && (!session || IS_MOCK)) {
    return <MesaScreen key={`${route.param}:guest`} code={route.param} guestToken={guestToken} />;
  }

  if (!session) return <LoginScreen />;

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
