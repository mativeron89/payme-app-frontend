import { IS_MOCK } from '../api';
import { resetDemo } from '../api/mock/store';
import { useAuth } from '../auth/AuthContext';
import { Avatar, TopBar } from '../components/ui';
import { navigate } from '../router';

/** s-profile: identidad + accesos + salir. */
export function PerfilScreen() {
  const { session, logout } = useAuth();
  const user = session?.user;

  return (
    <div className="screen">
      <TopBar title="Perfil" onBack={() => navigate('home')} />
      <div className="scroll" style={{ padding: 16 }}>
        <div style={{ textAlign: 'center', padding: '6px 0 18px' }}>
          <Avatar name={user ? `${user.first_name} ${user.last_name}` : 'PayMe'} size={80} />
          <div className="h2" style={{ marginTop: 10 }}>
            {user ? `${user.first_name} ${user.last_name}` : 'Tu cuenta'}
          </div>
          {user && (
            <div style={{ marginTop: 6, fontFamily: 'monospace', fontSize: 12, color: 'var(--gray-d)' }}>
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
              <span>📧</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Email</div>
                <div style={{ fontSize: 12, color: 'var(--gray-d)', fontFamily: 'var(--font-body)' }}>{user.email}</div>
              </div>
            </div>
          )}
          <button className="list-row" onClick={() => navigate('cuenta')}>
            <span>💳</span>
            <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>Saldo y tarjetas</div>
            <span style={{ color: 'var(--gray-b)' }}>→</span>
          </button>
          <button className="list-row" onClick={() => navigate('amigos')}>
            <span>👥</span>
            <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>Amigos</div>
            <span style={{ color: 'var(--gray-b)' }}>→</span>
          </button>
          <button className="list-row" onClick={() => navigate('grupos')}>
            <span>👨‍👩‍👧</span>
            <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>Grupos</div>
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
              🔄 Reiniciar la demo
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
    </div>
  );
}
