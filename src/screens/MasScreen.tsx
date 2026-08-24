import { IS_MOCK } from '../api';
import { SelectorIdioma } from '../components/SelectorIdioma';
import { useIdioma } from '../i18n/idioma';
import { resetDemo } from '../api/mock/store';
import { useAuth } from '../auth/AuthContext';
import { AppBottomBar } from '../components/AppBottomBar';
import { AppHeaderBack } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { Avatar } from '../components/ui';
import { goBack, navigate } from '../router';
import { useWalletRail } from '../api/walletRail';

/**
 * **`Configuración`** — la quinta posición de la barra.
 *
 * §1.9, resuelto por Diseño el 2026-08-05: **`Más` ES Perfil, no la contiene.**
 * Se evaluó que fuera un menú con una fila "Perfil" y se descartó — *un menú de
 * una sola fila útil agrega fricción sin agregar nada* — y **"configuración" no
 * entra**: cero spec, cero pantalla, cero contrato detrás. Una fila que no lleva
 * a ningún lado es el tratamiento que el spec ya le negó al QR de Compartir y a
 * Cuentas Asociadas.
 *
 * La identidad y la foto son deliberadamente de solo lectura: el contrato
 * vigente no permite editar nombre ni subir avatar. No se dibujan controles
 * que prometan mutaciones inexistentes.
 */
