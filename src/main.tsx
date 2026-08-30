import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PublicApp } from './public/PublicApp';
import { resolverRutaPublica, type RutaPublica } from './public/publicRoute';
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

/**
 * 🔴 APP-FE-META-PUBLIC-COMPLIANCE-01 · LA RUTA SE DECIDE ANTES DE QUE EXISTA
 * EL GRAFO PRIVADO, Y ESO ES LO QUE OBLIGA A LOS `import()` DE ABAJO.
 *
 * `/privacy` y `/facebook-data-deletion/<code>` las abre gente sin cuenta, y en
 * la segunda **el pathname lleva un `confirmation_code` de terceros**. Esas dos
 * rutas tienen prohibido leer o escribir sesión, cookies y `localStorage`.
 *
 * ⚠️ **Una versión anterior importaba `App` y los tres bootstraps de forma
 * ESTÁTICA, y era insuficiente aunque la rama pública no los ejecutara.** Los
 * `import` estáticos están izados: el grafo privado se EVALÚA igual antes de
 * que corra la primera línea de este archivo, y ese grafo llega hasta un
 * `localStorage.getItem()` de inicialización. O sea que abrir `/privacy` ya
 * tocaba storage, sin que ninguna línea de la rama pública lo pidiera. Lo
 * encontró la auditoría diferencial de Codex.
 *
 * Por eso arriba sólo entran React, los estilos y los módulos públicos —todos
 * sin sesión—, y `App`, `IdiomaProvider` y los tres bootstraps se cargan con
 * `import()` **dentro** de la rama privada. La rama pública no los baja, no los
 * evalúa y no los monta.
 *
 * Las dos funciones se declaran abajo y se llaman acá arriba: `function` se iza,
 * y así el orden del texto sigue siendo el que las guardas de recovery,
 * Facebook e invitación miden por posición.
 */
const rutaPublica = resolverRutaPublica(window.location.pathname);

if (!rutaPublica) {
  void arrancarPrivada();
} else {
  montarSuperficiePublica(rutaPublica);
}

/**
 * La app del comensal. Todo su grafo entra por `import()`, así que ninguna de
 * estas líneas se evalúa en una ruta pública.
 */
async function arrancarPrivada(): Promise<void> {
  const [recovery, facebook, invitacion, idioma, app] = await Promise.all([
    import('./api/recoveryFlow'),
    import('./api/facebookAuthFlow'),
    import('./api/signupInvitation'),
    import('./i18n/idioma'),
    import('./App'),
  ]);
  const { bootstrapRecoveryTokenCapture } = recovery;
  const { bootstrapFacebookCallbackCapture } = facebook;
  const { bootstrapSignupInvitationCustody } = invitacion;
  const { IdiomaProvider } = idioma;
  const App = app.default;

  // El recovery token se captura en memoria y se retira de query/fragmento
  // antes de que React pueda renderizar o iniciar cualquier request. Si el
  // navegador no acredita la limpieza física, este bootstrap aborta fail-closed.
  bootstrapRecoveryTokenCapture();
  bootstrapFacebookCallbackCapture();

  // D-FF-1: custodiar y retirar el raw ANTES del primer frame, incluso si ya hay
  // sesión y `LoginScreen` nunca se monta. El listener queda antes que el router.
  bootstrapSignupInvitationCustody();

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

  // El splash de `index.html` se retira recién cuando hay algo pintado debajo.
  // `render` ENCOLA el commit, no lo ejecuta: retirar en la línea siguiente
  // podría destapar un frame de blanco. El rAF corre después del primer paint.
  requestAnimationFrame(() => retirarSplash());
}

/**
 * Las dos superficies públicas de cumplimiento.
 *
 * 🔴 **SIN `StrictMode`, y es una decisión con motivo, no un olvido.** En
 * desarrollo `StrictMode` monta, desmonta y vuelve a montar, así que cada
 * efecto corre DOS veces: estas páginas harían dos requests por carga contra el
 * endpoint owner. La orden exige exactamente una request inicial por página, y
 * la alternativa —una frontera single-flight— sería un caché que hay que
 * garantizar que no sobreviva como dato viejo. La rama privada lo conserva: ahí
 * la doble invocación sigue siendo útil para cazar efectos impuros.
 */
function montarSuperficiePublica(ruta: RutaPublica): void {
  const el = document.getElementById('root');
  if (!el) throw new Error('No existe #root');

  createRoot(el).render(<PublicApp ruta={ruta} />);

  // La pública también nace debajo del splash y lo retira igual.
  requestAnimationFrame(() => retirarSplash());
}
