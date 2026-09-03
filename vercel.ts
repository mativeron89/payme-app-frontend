/**
 * Configuración de Vercel para los DOS proyectos que leen este repo,
 * `payme-app` y `payme-landing`.
 *
 * ══════════════════════════════════════════════════════════════════════
 * 🔴 EL CANDADO VA PRIMERO Y SIN CONDICIÓN, Y ESO CORRIGE UN FAIL-OPEN.
 * ══════════════════════════════════════════════════════════════════════
 *
 * La versión anterior (`vercel.mjs`) hacía `throw` cuando
 * `PAYME_VERCEL_ARTIFACT` no era exactamente `app` o `landing`, **antes** de
 * exportar nada. Para el aislamiento de rutas eso fallaba cerrado y estaba
 * bien. Para el candado fallaba **abierto**, y es lo que se corrige acá:
 *
 *   sin config emitida  ⇒  rutas Meta no nacen        → 404 visible, seguro
 *   sin config emitida  ⇒  `deploymentEnabled` no llega → `main` DESPLIEGA SOLO
 *
 * Las dos cosas compartían un gate y tienen direcciones de fallo opuestas. Un
 * binding ausente en el panel de Vercel —algo que este repo no puede
 * observar— alcanzaba para quedarse sin candado en silencio.
 *
 * **El aislamiento no necesitaba el `throw`.** Un artefacto desconocido con
 * listas VACÍAS da exactamente lo mismo que `landing`: ninguna ruta nace. Y
 * contra el único caso que de verdad filtra —`landing` bindeado en el proyecto
 * App, un valor válido pero equivocado— el `throw` nunca protegió. Vaciar en
 * vez de lanzar conserva la garantía y mantiene el candado vivo.
 *
 * ⚠️ **Qué NO acredita este archivo.** Que Vercel lo lea, que el Root
 * Directory de cada proyecto sea la raíz y que `PAYME_VERCEL_ARTIFACT` esté
 * bindeada en ambos son hechos del proveedor, verificables sólo en su panel.
 * Ver `docs/DESPLIEGUE_GATEADO.md` y las deudas externas de
 * `docs/HARDENING_LANDING_LOCAL.md`.
 *
 * 📌 **Sin anotaciones de tipo a propósito.** El archivo es TypeScript válido
 * y **también** ESM plano, así que evalúa igual lo compile Vercel o no. Los
 * tests lo ejercitan con `node` crudo sobre sus bytes exactos: si alguien
 * introduce sintaxis sólo-TS, esa evaluación se cae y el gate lo dice.
 */
const artifact = process.env.PAYME_VERCEL_ARTIFACT;

/** Sólo el proyecto App publica las dos superficies públicas Meta. */
const esApp = artifact === 'app';

const paths = ['/privacy', '/facebook-data-deletion/:code'];
const headers = [
  { key: 'Cache-Control', value: 'no-store' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
];

export const config = {
  // 🔴 PRIMERA PROPIEDAD Y FUERA DE TODA CONDICIÓN. No depende del artefacto,
  // del entorno ni de nada que el panel de Vercel pueda no tener puesto.
  git: { deploymentEnabled: { main: false } },
  rewrites: esApp
    ? paths.map((source) => ({ source, destination: '/index.html' }))
    : [],
  headers: esApp
    ? paths.map((source) => ({ source, headers }))
    : [],
};
