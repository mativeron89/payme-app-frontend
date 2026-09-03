/**
 * services/moneyRail.js — GATE NO-MONEY GLOBAL (D-FF-2 · 2026-08-10)
 *
 * ─── QUÉ RATIFICÓ MATI ────────────────────────────────────────────────────
 *
 * `D-FF-2 = A`: la app abre a amigos con usuarios reales, **CERO PAGOS — ni
 * siquiera simulados**. Registro y social, nada más. Habilitado por `D-HOLD-1`
 * como "modo monetario fail-closed: disabled | sandbox". No hay decisión
 * pendiente acá: esto ejecuta lo ya decidido.
 *
 * ─── C5 · 2026-09-02 · EL MODO VUELVE A `disabled`, Y EL HARNESS SE SEPARA ──
 *
 * El corte del viernes es producción pública SIN PAGOS: el cierre de CEO del
 * 01/09 ata la mesa sin garantía a esta constante, y Mati cerró el momento con
 * `D-R19` = «Commit propio ya».
 *
 * 🔴 PERO EL FLIP A SECAS NO ERA VIABLE, y esto se midió antes de escribirlo.
 * Con la constante en `disabled` y un seam que sólo podía CERRAR, ninguna suite
 * podía volver a abrir el riel: 7 archivos y 158 tests en rojo, y —peor— la
 * corrida QUEDABA COLGADA. `tests/http.test.js` sincroniza contra un stub de
 * `stripeService.attachPaymentMethod`; con el dinero apagado la ruta corta en
 * 409 antes del handler, el stub no se llama nunca y el `await` no resuelve.
 * `npm run test:ci` no producía veredicto: ni verde ni lista de rojos.
 *
 * Codex adjudicó la salida A: la autoridad productiva es `disabled` y el
 * HARNESS puede abrir `sandbox`, sólo bajo `NODE_ENV==='test'` y nunca `live`.
 * Producción y pruebas dejan de compartir el mismo interruptor.
 *
 * ⚠️ LO QUE ESO CUESTA, dicho acá y no en una nota al pie: la suite integral
 * corre mayormente en `sandbox`, así que «integral verde» NO significa
 * «producción anda». Lo que acredita el modo productivo son los casos que
 * FUERZAN `disabled` y lo prueban contra la entrada real —rutas de dinero,
 * webhooks de Stripe, arranque y preflight—, no el verde general.
 *
 * ─── POR QUÉ ES UNA CONSTANTE Y NO UNA BANDERA DE ENTORNO ─────────────────
 *
 * 🔴 Una bandera es exactamente el permiso que el gobierno raíz prohíbe: con
 * `MONEY_ENABLED=true` en un `.env` cualquiera, un despliegue mal configurado
 * mueve dinero real de alguien. `MODO_MONETARIO` es una **constante del
 * código**, igual que `walletRail.RIEL_HABILITADO`: cambiarla exige un commit
 * revisado, no una variable. El frontend **la lee** de `/api/config`; no la
 * decide ni la hardcodea.
 *
 * ─── POR QUÉ NO ALCANZABA `walletRail` ────────────────────────────────────
 *
 * `RIEL_HABILITADO=false` apaga **wallet y nada más**: topup, transferencias y
 * SPEI. Bajo card-only el dinero se mueve por el riel de TARJETA, que ese gate
 * no toca — `POST /mesas` con garantía, `POST /mesas/:code/pay`, y el vault de
 * `/payment-methods` siguen operando. Este gate cubre TODO el dinero.
 *
 * ─── ALCANCE · enumerado desde las rutas MONTADAS, no de memoria ──────────
 *
 * Barrido de `app.use('/api/…')` en `server.js:133-151`. De los 19 montajes,
 * mueven o preparan dinero exactamente éstos:
 *
 *   · `/api/mesas`            garantía (hold) y pago de mesa
 *   · `/api/payment-methods`  SetupIntent y attach de tarjeta al vault
 *   · `/api/topup`            recarga (ya gateada por wallet, se refuerza)
 *   · `/api/transfers`        transferencia (ídem)
 *   · `/api/wallet`           CLABE de abono SPEI (ídem)
 *   · `/api/restaurants/:rid/connect/…`  onboarding de cuenta conectada
 *
 * NO mueven dinero y quedan intactos a propósito: `/api/auth`, `/api/config`,
 * `/api/legal`, `/api/account/consents`, `/api/account`, `/api/friends`,
 * `/api/groups`, `/api/invitations`, `/api/ocr`, `/api/restaurants` (lectura),
 * `/api/me` (earnings, sólo lectura), `/api/notifications`.
 *
 * Los webhooks de Stripe (`/webhooks/stripe`, `/webhooks/stripe/connect`)
 * **SÍ se gatean desde C5** (condición 3), en `routes/webhooks.js` como
 * `router.use` antes del parser y de la verificación de firma. Este párrafo
 * decía lo contrario —«son ENTRADA de hechos ya ocurridos; rechazarlos perdería
 * la reconciliación»— y ese cuidado sigue siendo válido: por eso la guarda
 * contesta 409 y NO 2xx. Un 2xx le diría a Stripe «lo manejé» y el evento se
 * descartaría; un 409 lo deja en su cola con reintentos. Se rechaza el
 * PROCESAMIENTO bajo el modo apagado, no el hecho.
 *
 * ─── FAIL-CLOSED ──────────────────────────────────────────────────────────
 *
 * `dineroHabilitado()` devuelve `true` ÚNICAMENTE si el modo VIGENTE es
 * exactamente `'live'` o `'sandbox'`. Cualquier otro valor —`disabled`, un
 * typo, `undefined`, o un modo futuro que nadie enseñó a esta función— responde
 * `false`. Si no se puede determinar el modo, no se mueve plata.
 *
 * ⚠️ Este párrafo decía «únicamente si el modo es exactamente `live`», y era
 * FALSO desde `D-FF-2-BIS`: el código habilita `live` **y** `sandbox` desde el
 * 2026-08-10. Se corrige acá porque el archivo ya se estaba tocando y porque
 * mentía sobre el fail-closed de un archivo que decide si se mueve plata. Es
 * corrección de comentario: cero conducta.
 */
