import { createRoot } from 'react-dom/client';
import { MesaScreen } from '../../src/screens/MesaScreen';
import { AuthProvider } from '../../src/auth/AuthContext';
import { IdiomaProvider } from '../../src/i18n/idioma';
import { RegionProvider } from '../../src/preferences/RegionProvider';
import { ToastProvider } from '../../src/components/ui';
import { api } from '../../src/api';
import { saveSession } from '../../src/api/storage';
import { ejemploLocal } from '../../src/ayuda/ejemplo/estadoEjemplo';
import { CODIGO_EJEMPLO } from '../../src/ayuda/ejemplo/fixtureEjemplo';
import { CODIGO, detalle, type Escenario } from './detalle-visibilidad';

// Sólo esta página de prueba monta la prop durmiente. Playwright simula todo el HTTP.
export async function montar(e: Escenario) {
  if (location.hostname !== '127.0.0.1' || location.pathname !== '/e2e/fixtures/mesa-visibilidad.html') {
    throw new Error('La fixture requiere su página local de prueba');
  }
  saveSession({ principal_id: 'persona-ficticia', family_id: 'familia-ficticia', access_token: 'a', refresh_token: 'r' });
  await api.getConfig();
  if (e.ejemplo) {
    ejemploLocal.empezar();
    // El tutorial real no tiene foto. Entregarle el mismo detalle con foto a esta
    // pantalla permite comprobar su propia guarda aunque cambie el ejemplo.
    api.getMesa = async () => ({ mesa: detalle(e) });
  }
  createRoot(document.getElementById('mesa')!).render(
    <IdiomaProvider><RegionProvider><AuthProvider><ToastProvider>
      <MesaScreen code={e.ejemplo ? CODIGO_EJEMPLO : CODIGO} guestToken={e.invitado ? 'g' : undefined} />
    </ToastProvider></AuthProvider></RegionProvider></IdiomaProvider>,
  );
}
