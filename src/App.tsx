import { useEffect } from 'react';
import { IS_MOCK } from './api';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { BottomNav } from './components/BottomNav';
import { ToastProvider } from './components/ui';
import { allowsWalletRoute } from './api/releaseGates';
import { tokenForMesa } from './api/invitationLink';
import { useWalletRail } from './api/walletRail';
import { useRoute } from './router';
import { enforceWalletRouteGuard } from './walletRouteGuard';
import { AvisosScreen } from './screens/AvisosScreen';
import { CreateMesaFlow } from './screens/CreateMesaFlow';
import { CuentaScreen } from './screens/CuentaScreen';
import { EstadisticasScreen } from './screens/EstadisticasScreen';
import { FriendsScreen } from './screens/FriendsScreen';
import { GroupsScreen } from './screens/GroupsScreen';
import { HomeScreen } from './screens/HomeScreen';
import { JoinMesaScreen } from './screens/JoinMesaScreen';
import { LoginScreen } from './screens/LoginScreen';
import { MesaScreen } from './screens/MesaScreen';
import { MesasScreen } from './screens/MesasScreen';
import { PagosScreen } from './screens/PagosScreen';
import { PerfilScreen } from './screens/PerfilScreen';
import { TarjetasScreen } from './screens/TarjetasScreen';
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
   * ORDEN 3A · las rutas del riel saldo NO MUESTRAN NADA: redirigen.
   *
   * Antes acá se renderizaba un cartel que decía *"El riel de saldo PayMe
   * todavía no está habilitado para esta versión"*. Eso es **copy que anuncia el
   * riel**: la ratificación pide cero UI y cero rutas, y un cartel que nombra el
   * saldo es UI del saldo. Peor, insinúa que en otra versión sí está.
   *
   * Ahora se va a superficie neutra con `replaceRoute`, que **no deja entrada en
   * el historial**: con `navigate`, `#/cargar` quedaría viva y el botón Atrás la
   * recuperaría. Es el mismo mecanismo por el que Back revivía el token de una
   * invitación — una ruta a la que no se puede entrar tampoco se puede volver.
   *
   * Cubre los CUATRO estados en que el riel está apagado —`false`, ausente,
   * `pending` y malformada—, porque los cuatro producen `walletRailEnabled:
   * false` en `walletRail.ts`. Y vale igual en real y en mock: el mock recorre
   * el mismo lector.
   *
   * `TopupScreen` y `TransferScreen` no se montan, así que tampoco llaman a
   * ningún endpoint. Las dos siguen en el árbol, durmientes.
   *
   * ORDEN 4C · la redirección vive en `walletRouteGuard.ts`. No es prolijidad:
   * mientras la llamada estaba acá adentro, **ningún test podía morir al
   * borrarla** —sin librería de render un efecto no se ejecuta en la suite— y
   * el único test que había afirmaba que la ruta *está prohibida*, no que se
   * *actúe* en consecuencia. Una defensa declarada que nadie comprueba
   * ejecutada es lo mismo que no tenerla.
   */
  const rutaDelRielSaldo = !allowsWalletRoute(walletRailEnabled, route.page);
  useEffect(() => {
    enforceWalletRouteGuard(walletRailEnabled, route.page);
  }, [walletRailEnabled, route.page]);

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

  // Sin copy y sin pantalla: el efecto de arriba ya está redirigiendo.
  if (rutaDelRielSaldo) return null;

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
      // §1.11 · las tres que lanzan las pestañas de Inicio. Son de PRIMER
      // NIVEL: cada una con su ruta, no colgadas de un parámetro de `cuenta`.
      case 'tarjetas':
        return <TarjetasScreen />;
      case 'pagos':
        return <PagosScreen />;
      case 'estadisticas':
        return <EstadisticasScreen />;
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
      /**
       * **El guard real es el `never`, no el `default`.**
       *
       * Si mañana alguien agrega una página a `PAGES` y se olvida del `case`,
       * `route.page` **no estrecha a `never` y el build revienta**. No es un
       * test que haya que acordarse de correr: es **imposible de shipear**.
       *
       * El `return` es la red de runtime, y hoy es **inalcanzable** — hay que
       * decir cuál de las dos es, no suponerlo:
       *
       * > `parseHash` valida el hash contra `VALID_PAGES` antes del cast, y
       * > desde este commit ese `Set` se construye de `PAGES`, de donde se
       * > deriva `PageId`. Así que el `default` está muerto **porque** existen
       * > esos dos cambios. Antes de ellos estaba **vivo**: el cast era sin
       * > chequeo y una entrada del `Set` que no estuviera en la unión llegaba
       * > acá sin `case` y dejaba la pantalla en blanco.
       *
       * Se conserva igual. Una red que hoy nadie pisa cuesta tres líneas, y es
       * lo único que separa un `case` faltante de una app en blanco si alguna
       * de las dos garantías de arriba se afloja.
       */
      default: {
        const paginaNoCubierta: never = route.page;
        void paginaNoCubierta;
        return <HomeScreen />;
      }
    }
  })();

  /**
   * Barra inferior VIEJA (`BottomNav`), sólo en las pantallas que todavía no
   * adoptaron la de cinco posiciones de `SISTEMA_DISENO.md` §5 bis · C.
   *
   * **`home` salió de esta lista** al rediseñarse §1.1: Inicio monta
   * `AppBottomBar` él mismo, igual que `scan`, `mesa`, `avisos` y las tres
   * pantallas de §1.11 —que por eso tampoco están acá—. Dejarlo habría
   * dibujado dos barras superpuestas.
   *
   * **`perfil` salió con §1.9 · paso 3.** Cada pantalla se convierte montando
   * `AppBottomBar` **y saliendo de esta lista en el mismo commit**: hacer una
   * sola de las dos mitades deja las dos barras conviviendo, superpuestas.
   *
   * Cuando salgan Cuenta, Amigos y Grupos, esta variable y `BottomNav.tsx` se
   * van juntas.
   */
  const showNav = route.page === 'cuenta';

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