'use strict';

const logger = require('../utils/logger');

/**
 * 🔴 ÚNICA FUENTE AUTORITATIVA. Constante, no bandera.
 *
 *   'disabled' — cero pagos, ni simulados. VIGENTE en producción (`C5`).
 *   'sandbox'  — pagos SIMULADOS con tarjetas de prueba. Rigió en producción
 *                entre el 2026-08-10 (`D-FF-2-BIS`) y el `C5`; desde `C5` es
 *                el modo del HARNESS y no sale de `NODE_ENV==='test'`.
 *   'live'     — dinero real. Requiere ratificación PROPIA de Mati. El harness
 *                no puede forzarlo mientras la constante no sea `live`: el
 *                seam admite sólo la constante y `MODO_HARNESS`, así que la
 *                exclusión de `live` deriva de la ratificación, no de un
 *                `!== 'live'` escrito aparte.
 *
 * ─── `D-FF-2-BIS` · historia, para no releerla como vigente ───────────────
 *
 * Entre el 2026-08-10 y el `C5` el modo productivo fue `sandbox`: los amigos
 * abrían mesa, confirmaban ítems, elegían tarjeta de garantía, repartían y
 * «pagaban», todo con tarjetas de prueba. Eso terminó en producción.
 *
 * ⚠️ Lo que aquel texto decía de la garantía sigue siendo cierto: el obstáculo
 * de la prueba cerrada NUNCA fue la garantía, y la mesa sin garantía de hoy no
 * la contradice — no es «sacarle la garantía a una mesa que cobra», es una mesa
 * que **no cobra nada**. Con el riel vivo, pedir `none` sigue devolviendo 409
 * `guarantee_required`.
 *
 * 🔴 EL ACOPLAMIENTO MODO↔CLAVE de `middleware/envValidation.js` estaba escrito
 * sobre `sandbox`, así que con `disabled` habría dejado de dispararse y una
 * `sk_live_…` ya no impediría el arranque. NO se lo dejó caer: la condición 4
 * de la adjudicación agrega la guarda simétrica —bajo `disabled`, el arranque
 * PRODUCTIVO falla cerrado si conserva credenciales live o un webhook secret
 * operativo—. Sigue viviendo allá y no acá, porque este archivo tiene prohibido
 * que el modo salga del entorno y aquel chequeo es la dirección contraria: el
 * entorno tiene que MERECER el modo.
 *
 * El wallet sigue MUERTO, y el apagado no lo toca: sigue 410 feature_removed,
 * NO 409. Son dos muertes distintas, y el orden de las guardas las mantiene
 * separadas (`routes/mesas.js:230` corre antes que `:253`).
 */
const MODO_MONETARIO = 'disabled';

const MODOS_CONOCIDOS = Object.freeze(['disabled', 'sandbox', 'live']);