export function MasScreen() {
  const { t } = useIdioma();
  const { session, logout } = useAuth();
  // OLA 5D · el rótulo de la fila lo decide el BACKEND, no este repo.
  const { walletRailEnabled } = useWalletRail();
  const user = session?.user;

  return (
    <div className="screen has-appbar">
      <AppHeaderBack paymeId={user?.payme_id} onBack={() => goBack('home')} />
      <div className="title-card">
        <h1 className="title-card-title">{t('Configuración')}</h1>
      </div>
      {/* Longhands y no `padding: 16`: el shorthand inline PISA el
          `padding-bottom: 140px` de `.has-appbar .scroll`, y la última fila
          —"Cerrar sesión"— queda debajo de la barra. Está advertido en el CSS y
          es exactamente el modo en que se cuela. */}
      <div className="scroll" style={{ paddingTop: 16, paddingLeft: 16, paddingRight: 16 }}>
        <div style={{ textAlign: 'center', padding: '6px 0 18px' }}>
          <Avatar name={user ? t('{0} {1}', user.first_name, user.last_name) : t('PayMe')} size={80} />
          <div className="h2" style={{ marginTop: 10 }}>
            {user ? t('{0} {1}', user.first_name, user.last_name) : t('Tu cuenta')}
          </div>
          {user && (
            <div style={{ marginTop: 6, fontFamily: 'monospace', fontSize: 'var(--fs-legacy-sm)', color: 'var(--gray-txt)' }}>
              {user.payme_id}
            </div>
          )}
          <div className="caption" style={{ marginTop: 8 }}>
            {t('La identidad y la foto se muestran tal como están registradas en tu cuenta.')}
          </div>
        </div>
        {!user && (
          <div className="note note-orange" style={{ marginBottom: 12 }}>
            {t('Tus datos van a aparecer aquí en cuanto termines de crear tu cuenta.')}
          </div>
        )}
        <div className="card" style={{ marginBottom: 12 }}>
          {user && (
            <div className="list-row" style={{ cursor: 'default' }}>
              <span><Icon name="mail" size={16} /></span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 'var(--fs-legacy-sm)', fontWeight: 600 }}>{t('Email')}</div>
                <div className="caption">{user.email}</div>
              </div>
            </div>
          )}
          {/* §1.9 · paso 2 · va a `#/tarjetas`, la pantalla de PRIMER NIVEL que
              §1.11 estrenó, y no a la Cuenta vieja que §1.9 retira.

              Esta fila era el ÚNICO camino VIVO a `cuenta`. Los otros **DIEZ**
              son código durmiente del riel saldo y **no se tocan**: están
              preservados por ratificación, y reinterpretar navegación durmiente
              no es tarea de un cambio de destino. Por eso `case 'cuenta'`
              también sigue en pie.

              🔴 **Diez, no ocho.** Son ocho `navigate('cuenta')` —`HomeScreen`
              ×2 adentro de bloques `walletRailEnabled`, `TopupScreen` ×5,
              `TransferScreen` ×1— **más dos `goBack('cuenta')`**
              (`TopupScreen:237`, `TransferScreen:126`), que caen en la misma
              ruta porque `goBack` **llama a `navigate(fallback)`** cuando no hay
              historial propio (`router.ts:150`) — el caso de quien entra en frío
              a esa URL. Un `grep` de `navigate('cuenta')` no los ve, así que el
              conteo viejo no sólo erraba el número: **mandaba a buscar mal.**

              OJO con el rótulo de abajo: sigue gateado por el riel saldo (OLA 5C
              c) y esta orden no lo toca. Con el riel encendido diría "Saldo y
              tarjetas" apuntando a una pantalla que sólo tiene tarjetas. Hoy es
              inalcanzable —el riel falla cerrado y su reactivación exige orden
              nueva— pero queda dicho, no descubierto después. */}
          {/* IDIOMA · pedido de Mati el 2026-08-10: *«necesita el mismo toggle
              en "Más"»*. Configuración conserva ese mismo control local.

              🔴 El segmentado va donde las otras filas ponen la flecha `→`, y es
              MÁS ANCHO que ella. En el panel, un control así en una fila llena
              montó la píldora sobre el nombre — y la revisión de desbordes de
              TEXTO lo dio por bueno, porque no era texto que crecía sino un
              elemento nuevo. Acá se verificó con CAPTURA a 375 px, en los dos
              idiomas.

              Ícono `settings` y no `globe`: `globe` no existe en `Icon.tsx`, y
              inventarlo era trabajo de diseño que nadie pidió. */}
          <div className="list-row" style={{ cursor: 'default' }}>
            <span><Icon name="settings" size={16} /></span>
            <div style={{ flex: 1, fontSize: 'var(--fs-legacy-sm)', fontWeight: 600 }}>
              {t('Idioma')}
            </div>
            <SelectorIdioma />
          </div>
          <button className="list-row" onClick={() => navigate('tarjetas')}>
            <span><Icon name="card" size={16} /></span>
            {/* OLA 5C (c): con el riel saldo apagado, "Saldo y tarjetas" nombraba
                algo que no existe en el build real. NO se oculta la fila: es el
                ÚNICO acceso a gestión de tarjetas, que es card-only ratificado.
                Se renombra. */}
            <div style={{ flex: 1, fontSize: 'var(--fs-legacy-sm)', fontWeight: 600 }}>
              {walletRailEnabled ? 'Saldo y tarjetas' : t('Mis tarjetas')}
            </div>
            <span style={{ color: 'var(--gray-b)' }}>→</span>
          </button>
          {/* §1.9 · **Amigos y Grupos salieron de acá.** No es recorte: las dos
              son POSICIONES de la barra inferior desde §1.9 · paso 3 —Grupos
              como pestaña dentro de Amigos—, así que estas filas eran un segundo
              camino al mismo lugar. Un acceso duplicado no es redundancia
              inofensiva: es una navegación que hay que mantener coherente en dos
              lados y que se desincroniza sola.

              "Mis tarjetas" se queda porque NO es eso: es el único acceso a la
              gestión de tarjetas, superficie card-only ratificada, y la barra no
              tiene posición para ella. */}
        </div>
        {IS_MOCK && (
          <>
            <div className="note note-teal" style={{ marginBottom: 12 }}>
              <b>{t('Modo demo:')}</b> {t('los datos son de ejemplo y se guardan solo en este teléfono. Nada de lo que hagas aquí mueve dinero de verdad.')}
            </div>
            <button
              className="btn btn-ghost"
              style={{ marginBottom: 12 }}
              onClick={() => {
                if (!window.confirm(t('¿Volver la demo a su estado inicial?'))) return;
                resetDemo();
                window.location.reload();
              }}
            >
              <Icon name="refresh" size={16} className="ico-inline" /> {t('Reiniciar la demo')}
            </button>
          </>
        )}
        <button
          className="btn btn-ghost"
          onClick={() => {
            void logout();
          }}
        >
          {t('Cerrar sesión')}
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
