import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { IdiomaProvider } from './i18n/idioma';
import { bootstrapSignupInvitationCustody } from './api/signupInvitation';
import { retirarSplash } from './splash';
import './styles/global.css';

/**
 * 🔴 SENTINELA DEL ÁRBOL SERVIDO (P2-02). Lo inyecta `vite.config.ts`. Existe
 * para que una corrida de e2e pueda AFIRMAR contra qué código corrió, en vez
 * de suponerlo: si alguien reactiva la reutilización de servidores, un
 * servidor de otro árbol se delata acá en vez de pasar en verde.
 * No es dato de producto ni sale a ninguna red: es un string en `window`.
 */
declare const __ARBOL_SERVIDO__: string;
(window as unknown as { __ARBOL_SERVIDO__?: string }).__ARBOL_SERVIDO__ =
  typeof __ARBOL_SERVIDO__ === 'string' ? __ARBOL_SERVIDO__ : 'desconocido';

const el = document.getElementById('root');
if (!el) throw new Error('No existe #root');

// D-FF-1: custodiar y retirar el raw ANTES del primer frame, incluso si ya hay
// sesión y `LoginScreen` nunca se monta. El listener queda antes que el router.
bootstrapSignupInvitationCustody();

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

// El splash de `index.html` se retira recién cuando hay algo pintado debajo.
// `render` ENCOLA el commit, no lo ejecuta: retirar en la línea siguiente
// podría destapar un frame de blanco. El rAF corre después del primer paint.
requestAnimationFrame(() => retirarSplash());