/**
 * 🔴 EL ÚNICO MODO QUE EL HARNESS PUEDE ABRIR. No es `MODOS_CONOCIDOS` menos
 * `live`: es una constante propia, para que agregar un modo futuro a la lista
 * de conocidos NO lo vuelva forzable por un test sin que alguien lo escriba acá.
 */
const MODO_HARNESS = 'sandbox';

/**
 * ÚNICA lectura de entorno de este archivo, y existe para una sola cosa:
 * decidir si el harness tiene permiso. El MODO no sale nunca del entorno —esa
 * es la regla que el gobierno raíz protege— y ninguna variable puede moverlo.
 */
function enTest() {
  return process.env.NODE_ENV === 'test';
}

// ─── C5 · POR QUÉ PRODUCCIÓN Y PRUEBAS DEJAN DE COMPARTIR EL INTERRUPTOR ───
//
// Hasta C4 el seam sólo podía CERRAR: «nunca abre más de lo que la constante
// abre». Con la constante en `sandbox` eso alcanzaba, porque lo que había que
// ejercitar era el modo cerrado. Con la constante en `disabled` se dio vuelta y
// se midió el costo: 7 archivos y 158 tests en rojo, y `tests/http.test.js`
// COLGADO —un `await` sobre un stub que el 409 ya no deja llamar—, o sea una
// corrida sin veredicto. Y entre esos rojos estaban los CONTROLES con riel vivo
// de la mesa sin garantía: los que prueban que con dinero encendido la garantía
// ratificada el 2026-08-10 se conserva. Perderlos habría dejado la mesa sin
// garantía indistinguible de una relajación de la garantía.
//
// Salida adjudicada: el harness abre `sandbox`, y `live` queda excluido en
// términos absolutos. Las propiedades que sostienen que esto no mueva plata:
//
//   · fuera de `NODE_ENV==='test'` TODO intento lanza, incluido consultar;
//   · `live` no es forzable por ninguna vía, ni siquiera desde un test;
//   · el override es proceso-local y se restaura con la función que devuelve
//     `forzarModoParaTests`, así que un caso no contamina al siguiente;
//   · el modo productivo lo sigue diciendo la constante, no el entorno.
//
// 🔴 Por qué el override vive ACÁ y no en un stub del export: los consumidores
// destructuran en el `require` (`routes/mesas.js:34`, `routes/config.js:17`,
// `routes/payment-methods.js:15`, `routes/connect.js:25`, `routes/webhooks.js`,
// `middleware/envValidation.js:13`, `services/ffEnvironmentPreflight.js:27`),
// así que reemplazar `module.exports.dineroHabilitado` no alcanzaría a ninguno.
// Un módulo que lee su propio estado interno en cada llamada, sí.
//
// 🔴 EL DEFAULT DEL HARNESS ES UN OPT-IN EXPLÍCITO, NO UNA CONSECUENCIA DE
// `NODE_ENV`. Codex lo exigió al adjudicar: sin `habilitarHarnessSandboxParaTests()`
// —que sólo llama el preámbulo canónico `tests/setup.js`— el proceso corre en el
// modo productivo AUNQUE `NODE_ENV` valga `test`. Es el mismo idioma con el que
// el repo abre el alta sin invitación para las suites: nada se abre por estar
// en test; se abre porque alguien lo pidió por su nombre, en un lugar conocido.
// Un proceso de test que no cargue el preámbulo queda cerrado, no abierto.
let harnessSandboxHabilitado = false;
let modoForzadoEnTests = null;

/**
 * Opt-in del preámbulo canónico. Exige `NODE_ENV==='test'` y devuelve la
 * función que lo revierte, para que un test pueda acreditar la conducta SIN el
 * opt-in y dejar el proceso como estaba.
 */
function habilitarHarnessSandboxParaTests() {
  if (!enTest()) throw new Error('money_rail_harness_forbidden');
  const anterior = harnessSandboxHabilitado;
  harnessSandboxHabilitado = true;
  return () => { harnessSandboxHabilitado = anterior; };
}

function modoVigente() {
  if (modoForzadoEnTests !== null) return modoForzadoEnTests;
  return (enTest() && harnessSandboxHabilitado) ? MODO_HARNESS : MODO_MONETARIO;
}

/**
 * Fuerza el modo dentro de una prueba. Devuelve la función que restaura.
 *
 * Se usa para las DOS direcciones: cerrar (`disabled`, la conducta productiva
 * del corte) y dejar explícito el modo del harness (`sandbox`). `live` no.
 */
