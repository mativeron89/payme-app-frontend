import { IS_MOCK } from '../api';
import { resetDemo } from '../api/mock/store';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icon';
import { Avatar, TopBar } from '../components/ui';
import { navigate } from '../router';

/** s-profile: identidad + accesos + salir. */
export function PerfilScreen() {
  const { session, logout } = useAuth();
  const user = session?.user;

  return (
    <div className="screen has-nav">
      <TopBar title="Perfil" />
      <div className="scroll" style={{ padding: 16 }}>
        <div style={{ textAlign: 'center', padding: '6px 0 18px' }}>
          <Avatar name={user ? `${user.first_name} ${user.last_name}` : 'PayMe'} size={80} />
          <div className="h2" style={{ marginTop: 10 }}>
            {user ? `${user.first_name} ${user.last_name}` : 'Tu cuenta'}
          </div>
          {user && (
            <div style={{ marginTop: 6, fontFamily: 'monospace', fontSize: 'var(--fs-sm)', color: 'var(--gray-txt)' }}>
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
                <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600 }}>Email</div>
                <div className="caption">{user.email}</div>
              </div>
            </div>
          )}
          <button className="list-row" onClick={() => navigate('cuenta')}>
            <span><Icon name="card" size={16} /></span>
            <div style={{ flex: 1, fontSize: 'var(--fs-sm)', fontWeight: 600 }}>Saldo y tarjetas</div>
            <span style={{ color: 'var(--gray-b)' }}>→</span>
          </button>
          <button className="list-row" onClick={() => navigate('amigos')}>
            <span><Icon name="users" size={16} /></span>
            <div style={{ flex: 1, fontSize: 'var(--fs-sm)', fontWeight: 600 }}>Amigos</div>
            <span style={{ color: 'var(--gray-b)' }}>→</span>
          </button>
          <button className="list-row" onClick={() => navigate('grupos')}>
            <span><Icon name="users-group" size={16} /></span>
            <div style={{ flex: 1, fontSize: 'var(--fs-sm)', fontWeight: 600 }}>Grupos</div>
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
    </div>
  );
}
