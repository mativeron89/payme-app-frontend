import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { IdiomaProvider } from './i18n/idioma';
import './styles/global.css';

const el = document.getElementById('root');
if (!el) throw new Error('No existe #root');

/**
 * 🔴 `IdiomaProvider` envuelve TODO, y va acá y no dentro de `App`.
 *
 * `useIdioma()` cae al español si no encuentra proveedor —a propósito: el
 * idioma no es dato crítico y un componente que se cae por su traducción es
 * peor que uno en el idioma equivocado—. **El costo de esa decisión es que
 * olvidarse el proveedor NO rompe nada: la app se ve entera en español y nadie
 * se entera.** Por eso `traduccion.test.ts` verifica que esta línea exista.
 */
createRoot(el).render(
  <StrictMode>
    <IdiomaProvider>
      <App />
    </IdiomaProvider>
  </StrictMode>,
);