function forzarModoParaTests(modo) {
  if (!enTest()) throw new Error('money_rail_test_seam_forbidden');
  if (!MODOS_CONOCIDOS.includes(modo)) throw new Error('money_rail_test_seam_modo_invalido');
  if (modo !== MODO_MONETARIO && modo !== MODO_HARNESS) {
    // Se afirma por PERTENENCIA y no por `!== 'live'`: un modo nuevo en
    // `MODOS_CONOCIDOS` queda fuera hasta que alguien lo autorice acá.
    throw new Error('money_rail_test_seam_no_habilita');
  }
  const anterior = modoForzadoEnTests;
  modoForzadoEnTests = modo;
  return () => { modoForzadoEnTests = anterior; };
}

/**
 * Fail-closed: habilitan `live` y `sandbox`, y NADA MÁS.
 *
 * Un modo desconocido, un typo, `undefined` o un modo futuro que nadie enseñó a
 * esta función siguen dando `false`. La lista es explícita a propósito: un
 * `!== 'disabled'` habilitaría cualquier basura.
 *
 * ⚠️ Acá NO se comprueba la clave de Stripe. No es un olvido: repetir el
 * chequeo exigiría leer `process.env` en este archivo, que es justamente lo que
 * su guard textual prohíbe. El acoplamiento vive en `middleware/envValidation.js`
 * y desde C5 se evalúa sobre el modo EFECTIVO: si el que corre es `sandbox` —el
 * harness—, el proceso no arranca con una clave que no sea de prueba, así que
 * todo request que llega acá con dinero habilitado corre bajo clave verificada.
 * Si el que corre es `disabled`, esta función devuelve `false`, ninguna ruta ni
 * webhook opera, y además producción no arranca con claves live ni webhook
 * secrets (condición 4).
 */
function dineroHabilitado() {
  const modo = modoVigente();
  return modo === 'live' || modo === 'sandbox';
}

/**
 * Lo que publica `/api/config` para que el front LEA, no decida.
 *
 * 🔴 `payments_enabled` y `real_money` son DOS PREGUNTAS DISTINTAS, y bajo
 * `sandbox` sus respuestas se separan por primera vez:
 *
 *   payments_enabled  ¿puedo mostrar el flujo de cobro?        sandbox → SÍ
 *   real_money        ¿esto le saca plata a alguien?           sandbox → NO
 *
 * Sin las dos, el front tendría que deducir de `mode` —o peor, hardcodear una
 * lista de modos— para saber si avisarle a la persona que su tarjeta es de
 * prueba. Los dos booleanos son aditivos y explícitos: un consumidor que no
 * conozca un modo futuro ve `false` en ambos, que es el lado seguro.
 */
function modoMonetarioCapability() {
  const modo = modoVigente();
  return {
    mode: modo,
    payments_enabled: modo === 'sandbox' || modo === 'live',
    real_money: modo === 'live',
  };
}

/**
 * Middleware para rutas que mueven o preparan dinero.
 * 409 y no 403: no es un problema de permisos de la persona — la operación
 * completa está deshabilitada para todos.
 */
function requireDineroHabilitado(req, res, next) {
  if (dineroHabilitado()) return next();
  logger.warn('money_rail_disabled_reject', {
    path: req.originalUrl, method: req.method, mode: modoVigente(),
  });
  return res.status(409).json({
    error: 'payments_disabled',
    mode: modoVigente(),
    message: 'Los pagos están deshabilitados por la configuración vigente.',
  });
}

/**
 * Variante para gatear DENTRO de un handler que ya empezó (mismo patrón que
 * `walletRail.rechazaPorRielApagado`). Devuelve `true` si YA respondió.
 */
function rechazaPorDineroApagado(req, res, motivo) {
  if (dineroHabilitado()) return false;
  logger.warn('money_rail_disabled_reject', {
    path: req.originalUrl, method: req.method, mode: modoVigente(), motivo,
  });
  res.status(409).json({
    error: 'payments_disabled',
    mode: modoVigente(),
    ...(motivo && { field: motivo }),
    message: 'Los pagos están deshabilitados por la configuración vigente.',
  });
  return true;
}

module.exports = {
  MODO_MONETARIO,
  MODOS_CONOCIDOS,
  modoVigente,
  habilitarHarnessSandboxParaTests,
  forzarModoParaTests,
  dineroHabilitado,
  modoMonetarioCapability,
  requireDineroHabilitado,
  rechazaPorDineroApagado,
};
