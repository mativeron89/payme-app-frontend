import { IS_MOCK } from '../api';
import { resetDemo } from '../api/mock/store';
import { useAuth } from '../auth/AuthContext';
import { AppBottomBar } from '../components/AppBottomBar';
import { Icon } from '../components/Icon';
import { Avatar, TopBar } from '../components/ui';
import { navigate } from '../router';
import { useWalletRail } from '../api/walletRail';

/** s-profile: identidad + accesos + salir. */
export function PerfilScreen() {
  const { session, logout } = useAuth();
  // OLA 5D · el rótulo de la fila lo decide el BACKEND, no este repo.
  const { walletRailEnabled } = useWalletRail();
  const user = session?.user;

  return (
    <div className="screen has-appbar">
      <TopBar title="Perfil" />
      {/* Longhands y no `padding: 16`: el shorthand inline PISA el
          `padding-bottom: 140px` de `.has-appbar .scroll`, y la última fila
          —"Cerrar sesión"— queda debajo de la barra. Está advertido en el CSS y
          es exactamente el modo en que se cuela. */}
      <div className="scroll" style={{ paddingTop: 16, paddingLeft: 16, paddingRight: 16 }}>
        <div style={{ textAlign: 'center', padding: '6px 0 18px' }}>
          <Avatar name={user ? `${user.first_name} ${user.last_name}` : 'PayMe'} size={80} />
          <div className="h2" style={{ marginTop: 10 }}>
            {user ? `${user.first_name} ${user.last_name}` : 'Tu cuenta'}
          </div>
          {user && (
            <div style={{ marginTop: 6, fontFamily: 'monospace', fontSize: 'var(--fs-legacy-sm)', color: 'var(--gray-txt)' }}>
              {user.payme_id}
            </div>
          )}
        </div>
        {!user && (
          <div className="note note-orange" style={{ marginBottom: 12 }}>
            Tus datos van a aparecer acá en cuanto termines de crear tu cuenta.
          </div>
        )}
        <div className="card" style={{ marginBottom: 12 }}>
          {user && (
            <div className="list-row" style={{ cursor: 'default' }}>
              <span><Icon name="mail" size={16} /></span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 'var(--fs-legacy-sm)', fontWeight: 600 }}>Email</div>
                <div className="caption">{user.email}</div>
              </div>
            </div>
          )}
          {/* §1.9 · paso 2 · va a `#/tarjetas`, la pantalla de PRIMER NIVEL que
              §1.11 estrenó, y no a la Cuenta vieja que §1.9 retira.

              Es el ÚNICO `navigate('cuenta')` VIVO del repo. Los otros ocho son
              declaraciones o código durmiente del riel saldo —`HomeScreen` ×2
              adentro de bloques `walletRailEnabled`, `TopupScreen` ×5,
              `TransferScreen` ×1— y **no se tocan**: están preservados por
              ratificación, y reinterpretar navegación durmiente no es tarea de
              un cambio de destino. Por eso `case 'cuenta'` también sigue en pie.

              OJO con el rótulo de abajo: sigue gateado por el riel saldo (OLA 5C
              c) y esta orden no lo toca. Con el riel encendido diría "Saldo y
              tarjetas" apuntando a una pantalla que sólo tiene tarjetas. Hoy es
              inalcanzable —el riel falla cerrado y su reactivación exige orden
              nueva— pero queda dicho, no descubierto después. */}
          <button className="list-row" onClick={() => navigate('tarjetas')}>
            <span><Icon name="card" size={16} /></span>
            {/* OLA 5C (c): con el riel saldo apagado, "Saldo y tarjetas" nombraba
                algo que no existe en el build real. NO se oculta la fila: es el
                ÚNICO acceso a gestión de tarjetas, que es card-only ratificado.
                Se renombra. */}
            <div style={{ flex: 1, fontSize: 'var(--fs-legacy-sm)', fontWeight: 600 }}>
              {walletRailEnabled ? 'Saldo y tarjetas' : 'Mis tarjetas'}
            </div>
            <span style={{ color: 'var(--gray-b)' }}>→</span>
          </button>
          <button className="list-row" onClick={() => navigate('amigos')}>
            <span><Icon name="users" size={16} /></span>
            <div style={{ flex: 1, fontSize: 'var(--fs-legacy-sm)', fontWeight: 600 }}>Amigos</div>
            <span style={{ color: 'var(--gray-b)' }}>→</span>
          </button>
          <button className="list-row" onClick={() => navigate('grupos')}>
            <span><Icon name="users-group" size={16} /></span>
            <div style={{ flex: 1, fontSize: 'var(--fs-legacy-sm)', fontWeight: 600 }}>Grupos</div>
            <span style={{ color: 'var(--gray-b)' }}>→</span>
          </button>
        </div>
        {IS_MOCK && (
          <>
            <div className="note note-teal" style={{ marginBottom: 12 }}>
              <b>Modo demo:</b> los datos son de ejemplo y se guardan solo en este teléfono.
              Nada de lo que hagas acá mueve dinero de verdad.
            </div>
            <button
              className="btn btn-ghost"
              style={{ marginBottom: 12 }}
              onClick={() => {
                if (!window.confirm('¿Volver la demo a su estado inicial?')) return;
                resetDemo();
                window.location.reload();
              }}
            >
              <Icon name="refresh" size={16} className="ico-inline" /> Reiniciar la demo
            </button>
          </>
        )}
        <button
          className="btn btn-ghost"
          onClick={() => {
            void logout();
          }}
        >
          Cerrar sesión
        </button>
      </div>
      {/* §1.9 · paso 3 · la barra de cinco posiciones, montada por la pantalla.
          `mas` activa porque hoy esa posición apunta acá: la pantalla Más no
          existe todavía y Perfil ES la lista de opciones que va a vivir adentro
          (`AppBottomBar`, SPEC_APP.md §1.9).

          Va junto con sacar `perfil` de `showNav` en `App.tsx`, en el MISMO
          commit: montar la barra nueva sin sacar la vieja deja las dos
          conviviendo, superpuestas. */}
      <AppBottomBar active="mas" />
    </div>
  );
}
