# CHANGELOG — payme-app-frontend

## 0.36.0 — ORDEN VISUAL · Ticket (2026-08-05)

- **`SPEC_APP.md` §1.3 · Ticket.** El pendiente que 0.35.0 dejó elevado —si el
  celeste de la tarjeta de título era el estándar o una excepción de División—
  **ya estaba resuelto en el spec** cuando se escribió esa entrada: el archivo
  se editó a las 20:28, diez minutos después del commit de División, y dice que
  `--teal-l` es el estándar de toda tarjeta de título y que *"Ticket se corrige
  para pasar a `--teal-l`"*. La entrada anterior quedó vencida, no equivocada.
  - Cabecera de flujo y tarjeta de título `--teal-l`. Acá la tarjeta **sí lleva
    contenido debajo del título** —total y observación— separado por la misma
    línea que separa la lista. Es una sola tarjeta.
  - **La lista deja de ser una grilla de inputs**: cantidad · nombre · precio
    tabular, texto limpio, sin un recuadro a la vista. Los controles aparecen
    recién en modo edición. Se va el copy con el conteo de consumos.
  - **"Modificar ítems" en dos estados**, con lápiz por fila y Eliminar en
    `--danger`. La fila expandida edita nombre, precio y cantidad, no sólo el
    monto como dice el spec: un consumo agregado nace vacío y sin nombre no se
    completa nunca. **Desvío consultado con Mati.**
  - **El chequeo del total dejó de ser vacuo.** El spec pide avisar cuando la
    suma de las filas no coincide con el total del ticket, pero el total en
    pantalla **era** la suma —`runScan` descartaba `total_cents`—, así que no
    podía discrepar de sí mismo. Ahora se conserva el total impreso y se
    contrasta. **No viaja al backend**: lo que se manda sigue siendo la suma de
    lo que la persona vio y editó, porque la garantía retiene ese monto.
  - Barra de cinco posiciones con "Continuar", sin ítem activo, y el motivo de
    invalidez en su fila propia en vez de flotando a `bottom: 78px`.
  - Área táctil del stepper de 22×22 a 44×44: estaba en la mitad del mínimo.
- **Tres defectos que aparecieron al verificar y no eran de esta pantalla:**
  - `.has-appbar .scroll` **no tenía efecto** — un `style={{ padding }}` inline
    le ganaba al `padding-bottom` de la clase y la separación con la barra era
    cero. **División arrastraba lo mismo** y no se veía porque su contenido es
    corto. Las dos pasan a `.flow-scroll`, en longhands.
  - `scrollIntoView` daba por visible una fila tapada por la barra fija:
    corregido con `scroll-margin-bottom`.
  - `.tk-name.empty` chocaba con `.empty`, el estado vacío global, y heredaba
    sus `padding: 36px 24px` — 121px de fila en vez de 53. Renombrada.
- **Contraste nuevo medido**: `--warning` sobre `--teal-l` da **4.77:1** — pasa
  AA, pero con menos margen que el par que el sistema tenía medido (5.10 sobre
  `--warning-tint`). Fijado en `designTokens.test.ts` y comprobado por mutación.
- **No se implementa "ítem no reconocido"**: el spec lo deja pendiente de ver en
  pantalla y `OcrResponse` no trae ningún campo por ítem del que pudiera salir.
- Verificado a 375px en mock. La discrepancia de totales **no es alcanzable en
  mock por sí sola** —el adaptador calcula `total_cents` con un reduce sobre los
  mismos ítems—, así que se forzó editando un precio, en las dos direcciones, y
  se restauró comprobando el regreso al estado informativo.
- Deuda, medida con `git grep -o` sobre `src/` (el método que reconcilia con las
  entradas anteriores): bloques `style={{…}}` 368 → **347** · `--fs-legacy-*`
  99 → **86**. Ojo con el segundo: la entrada de 0.35.0 cerró en 111, y la caída
  de 111 a 99 es del commit `cf235df` de la ORDEN 4B, no de acá.

## 0.35.0 — ORDEN VISUAL · División (2026-08-05)

- **`SPEC_APP.md` §1.4 · División**, la primera pantalla del flujo de armar
  mesa que adopta el sistema.
  - **Cabecera de flujo, la tercera variante** (§1.3): dos filas en la banda
    navy — logo + `payme_id`, y debajo "Volver" con el contador de paso. Entra
    como `AppHeaderFlow` en el componente compartido porque §1.3–§1.6 la usan
    todas, no como markup suelto de esta pantalla.
  - Tarjeta de título `--teal-l` montada sobre la banda.
  - **La selección deja el naranja y pasa a teal**: dentro de una tarjeta el
    naranja ya no marca estado. Y no es sólo el borde — el radio se llena.
  - **El importe por persona sube a `--fs-h1` y se recalcula en vivo** con el
    stepper, anunciado con `aria-live`. Antes era una píldora de 13px al
    costado: es el dato que la persona está buscando y estaba en letra chica.
  - Barra de cinco posiciones con "Continuar" en el centro, sin ítem activo.
    Deja salir del flujo a mitad de camino, a propósito; verificado que en este
    paso no hay nada congelado todavía, así que irse no deja ninguna operación
    monetaria a medias.
  - Área táctil del stepper a 44×44 y el subtexto de las tarjetas de 12px a
    `--fs-sm` — era información por debajo del mínimo del sistema.
- **Ticket sigue sin tocarse**: §1.4 tiene un pendiente explícito —si el
  celeste de la tarjeta de título es el estándar o es específico de División—
  que termina en *"No tocar Ticket hasta confirmar"*. Elevado, sin respuesta
  todavía.
- **Inicio (§1.1) sigue frenado** por la pregunta abierta de §5: dónde va la
  invitación pendiente. El esqueleto nuevo no tiene lugar donde el banner de
  hoy entre sin romper el enganche entre la pestaña activa y la tarjeta, así
  que preservarlo obligaría a elegir por la puerta de atrás. Queda para la
  decisión de Mati.
- Deuda: `--fs-legacy-*` 112 → 111 · bloques `style={{…}}` 370 → 368.

## 0.34.0 — ORDEN VISUAL · entrada por link y Avisos (2026-08-05)

Paso 3 de la orden visual: las primeras pantallas que adoptan el sistema. Los
tokens y el esqueleto ya estaban (0.33.0); acá empiezan a usarse.

- **`SPEC_APP.md` §1.2 · entrada por link, las tres pantallas.** Es la primera
  que ve casi todo el mundo que llega por un link de WhatsApp, y la de mayor
  riesgo del spec. Esqueleto propio: banda compacta, burbuja angosta flotando
  en el medio exacto, bloque de acción abajo, sin barra inferior.
  - **401** con burbuja genérica *"Te invitaron a una mesa"*: no nombra el
    restaurante, porque para saber que el token es válido habría que
    preguntárselo al backend y el endpoint que lo diría sin sesión es el
    preview público que el cierre del pago sin cuenta prohíbe. Un link
    reenviado, además, le confirmaría a cualquiera dónde está comiendo otro.
    *"Crear cuenta gratis"* es el **cuarto uso permitido del naranja**, con el
    texto en navy (5.77:1).
  - **403** con un solo cartel para los cuatro motivos y salida por el círculo
    naranja. Copy textual del spec.
  - **"Sumate a la mesa"**, nueva: antes el canje navegaba derecho a la mesa.
    Tilde de 72px en `--success`, el nombre del restaurante sin el código, y un
    solo destino a un toque. Es el único momento con permiso de nombrar la
    mesa: el canje ya cerró y quien mira es un participante inscripto.
  - **La custodia del token no cambió.** Se sigue comprobando el round-trip
    antes de soltar la URL y la credencial se libera en el mismo punto que
    antes. Verificado en el navegador: tras el canje el hash queda sin `?t=`,
    el `sessionStorage` vacío, y Atrás no revive el token.
- **`SPEC_APP.md` §1.8 · Avisos.** El punto de "sin leer" pasa a `--action-2` y
  a la izquierda, acompañado del peso 700 — dos señales, no una. El leído deja
  de atenuarse con `opacity` sobre la fila entera, que arrastraba el texto por
  debajo del mínimo de contraste. Vacío real con la copy del spec y sin borde.
  Cabecera de subpantalla y barra de cinco posiciones sin ítem activo.
- **Contraste corregido de paso** (§3 lo habilita en cualquier pantalla, no es
  rediseño): el botón de aceptar invitación era naranja con texto blanco —
  2.84:1 y un uso del naranja fuera de los cuatro permitidos.
- **Tests**: `joinLinkStage` extrae a función pura qué pantalla se muestra, y
  fija la regla de privacidad —sin sesión no se ve **nada** de la mesa,
  cualquiera sea el resultado del canje— y que ninguna pantalla quede sin
  salida. `designTokens.test.ts` fija el cuarto uso del naranja contra el modo
  en que se rompería en silencio: un `color: #fff` "para que se vea más".
  381 tests (eran 370).
- **Deuda**: los usos de `--fs-legacy-*` bajan de 113 a 112 y los bloques
  `style={{…}}` de 378 a 370. Baja pantalla por pantalla, como manda el
  sistema.

## 0.33.0 — ORDEN VISUAL · tokens y esqueleto del sistema de diseño (2026-08-05)

Pasos 1 y 2 de la orden visual. **Ninguna pantalla cambió todavía**: entra el
vocabulario y entra el esqueleto, y las pantallas los adoptan de a una.

- **Los tokens de `SISTEMA_DISENO.md` §1–§3 viven en `global.css`**: color
  (marca, acción, superficie, texto, semánticos con su tinte propio), la escala
  tipográfica de seis tamaños con line-heights, la mono, espaciado base 4, tres
  radios, tres elevaciones y el área táctil mínima.
- **Hubo que liberar el namespace antes.** La escala del sistema reusa
  `--fs-sm` y `--fs-xs` con **otros** valores (12.5→14 y 11.5→12). Definirla sin
  más habría movido 44 usos de tamaño en silencio, que es justo lo que el paso 1
  prohíbe. La escala vieja pasó a `--fs-legacy-*` en un rename mecánico: mismo
  valor, otro nombre, cero pixel movido. Quedan **100 usos** de deuda contada.
- **`designTokens.test.ts` re-mide los contrastes**, que es lo que el sistema
  exige cada vez que se toca un hex — aritmética WCAG pura sobre el CSS leído
  como texto, sin jsdom ni librería de render. Fija también las prohibiciones:
  blanco sobre `--brand` (2.84), `--brand` como texto (2.6) y el teal como texto
  (2.19) siguen reprobando, que es por qué existen `--brand-fg`, `--brand-ink`
  y `--link`.
- **Discrepancia encontrada al automatizar la medición:** `--text` sobre `--bg`
  da **15.21:1**, no 15.4 como declara `SISTEMA_DISENO.md` en dos lugares.
  Tampoco corresponde a las otras dos superficies (16.36 y 15.64), así que no es
  un fondo confundido. Sin consecuencia de accesibilidad —el mínimo AA es 4.5—
  pero el documento dice que todo ratio está medido. Se fija el valor real; el
  documento es de la conversación de Diseño y no se edita desde este repo.
- **Los tres componentes de estructura de §5 bis**, sin call sites: cabecera
  navy de borde curvo (primer nivel, subpantalla y la compacta de la entrada por
  link), pestañas en burbuja fusionadas a la tarjeta, y la barra inferior de
  cinco posiciones con centro configurable — `+` Nueva, `→` Continuar o cámara
  y "Capturar" según la pantalla, porque lo fijo es el componente y su posición,
  no el texto.
- `test.css` habilitado en `vite.config.ts`: vitest reemplaza todo módulo CSS
  por un stub vacío por default y el import `?raw` llegaba como `""`. Se usó
  `?raw` y no `node:fs` para no incorporar `@types/node` — dependencia nueva,
  prohibida sin OK previo de Mati.

## 0.32.0 — ORDEN 3A · custodia del token, rutas del riel y espejo (2026-08-04)

- **El espejo estaba mal contado, y el número era lo de menos.** El comando de
  enumeración usaba `grep -v README.md` **sin anclar**, así que descartaba en
  silencio `legal/README.md` — un archivo espejado con fuente real que **nunca
  se verificó**. Inventario correcto: **70 archivos**. Ahora lo fija un test.
- **Back revivía el token de invitación.** `navigate` asigna el hash y crea una
  entrada, dejando viva la anterior con el `?t=`. Se retira con `replaceState`,
  preservando el resto de los parámetros (`r` del QR).
- **Orden de custodia:** guardar → comprobar round-trip → recién ahí soltar la
  URL. Si el round-trip falla, la URL no se toca: preferimos un token visible a
  un token perdido.
- **Un shape inválido devolvía `null` y dejaba la fila.** Ahora toda salida sin
  dato borra la credencial físicamente.
- **El 400 dejó de ser "problema de conexión".** Es terminal, con copy
  accionable, y no invita a reintentos engañosos.
- **`#/cargar` y `#/transferir` ya no muestran copy:** redirigen a superficie
  neutra sin dejar entrada en el historial, en los cuatro estados apagados de la
  capability y en real y mock.
- **Tres afirmaciones vencidas corregidas**, una mía y grave: leer la capability
  **no** apagaba el riel — publicar hace autoritativa la declaración, no la
  ejecución. El gate de dinero lo puso el backend en v2.33.0.

## 0.31.0 — Cierre del pago sin cuenta, espejado (2026-08-04)

Espejo del backend v2.32.0. El token de `?t=` deja de ser **autorización** y
pasa a ser **credencial**.

- **El link ya no lleva a la mesa: lleva al canje.** `App` montaba `MesaScreen`
  en modo invitado con el token de la URL, y con eso se veía la mesa, se tomaban
  ítems y se **pagaba sin cuenta**. Ahora lleva a `JoinMesaScreen`.
- **Quien no tiene cuenta no ve nada de la mesa** — ni restaurante, ni total, ni
  cuánta gente hay. Ve el alta, con un banner que explica por qué.
- **El token sobrevive al alta.** Se guarda en `sessionStorage` con el código de
  su mesa; la URL sigue siendo la fuente primaria y esto cubre el tramo del
  registro. Perderlo dejaría a la persona registrada y **afuera** de la mesa a
  la que la invitaron, que es peor que el defecto que se cierra.
- **Se suelta al canjear y también ante un 403** — un token muerto que
  sobreviviera capturaría esa mesa en cada visita.
- **Un solo mensaje para los cuatro motivos de rechazo.** El emisor no
  distingue inválido de vencido de cancelado de supersedido, a propósito: sería
  decirle a un desconocido si una mesa existe. Un test barre todos los mensajes
  contra un conjunto de palabras delatoras.
- **El 503 no es un rechazo.** Es "no pudimos verificar", y es reintentable.
  Fundirlo con el 403 diría que una invitación está muerta cuando el backend
  sólo está a media configuración.
- **Nada se borra:** `httpGuestRequest`, los parámetros `guestToken` de la
  fachada y las ramas `isGuest` de `MesaScreen` quedan durmientes e intactos,
  igual que `guestOrAuth` del otro lado.
- El mock replica la **ceguera** del emisor y modela los tokens emitidos, así
  que el 403 es verificable a mano y no acepta cualquier string.
- `contract-mirror` refrescado a v2.32.0 (68 archivos; `utils/tokens.js` nuevo).

## 0.30.1 — Barrido adversarial sobre 0.30.0 (2026-08-04)

- **El caso de control estaba roto y lo rompí yo en 0.30.0.** `HomeScreen` y
  `CuentaScreen` pedían saldo y movimientos dentro de un `useEffect(..., [])`.
  Eso servía cuando el riel era una constante; ahora la capability llega
  DESPUÉS del primer render, cuando vale `false` por fail-closed, y el efecto no
  se vuelve a ejecutar. Con el backend declarando `enabled: true`, la tarjeta de
  saldo se renderizaba con el monto en "…" **para siempre** y "Últimos
  movimientos" no aparecía nunca. Arreglado con un efecto por capability, cada
  uno con su dependencia y separados entre sí.
- **Mi verificación en navegador de 0.30.0 no podía verlo:** di el control por
  bueno viendo APARECER la tarjeta, y la tarjeta aparecía vacía — el monto está
  enmascarado por diseño y se ve igual cargado que sin cargar. Hizo falta el
  ojito.
- **Barrido estructural nuevo:** falla nombrando archivo y capability si un
  `useEffect` lee una y no la declara en sus dependencias. Con guardarraíl
  contra pasar en vacío y con su límite declarado dentro del test.
- **El barrido de (d) tenía un agujero, y lo tenía el barrido:** detectaba una
  supresión sólo si el archivo nombraba los tipos, así que una escrita
  importando `WALLET_NOTIFICATION_TYPES` —la forma más natural— pasaba limpia.
  Ahora también se marca esa vía.
- No es defecto de dinero: son GET de lectura, y con el riel apagado —el estado
  vigente— nada de esto se ejecuta.

## 0.30.0 — El apagado del wallet deja de ser decisión del front (2026-08-04)

- **OLA 5D · el riel saldo lo declara apagado el BACKEND, y este front lo lee.**
  Hasta acá `WALLET_RAIL_ENABLED` era una constante propia: wallet estaba
  apagado porque el front decidió apagarlo, no porque el sistema lo declarara
  apagado, y un deploy de este front con otro valor lo reencendía sin que el
  backend se enterara. Desde App Backend v2.31.0 `GET /api/config` publica
  `features.wallet_rail`, y `src/api/walletRail.ts` la consume.
- **La constante se eliminó, no se conservó apuntando al nuevo estado.**
  Mientras existiera, alguien podía leerla en vez de leer la capability. El
  typecheck marcó los ocho consumidores uno por uno.
- **Fail-closed, en direcciones distintas para cada campo.** `enabled` falla a
  `false`: capability ausente, mal formada o red caída → riel APAGADO, y el
  estado inicial ya es apagado, así que no hay ventana en la que la UI de saldo
  aparezca mientras la respuesta viaja. `account_activity` falla a `true`:
  historial y estadísticas propias leen `payment_attempts`, son card-only
  ratificado, y esconderlas por un fallo de red repetiría `07f0ba2`. Son dos
  parámetros distintos de `accountRailView`, no uno derivado del otro.
- **Conjunto CERRADO de claves del lado del consumidor.** Un backend distinto
  del espejado no es una hipótesis: es el caso normal de un deploy
  desincronizado. Una clave de más apaga el riel; si tiene forma de permiso por
  principal (`enabled_for_user`, `per_branch`, `sucursal_override`) además se
  denuncia, porque la ratificación prohíbe ese permiso.
- **El mock respeta la capability, no la ignora**: `mockGetConfig` publica el
  mismo shape y recorre el mismo lector. Un test lee el espejo como texto y
  falla si los valores del mock se separan de los del emisor.
- **Nada se borró.** `TopupScreen`, `TransferScreen`, los ocho métodos del riel
  y `payment_type: 'wallet'` siguen durmientes: verificado en el navegador
  poniendo `enabled: true` en el mock, con la UI de saldo y `#/cargar` volviendo
  completas.
- **La pestaña de Cuenta se DERIVA en vez de recordarse.** Se inicializaba desde
  un valor que ahora llega después del primer render; con
  `account_activity: false` quedaba en 'historial' con los dos paneles apagados.
- **(d) · los avisos del riel saldo se fueron POR EL EMISOR** (`5e210fd`), y este
  repo lo ACREDITA en vez de taparlo: la lista del mock se compara contra el
  espejo —tenía cuatro tipos y el emisor suprime cinco; faltaba `topup_failed`—
  y un barrido estructural falla si alguien agrega un filtro de red por esos
  tipos. `AvisosScreen` sigue sin gate: el backend dejó de crear filas nuevas,
  no borró las viejas, y esconderlas ocultaría un hecho real. `tip_received` no
  se suprime, ni allá ni acá.
- `contract-mirror/` refrescado por copia a
  `db48cf69422fb0edbeb633e883c14405174a549b` (v2.31.0): 67/67 byte-idénticos,
  con sólo dos archivos cambiados respecto del refresh anterior. Esto no
  acredita publicación externa.
- **Límite declarado:** desde este repo no se puede acreditar el emisor
  corriendo. El end-to-end real contra el backend vivo sigue faltando.

## 0.29.5 — Cierre local de auditoría y espejo v2.28.8 (2026-08-03)

- Las mutaciones distinguen rechazos definitivos de resultados ambiguos: sólo
  conflictos idempotentes/concurrentes, 408/425/429 y 5xx conservan el intento
  para replay; un 400 de validación no queda congelado como si fuera red.
- El alta de tarjeta conserva en `sessionStorage` únicamente key, etapa y
  referencia `pm_`, ligadas al principal y con limpieza CAS. Nunca persiste el
  `client_secret`; un registro corrupto o storage no durable falla cerrado.
- SetupIntent, attach de tarjeta e invitaciones validan su shape en runtime:
  un 2xx malformado no se convierte en éxito. El mock replica la autoridad e
  idempotencia relevantes y el portapapeles sólo informa éxito comprobado.
- Un replay de invitación vencida se modela como terminal: no se copia ni se
  marca al amigo como invitado, y la key anterior se libera para un intento
  fresco. Link, código de mesa y token también quedan ligados en runtime.
- El alta de tarjeta captura principal+familia: una respuesta tardía de la
  sesión A no puede persistir, adjuntar ni limpiar referencias bajo la sesión B.
  La transición setup→attach también usa CAS por key: K1 no resucita sobre K2.
- La creación de mesa bloquea un nuevo intento si existe evidencia local
  ambigua anterior, antes de tokenizar otra tarjeta.
- El límite previo de OCR se alineó con el receptor auditado: más de 8 MiB se
  rechaza antes de red, en lugar de ofrecer 10 MiB que el backend nunca acepta.
- El lock actualiza PostCSS de 8.5.19 a 8.5.25 mediante el fix compatible del
  audit; no se fuerza el salto mayor Vite 5→8 requerido por los dos hallazgos
  restantes de toolchain de desarrollo.
- `contract-mirror/` fue refrescado por copia: 67/67 archivos byte-idénticos
  contra App Backend
  `e8a3faf2f520b249cbe6001f14ef70230a405695` (v2.28.8), con procedencia y
  bloqueos vigentes documentados. Esto no acredita publicación externa.
- Baseline ratificado: wallet durmiente post-auditoría (no borrado) y
  Apple/Google Pay como MUST de primer pago mediante hoja nativa, sin prerequisito
  de tarjeta guardada. El candidato permanece **NO-GO de release/piloto** por
  los seis bloqueos de backend y los gates de wallet, hojas nativas, PQ-2 y
  G-24 listados al inicio de `GAPS.md`.

## 0.29.4 — Familia de sesión y refresh fail-closed (2026-08-02)

- Login/registro crean una familia y principal opacos; refresh conserva ambos y
  usa compare-and-swap antes de guardar o limpiar una sesión.
- Los retries autenticados abortan si la familia cambia. La rotación exige Web
  Locks y falla cerrada cuando no existe exclusión acreditable.

## 0.29.3 — Clasificación B-06 y checks locales (2026-08-02)

- Los rechazos definitivos del contrato rotan aunque lleguen como 409; solo
  `idempotency_conflict` y 429 conservan el intento. `refunded` no rota.
- Se incorporó Vitest 3.2.7, checks de clasificación B-06/hash seguro y CI
  ejecuta tests antes de typecheck/build.

## 0.29.2 — Link de invitado aislado de la sesión (2026-08-02)

- Un link `#/mesa/:code?t=…` ahora conserva siempre la identidad invitada,
  incluso si el navegador tiene una sesión PayMe activa. El token se envía por
  el canal guest del contrato y no se mezcla con Authorization.

## 0.29.1 — Recuperación segura de reintentos y runtime (2026-08-02)

- B-06: un `409 idempotency_key_terminal` ahora rota y descongela el intento
  muerto; `idempotency_conflict` conserva su tratamiento seguro.
- La identidad idempotente y el payload pendiente cuentan con fallback en
  memoria cuando `sessionStorage` está bloqueado, sin convertir la evidencia
  `claimed_by_me` en un guard de casillero único.
- Refresh rotativo single-flight, OCR multipart a través del cliente
  autenticado con timeout/refresh, y hash mal codificado que degrada a home en
  lugar de tumbar la aplicación.

## 0.29.0 — Apple/Google Pay solo donde funcionan (2026-07-25)

Decisión de Mati (2026-07-25): **se ocultan en la app real**, se mantienen en el
build demo. Los botones existían desde el principio pero contra el backend real
devuelven **400**: no hay integración con la Payment Request API de Stripe y el
schema de pago exige un `stripe_payment_method_id` que esos botones no producen.
En la demo funcionan porque el front manda un `pm_` de utilería.

- **`WALLET_PAY_ENABLED`** en `src/api/index.ts`, junto a `IS_MOCK`/`IS_DEMO`:
  `IS_MOCK || VITE_WALLET_PAY === '1'`. El **default es el estado verdadero** —
  encendido en la demo, apagado en cualquier build real — así el build `/live/`
  los oculta solo, sin depender de que alguien setee una variable en un job
  nuevo. **No hubo que tocar el workflow de despliegue.**
- **Nada borrado**: el `PaymentType`, la etiqueta del comprobante (`Ⓖ Google
  Pay`) y el bloque `pm_mock_walletpay` quedan intactos. Verificado en el
  bundle: en el build real Vite **elimina los dos botones** por rama muerta y
  la etiqueta del comprobante sobrevive; en el de demo están los dos.
  Reactivarlos el día que se implementen es cambiar un default.
- **El copy del invitado cuelga del mismo flag**: decía "Sin iniciar sesión
  pagás con tarjeta **o Apple Pay**" — con los botones ocultos habría afirmado
  un método que no está en pantalla.
- **G-12 anotado**: `features.apple_pay`/`google_pay` de `GET /api/config`
  están **hardcodeados en `true`** (a diferencia de `stp_dispersal`/`ocr_real`,
  que leen entorno), o sea que el backend afirma una capacidad que no cumple.
  Se pide que pasen a leer entorno, pero **como seguimiento post-27/07**: no es
  un flip de variable, es release + deploy del backend que mueve dinero, y el
  ocultamiento ya está resuelto sin ellos. Por eso el front NO gatea por ese
  campo: sería depender de un dato muerto (ese route se auto-declara `2.5.2`
  con el backend en v2.26.0) y además llegaría tarde, haciendo parpadear los
  botones.
- **Runbook T7**: fila nueva para Apple/Google Pay, con la nota de que probarlos
  de verdad exige iPhone/Safari y Android/Chrome.

Revisión adversaria de 33 agentes sobre el plan: tumbó el diseño original
—gatear por `features` de `/api/config` y pedirle al backend bajar el flag— con
la evidencia de que esos flags son literales en el código, no variables de
entorno.

## 0.28.0 — B-06: el reintento ya no cobra dos veces (contrato v2.25.0) (2026-07-25)

Cierra **B-06** del lado del front. El backend tenía la idempotencia bien
hecha; nosotros generábamos una `idempotency_key` NUEVA dentro de cada llamada,
así que nunca se ejercía: si se perdía la RESPUESTA de un pago ya cobrado, el
reintento cobraba de nuevo (en división igual se llevaba el casillero de otro
comensal; en consumo cobraba otra vez la misma fracción).

- **`src/api/idempotency.ts` (nuevo)**: la clave vive en `sessionStorage` —no
  en memoria: recargar la página entre el fallo y el reintento traía el bug
  entero de vuelta— y el `pm_` tokenizado viaja con ella, porque Stripe.js
  devuelve uno distinto por invocación y el backend lo hashea.
- **El scope se DERIVA DEL CONTENIDO** del pago, con los mismos campos que
  hashea `PAYLOAD_KEYS` del backend. Mismo pago = misma clave (aunque el
  usuario recargue o salga de la mesa y vuelva) → replay. Pago distinto = clave
  distinta, sin rotar nada. **No se rota "por efecto"**: un `useEffect` con
  deps corre también en el MONTAJE y borraba la clave justo cuando el usuario
  vuelve a mirar la mesa — que es lo que el propio mensaje de error le pide.
- **Intento CONGELADO ante error ambiguo** (5xx, red, timeout): se guarda el
  CUERPO exacto que salió y la pantalla bloquea propina, método y consumos. El
  único botón es "Reintentar el pago sin confirmar", que reenvía ese mismo
  cuerpo. Congelar solo la clave no alcanzaba: tras una recarga el estado
  arranca vacío y reconstruir el pedido daba 409 en bucle.
- **Definitivo vs ambiguo por STATUS, no por lista de códigos**: un 4xx es una
  decisión del backend (ya liberó lo tomado) → clave nueva; 5xx/red/timeout no
  dicen nada → se conserva. Excepciones: 409 `idempotency_conflict` (hay un
  intento vivo: rotar ahí ES el doble cobro) y 429.
- **`refunded` nunca rota solo**: el backend devuelve 200 con ese estado a
  propósito, y rotar sería re-cobrar un reembolso. Se avisa y volver a pagar
  queda como decisión explícita del usuario.
- **`claimed_by_me` (v2.25 §4.3) consumido**: en partes iguales la mesa ahora
  dice "Ya pagaste tu parte ✓" y el CTA pasa a "Pagar otra parte". No se
  bloquea —pagar más de una parte es legítimo (acta 2026-07-25)— pero deja de
  ser un accidente. También descongela solo el intento cuando aparece un
  casillero mío MÁS de los que había al congelar.
- **Abrir mesa (`POST /mesas`)**: el mismo tratamiento. Era el caso más caro —
  un reintento creaba una segunda mesa con una segunda garantía por el TOTAL.
  La clave se rota al quedar la garantía autorizada, no antes: durante el 3DS
  se conserva para poder reintentar sobre la MISMA mesa. Un rechazo del banco
  sí rota (no hay endpoint para re-garantizar, y si no quedaba en bucle).
- **Transferencias y carga de saldo**: misma política. La transferencia es
  irreversible y en OXXO un reintento emitía un SEGUNDO voucher válido (dos
  referencias vivas; si se pagaban las dos, se acreditaba el doble). Además el
  topup con tarjeta ahora mira `status` y `requires_action` antes de cantar
  "se acreditaron": el replay de un cobro fallido se anunciaba como éxito.
- **Timeout de 30s en `http.ts`** (incluido el pago del INVITADO): sin él, "se
  perdió la respuesta" era una pantalla colgada durante minutos — justo lo que
  empuja a reintentar a ciegas.
- **Mock fiel**: replica la idempotencia comparando el HASH del payload (misma
  clave + otro contenido = 409, como el backend) y la garantía WALLET, que
  volvía antes de guardarla y retenía el total otra vez en la demo.

Revisión adversaria de 34 agentes sobre el diff: 23 hallazgos confirmados,
todos aplicados. Los tres más graves los encontró ella, no yo — el efecto de
rotación que corría en el montaje, la clave de mesa que nunca se rotaba tras
el éxito, y el 3DS rechazado sin salida.

## 0.27.0 — Connect: 3DS sobre la cuenta conectada (contrato v2.24.0) (2026-07-25)

Consume el contrato de **direct charges** publicado (acta
`[PAYME]_ACTA_2026-07-24_PIVOTE_STRIPE_CONNECT_TARJETA.md`; verificado en el
repo hermano y en vivo). **El front queda listo para que el backend encienda
el pivote.**

- **`connected_account_id` (aditivo)**: cuando el PaymentIntent —o el hold de
  la garantía— vive en la cuenta del restaurante, Stripe.js se inicializa con
  `{ stripeAccount }` para poder confirmar el 3DS. Sin el campo, es cargo de
  plataforma y todo funciona como siempre; **las dos formas conviven**
  restaurante por restaurante, que es justo lo que el pivote necesita.
- **`stripe.ts`**: una instancia de Stripe.js **por cuenta** (Map cacheado;
  antes era una sola) + la config de `/api/config` cacheada aparte, con
  invalidación si falla la red. `createCardPaymentMethod` y `confirmCardSetup`
  siguen SIEMPRE en plataforma: el backend clona el `pm_` a la cuenta
  (`clonePaymentMethodToAccount`) y las tarjetas guardadas son bóveda de
  PayMe. Verificado leyendo el backend, no asumido.
- **Los dos caminos de 3DS lo pasan**: pago (`MesaScreen`) y garantía
  (`CreateMesaFlow` → `confirmGuarantee3ds`).
- **`save_payment_method` en riel directo**: el backend lo ignora a propósito.
  Como el front solo conoce el riel al recibir la respuesta, ahora **lo dice**
  ("esta vez la tarjeta no quedó guardada") en vez de dejar creer que se
  guardó. **G-11 anotado**: pedido de una señal PRE-pago para poder ocultar el
  checkbox.
- **Mock fiel a la semántica**: `MOCK_CONNECTED_ACCOUNTS` con **Hanzo Sushi
  conectado y La Parolaccia NO** — así el riel directo se prueba con el QR de
  Hanzo (`?r=…0002`) y la demo del video (La Parolaccia) queda idéntica. En el
  riel directo el mock tampoco guarda la tarjeta.
- Verificado en browser (mock), los dos rieles: **Hanzo** → comprobante
  "Cobrado por: Hanzo Sushi", aviso de tarjeta no guardada, la lista de
  tarjetas NO crece; **La Parolaccia** → sin aviso, sin "Cobrado por", y la
  tarjeta nueva SÍ queda guardada. Espejo refrescado a v2.24.0
  (+ `services/connect.js`).

**Fixes de la revisión adversaria del diff** (13 hallazgos confirmados; el
riel toca dinero, así que se revisó con 3 lentes + refutación):

- **El comprobante mentía en el riel de plataforma** (bug introducido en
  0.26.0): decía "Cobrado por: <restaurante>" en TODO pago con tarjeta.
  Ahora se afirma solo con `connected_account_id` presente — que es
  exactamente cuando es cierto. El caption pre-pago pasa a ser verdadero en
  ambos rieles ("Estás pagando tu parte en X — PayMe divide la cuenta"),
  porque antes de pagar el front no sabe el riel (G-11).
- **El REPLAY idempotente saltaba el 3DS**: ahí el backend devuelve la fila
  cruda (`stripe_client_secret`, sin `requires_action`). Se tolera ese shape
  y se deriva del `status`; sin esto, un replay en 3DS pintaba "pagado" con
  el cobro sin confirmar. **B-06 anotado** (la otra mitad: reusar la
  `idempotency_key` en el reintento — cambia el comportamiento de reintento
  de un pago, va a ratificación de Mati).
- **El aviso de garantía se disparaba ANTES del 3DS** ("Mesa garantizada ✓"
  con la mesa aún en `pending_auth`): ahora es una línea en la pantalla de
  compartir, que solo se alcanza con la retención autorizada. Mismo criterio
  en el pago: línea en el comprobante en vez de toast efímero (se pisaba con
  la animación de "Cobrando…").
- **Copy de la garantía neutral**: "Para abrir la mesa **se retiene** el
  total" — con Connect la retención puede vivir en la cuenta del restaurante,
  así que ya no se nombra a PayMe como quien retiene. Verdadero en ambos
  rieles y sin esperar decisión de producto.
- **Apple/Google Pay**: el `pm_` de utilería queda atado a `IS_MOCK`. Contra
  el backend real habría hecho fallar el clonado a la cuenta conectada
  (alarma `connect_pm_clone_failed`) degradando el pivote en silencio.

## 0.26.0 — Pivote a Stripe Connect: quién cobra (campo visible) (2026-07-24)

Ratificado por Mati. Con el pivote, en un pago de mesa con **tarjeta**
(incl. Apple/Google Pay) el merchant of record es el **RESTAURANTE**, no
PayMe. Cambio ACOTADO a lo que el usuario ve; el riel de saldo (wallet,
cargas, transferencias) sigue siendo de PayMe y no se tocó.

- **Comprobante en pantalla**: fila **"Cobrado por: <restaurante>"**, solo
  en pagos con tarjeta. Debajo, cuando el backend exponga el descriptor:
  "En tu resumen de tarjeta vas a ver <DESCRIPTOR>".
- **Comprobante enviar/descargar** (`receiptText`): mismas líneas, misma
  condición.
- **Antes de pagar**: caption bajo "Método" — "Te cobra <restaurante> —
  PayMe divide la cuenta" — para que se sepa ANTES, no solo en el recibo.
- **G-10 en GAPS.md**: el contrato (v2.21.0, verificado repo + vivo) NO
  expone `statement_descriptor`. Forma acordada:
  `attempt.statement_descriptor: string | null`. **Mock-first**: el mock lo
  deriva del nombre (mayúsculas, 22 chars); en real llega `undefined` y la
  UI degrada sin el sub-texto — el "Cobrado por" sale igual de
  `restaurant.name`, que sí es contrato.
- Verificado en mock: con tarjeta aparecen fila + descriptor; con **saldo**
  no aparece ni el caption ni la fila (ese riel no cambió).
- Anotado en G-10 como pendiente del pivote: si la **garantía** con tarjeta
  también pasa a ser del restaurante (hoy el copy dice "PayMe retiene el
  total") — y que el pivote todavía no tiene acta en `ops/actas/`.

## 0.25.0 — T-F1: primer feedback del hermano de Mati (2026-07-24)

Tier ratificado por Mati sobre la auditoría de diseño de su hermano.

- **Nav nueva**: Inicio · **Cuenta** · Amigos · Perfil. Cuenta pasa a ser
  pestaña (sin flecha atrás); Amigos y Grupos son UNA sección con tabs
  internas (`SocialTabs`) — la pestaña queda activa en ambas páginas y los
  deep links/backs se conservan (cada tab sigue siendo ruta).
- **Banner de invitación con botón "Aceptar"** a la derecha (antes el banner
  entero aceptaba al tocarlo); el contenedor ya no se "hunde" al tacto.
- **Invitar amigos de PayMe** (`InviteFriends`): buscador con typeahead
  (insensible a acentos — `fold` nuevo en utils, aplicado también al
  buscador de Amigos) + desplegable de grupos con "Invitar a todos". Usa el
  contrato EXISTENTE de invitaciones in-app (`POST /mesas/:code/invitations`
  type `in_app` por `payme_id`). Montado en el paso compartir Y en la mesa
  (desplegable, solo organizador con mesa invitable — el compartir es
  one-shot). Guard sincrónico anti doble-envío (el backend no dedupea),
  toasts que dicen la verdad (todo ok / parcial / todo falló / mesa ya no
  invitable, cortando el resto), y carga fallida con "Reintentar".
- **Torta de gastos por categoría** en Cuenta → Este mes: donut SVG propio
  (cero dependencias) desde `GET /account/history` pidiendo el MES COMPLETO
  (`from` + `limit=100` — sin eso el backend da solo la primera página de 20
  y los montos no cerrarían contra stats; el mock ahora replica la
  paginación real). Mes en UTC, espejando el `date_trunc` del server. G-09
  anotado como nice-to-have (agregado server-side para >100 pagos/mes).
- Fixes de la revisión adversaria (16 confirmados): además de lo anterior,
  `.btn-fit` reemplaza overrides inline sobre `.btn-sm`, `aria-current` en
  SocialTabs, seed del mock `payme_mx_leop` (el viejo `_leo` violaba el
  formato del contrato; con migración del estado persistido) y `has-cta`
  en el paso compartir (el CTA flotante tapaba la lista de amigos).
- 0.24.1 (hotfix previo, sin entrada propia): la bottom nav tapaba los CTA
  de Amigos y Grupos (feedback del hermano) — `.has-nav .action-bar` +
  clase `has-nav` que faltaba en la lista de Grupos.
- Anotado para juicio de Mati (sin codear): las filas "Saldo y tarjetas" y
  "Amigos" de Perfil ahora duplican pestañas visibles de la nav.

## 0.24.0 — G-01 + G-03: restaurante por QR y saldo disponible/retenido (contrato v2.21.0) (2026-07-24)

Consume los DOS últimos contratos pendientes (verificados en repo hermano y
en vivo). **GAPS.md queda EN CERO por primera vez desde T0.**

- **G-01 · Restaurante por QR**: el flujo de abrir mesa resuelve el
  restaurante contra `GET /restaurants/:id` — el id llega por el QR de la
  mesa (`?r=<uuid>`, query o hash) con `VITE_RESTAURANT_ID` como fallback de
  la demo. QR roto/suspendido → aviso naranja en el escaneo ANTES de armar
  nada. `VITE_RESTAURANT_NAME` retirado del deploy (el nombre ya no se
  hardcodea). Tipos `Restaurant`/`RestaurantResponse` (`address` nullable —
  verificado en vivo), `httpPublicRequest` (primera ruta pública),
  `QR_RESTAURANT_ID`, mock sobre `MOCK_RESTAURANTS` (el QR de Hanzo Sushi
  cambia el restaurante de la demo).
- **G-03 · Disponible/retenido**: `BalanceResponse` suma
  `held_balance_cents/_display` + `available_cents/_display`. La card de
  Cuenta pasa a **"Disponible $X"** con línea "🔒 Retenido en garantías: $Y"
  cuando hay hold; el ojito del Home y el "Disponible:" de Transferir usan
  `available_cents`. Mock replica la resta sobre su hold wallet.
- Verificado en mock (QR Hanzo en header · QR inválido avisa · garantía
  wallet $60 → Disponible $235 + Retenido $60) y en vivo (200/404/404-
  malformado/búsqueda `?q=` · balance con los 6 campos). Espejo a v2.21.0
  (`routes/restaurants.js` NUEVO, `routes/account.js`, `schemas/index.js`).

## 0.23.0 — G-02: perfil propio (contrato v2.20.0) (2026-07-24)

Consume el contrato de identidad publicado (verificado en repo hermano y en
vivo). Cierra G-02: tras un login real, el nombre es el REAL.

- **`GET /account/me`** en el facade (`getMe`), tipos `MeResponse` +
  `User.phone/created_at` (solo /me), y `TokenPair` separado de
  `LoginResponse` (el refresh devuelve solo tokens — decisión del plan G-02).
- **Login guarda `user`** (v2.20 lo devuelve, mismo shape que register) y las
  **sesiones persistidas pre-v2.20 se hidratan** una vez con `GET /account/me`
  al restaurar (AuthContext); si falla, se saluda sin nombre y el próximo
  login completa.
- **Borrado el paliativo del email**: `identity.ts` ya no deriva el nombre del
  local-part tipeado y `StoredSession` pierde el campo `email`.
- Mock: `mockGetMe` sobre el user vigente de la demo. Espejo refrescado a
  v2.20.0 (`routes/auth.js`, `routes/account.js`).
- Verificado: mock (sesión vieja sin `user` plantada a mano → hidrata y
  saluda "Hola, Mati!") y vivo (login con `user`, `/account/me` con
  `phone: null` + `created_at`, 401 sin token).

## 0.22.0 — T-D3: set de íconos SVG propio + escala tipográfica (2026-07-23)

Cierra el tier de diseño T-D3 ratificado por Mati: chau emojis como
iconografía de interfaz, escala de tamaños única.

- **`src/components/Icon.tsx` nuevo**: 40 glifos SVG dibujados a mano
  (grilla 24×24, trazo 1.75, `currentColor`, cero dependencias — regla dura
  del repo). Tipado estricto: un nombre inexistente no compila.
- **~110 emojis de UI migrados a `<Icon>`** en las 12 pantallas +
  BottomNav: navegación, saldo/ojito, métodos de pago, estados vacíos,
  categorías de restaurante (pasta/sushi/taco/café), avisos, comprobante,
  scan (el recibo del encuadre ahora es visible: el emoji traía su color,
  el SVG hereda), countdowns, candados y compartir.
- **Movimientos de wallet con glifo semántico** (`walletTxIcon` reemplaza a
  `walletTxEmoji` en utils/labels.ts): flechas entrante/saliente para
  transferencias, tiendita OXXO, banco SPEI, plato para pagos de mesa,
  billete para propinas, +/− para ajustes.
- **Escala tipográfica en tokens** `--fs-2xs`…`--fs-hero` (10 tamaños):
  ~85 `fontSize` inline sueltos convertidos; quedan solo los derivados
  (avatar) y el 16px del CardField (regla anti-zoom de iOS, intocable).
- **Se conservan a propósito**: ✓ ✕ − ＋ → ÷ tipográficos, los íconos de
  grupo elegidos por el usuario (contenido, no interfaz), el chip
  VISA/Mastercard y la G de Google Pay.
- Verificación visual completa en mock (home, flujo mesa entero hasta
  comprobante, cuenta, perfil, avisos); typecheck y build verdes.

## 0.21.0 — Fracciones de platos compartidos (contrato v2.18.1) (2026-07-23)

Consume el contrato fraccional publicado (verificado en repo hermano y vivo;
acta de fracciones del 2026-07-23). Cierra G-08 y G-07.

- **Selector de fracción EN LA MISMA LÍNEA del ítem** (UX ratificada): al
  marcar un consumo aparecen las pills `1 · ½ · ⅓ · ¼` (solo las que entran
  en lo que queda), el precio de la fila muestra TU fracción y los ítems
  parcialmente tomados dicen "queda ½". Bloqueado solo cuando no queda nada.
- **Lock y pago fraccionales**: `items: [{item_id, fraction_bps}]` en
  lock/pay (consumo); en partes iguales siguen los `item_ids` informativos
  (que v2.18.1 ahora SÍ persiste — G-07 resuelto). Manejo del
  `409 fraction_not_available` con el `remaining_bps` en el aviso.
- **Preview con la réplica exacta** (`fractionAmount` en utils/money.ts,
  procedencia utils/money.js del backend); la fracción COMPLETADORA la ajusta
  el server y el comprobante usa los montos del attempt (recibo
  `attempt.items`).
- **Mock espejando services/itemClaims.js**: claims por ítem, effectiveBps
  (tolerancia <100 bps absorbe), priceFraction (la completadora cierra
  exacto), re-reclamo reemplaza, `paid` solo al 100%, migración del estado
  persistido. Verificado: ½+½ de $195 = 97.50+97.50 y "ya pagado" recién al
  cierre.
- **E2E real contra v2.18.1**: ⅓+⅓+⅓ de $70.00 = 23.33+23.33+**23.34**
  (absorción exacta), ítem `paid`. **B-05 nuevo en GAPS.md**: el re-lock
  inmediato del mismo dueño libera claims de un pago exitoso con webhook
  pendiente (corrompe `remaining_bps`) — reportar al backend; no bloquea el
  flujo real.
- **contract-mirror a v2.18.1**: schemas, mesas, webhooks, stateMachine,
  money y el servicio nuevo `services/itemClaims.js`.

## 0.20.0 — Batch 2 de Mati: unidades seleccionables + ticket en una línea (2026-07-23)

- **Cantidades EXPANDIDAS en unidades al crear la mesa**: "Tiramisú ×2" viaja
  como dos ítems de $70 (quantity 1) → cada unidad se elige/reserva por
  separado en los DOS modos de división. Resuelve "dejame seleccionar 1 o 2"
  sin cambio de contrato (el total no cambia; el backend ya acepta filas
  unitarias). El stepper de cantidad sigue en el ticket editable; la
  expansión ocurre al confirmar.
- **Ticket editable en UNA línea por consumo** (nombre · $precio · −n＋ · ✕):
  un listado de 10+ personas ya no se hace eterno.
- **Partes iguales**: fuera la sección "Partes de la mesa" (sin sentido para
  el comensal); queda la nota "N partes iguales de $X · quedan Y". La lista
  "¿Qué consumiste?" ahora muestra el PRECIO de cada producto.
- **G-08 nuevo en GAPS.md**: platos compartidos por fracciones (1/2, 1/3…)
  entre varios comensales — decisión de producto + contrato pendiente de
  acta con el backend (opciones presentadas a Mati con recomendación).

## 0.19.0 — Batch de feedback de Mati: 10 ajustes de UX (2026-07-23)

Directivas explícitas de Mati sobre capturas (2026-07-23):

- **Fuera "Cargar el ticket a mano"**: en el escaneo queda solo "Capturar"
  (revierte el camino manual de 0.18.0; el ticket editable se conserva).
- **Filas del ticket compactas**: menos aire entre consumos.
- **CTAs primarios de los flujos como píldora flotante naranja** (estilo del
  mock del hermano): ticket, división, garantía, compartir, "Pagar mi parte"
  y "Pagar $X" — siempre visibles, sin bajar hasta el fondo (`.cta-float`).
- **El cabezal SIEMPRE lleva el logo PayMe**: `TopBar` compartida (logo +
  título gris) y variante `inv` para los headers navy (scan, ticket, mesa).
- **Garantía sin la opción "Tarjeta" padre** (redundante): las tarjetas
  guardadas SON las opciones, + "Usar otra tarjeta" + Saldo PayMe.
- **Chip Mastercard real** (dos círculos en CSS puro, `CardBrandChip`
  compartido) en garantía, pago, Cuenta y Topup.
- **IMPORTANTÍSIMO — partes iguales con selección de consumo**: aunque el
  monto sea la parte fija, marcar QUÉ consumiste es obligatorio ("Marcá lo
  que consumiste", info para el restaurante). `item_ids` viaja SIEMPRE en el
  pay. **G-07 nuevo**: el backend hoy descarta esos ítems en la rama igual
  (`payment_attempt_items` solo se escribe en consumo) — llevar al dueño del
  contrato para que la info del modelo de negocio se persista.
- **Métodos de pago reordenados**: Saldo PayMe → Tarjeta con las guardadas en
  un DESGLOSABLE (resumen + ▾, no sueltas en la lista) → Apple Pay →
  **Google Pay (nuevo)**.
- **Comprobante con "Enviar" y "Descargar"** (Web Share / archivo de texto)
  para la contabilidad del comensal.

## 0.18.0 — D5 (front): revisá y corregí el ticket antes de dividir (2026-07-23)

Cierra la última decisión del roadmap D4–D7 del lado del front. Guardarraíl
del acta: si el total está mal, la división está mal. Sin cambios de contrato:
`POST /mesas` ya acepta los ítems que mande el cliente (validado: suma ==
total; probado en vivo con payloads arbitrarios en los e2e de D4/D7).

- **El paso "Ticket" es EDITABLE**: cada consumo tiene nombre, precio (pesos,
  teclado numérico), cantidad con stepper − n ＋ y botón quitar. "➕ Agregar
  consumo" suma filas (lo que el OCR se comió). El total del header se
  recalcula en vivo (centavos enteros, `stringToCents`) y ES el que viaja al
  backend.
- **"Continuar → dividir" se bloquea** con motivo visible si no hay consumos
  o si alguna fila está incompleta (sin nombre / precio en cero).
- **Camino manual**: link discreto "✍️ Cargar el ticket a mano" en la
  pantalla de escaneo (misma pantalla editable, vacía) + nota con la opción
  cuando la foto falla.
- Escanear sigue siendo el camino feliz de un toque; `?demo=1` intacto (el
  ticket de ejemplo llega editable pero "Continuar" sigue siendo un tap).
- Verificado en mock: editar precio (total $840→$895), borrar ítem y agregar
  "Postre ×2" ($875), fila inválida bloquea, manual → división parte del
  total corregido ($400 ÷ 4 = $100).

## 0.17.0 — D7: propina por comensal, base partes-iguales (2026-07-23)

Consume el contrato v2.17.0 publicado (verificado en repo hermano y en el
vivo). La propina deja de ser % de TUS consumos y pasa a ser % de tu parte
igualitaria (total ÷ N declarados al abrir); cada comensal deja SOLO la suya.

- **Picker nuevo en "Pagar mi parte"**: "Tu base: $X (la cuenta ÷ N)"
  (`tip_base_cents` del GET), pills 0/10/15/20 % + **"Otro"** con monto a
  mano. El % viaja como `tip_bps` (la cuenta la hace el SERVER); "Otro"
  manda `tip_cents`. Nunca ambos (excluyentes en el contrato). Invitados:
  mismo picker.
- **Preview con la fórmula EXACTA del server**: `tipFromBps` replicada
  literal en `src/utils/money.ts` (procedencia utils/money.js:107-112 del
  backend; paridad verificada ejecutando ambas sobre 441 vectores, 0
  diferencias). El comprobante usa el `tip_cents` que DEVUELVE el attempt
  (fuente de verdad) con fallback a la preview.
- "¿Para quién?" ahora se gatea con el tip efectivo (también aparece con
  monto a mano, no solo con %).
- **Mock espejando v2.17**: `tip_base_cents` en el detalle, `tip_bps`
  computado con la misma réplica, exclusividad 400, `tip_cents` en el
  attempt.
- **E2E real contra Railway v2.17**: base=7375 en GET ✓, ambos campos → 400
  ✓, `tip_bps=1500` → attempt.tip_cents=1106 exacto ✓, `tip_cents=2500`
  manual ✓ (ambos `succeeded`).

## 0.16.0 — T-D3a: el home del mock (FAB + barra inferior + saldo con ojito) (2026-07-23)

Adopción del mock de diseño del hermano de Mati (auditoría externa), con la
decisión de privacidad de Mati integrada (opción b ratificada):

- **"+ Nueva Mesa" flotante** (píldora naranja) en el home y en Mesas: LA
  acción de la app, siempre a un pulgar. Reemplaza al cuadrado del home.
- **Barra inferior fija** Inicio · Amigos · Grupos · Perfil (componente
  `BottomNav`, solo en las cuatro pantallas hub; los flujos siguen a pantalla
  completa). Las pantallas tab pierden la flecha "atrás" y ganan aire
  inferior (`.has-nav`). Resuelve la alcanzabilidad que marcó el inventario
  (Perfil e íconos sociales ya no dependen del home).
- **Home v3 por secciones**: header claro (logo + "Hola, X!" + campana),
  banner de invitación, **tarjeta de saldo con monto OCULTO** (`$ ••••`) y
  ojito 👁 para revelar de un tap (privacidad primero; Cargar/Transferir
  vuelven adentro de la tarjeta, flecha → Cuenta), "Mesas abiertas (N)" en
  carrusel horizontal con Ver más → Mesas, y "Últimos movimientos" (top 4)
  con Ver más → Cuenta. **Los montos de los movimientos respetan el mismo
  ojito** — sin revelar, el home no muestra ni un peso.
- La grilla de cuadrados de 0.14 desaparece (nav + FAB + secciones la
  reemplazan). En `?demo=1` la tarjeta de saldo sigue oculta (video YC).

## 0.15.0 — T-D2: volver con memoria + el banner cumple su promesa (2026-07-23)

Cierre de las podas de navegación del inventario de diseño (R-04, R-08, R-11):

- **`goBack(fallback)` en el router**: los "volver" de Transferir, Cargar y
  Mesa ahora respetan DE DÓNDE viniste (historial real del navegador; si la
  pantalla se abrió directa —deep link/refresh— cae a su contenedora
  natural). Antes: entrabas a Cargar desde Cuenta y "volver" te tiraba al
  home (R-08).
- **El detalle de mesa vuelve SIEMPRE a Mesas** (viva o cerrada), su
  contenedora natural ahora que tiene historial; los botones "🏠 Inicio"
  quedan como salto directo post-pago (R-11). El invitado sin cuenta sigue
  sin back del header.
- **El banner de invitación del home acepta DIRECTO**: decía "tocá para
  aceptar" pero mandaba a Avisos, donde había que tocar otra vez. Ahora
  acepta y te deja adentro de la mesa ("Sumándote a la mesa…" mientras
  procesa; si falla, avisa y no navega) (R-04). La campana de Avisos sigue
  como acceso a la lista completa.

## 0.14.0 — Home v2 + pantalla Mesas con historial (2026-07-22)

Decisiones de producto de Mati (ratificadas 2026-07-22):

- **El home es una grilla de cuadrados grandes centrados** (2 columnas:
  Nueva Mesa, Mesas, Cuenta, Amigos, Grupos, Perfil) en vez de tarjetas
  rectangulares apiladas; la invitación sigue full-width arriba. La tarjeta
  Mesas se resalta en teal cuando hay una abierta.
- **Cargar y Transferir salen del home**: viven solo dentro de Cuenta (donde
  ya estaban, junto al saldo). El home queda enfocado en la mesa.
- **La tarjeta Cuenta ya no muestra el saldo** (privacidad: nadie ve tu plata
  por mirar la pantalla). El monto se ve recién adentro de Cuenta. El home
  deja de pedir `GET /account/balance`.
- **"Mesas Abiertas" → "Mesas"**: como las abiertas son transitorias (la
  garantía captura el faltante al vencer), la pantalla vive del HISTORIAL.
  Si hay una abierta va arriba, destacada en teal; debajo, la lista
  minimalista de mesas pagadas (restaurante, fecha, lo que pagaste vos —
  una línea por mesa). Fuente: `GET /account/history` del contrato real
  (nuevo en el facade: `getHistory`), agrupado por mesa en el cliente.
  En el home, la tarjeta dice "1 abierta ahora" en color o "Tu historial".
- **Mock espejando el shape**: seed con 3 mesas pagadas; cada pago propio
  suma su entrada al historial (los invitados no: el historial es del
  usuario autenticado, como en el backend).
- La invitación y la fila Amigos/Grupos/Perfil quedan en el home (decisión
  de Mati; revierte la idea previa de mover Amigos/Grupos a Perfil).

## 0.13.0 — T-D1: tipografía nueva + texto de apoyo unificado (2026-07-22)

Primer tier del carril de diseño (ratificado 2026-07-22; Mati eligió la
opción C del comparador de fuentes).

- **Plus Jakarta Sans reemplaza a Syne** como fuente display (títulos, montos,
  botones); el cuerpo sigue en DM Sans. Cambio en `index.html` (Google Fonts)
  y `--font-display` (`global.css`) — se propaga solo a toda la app.
- **El campo de tarjeta de Stripe ahora carga DM Sans de verdad**: el iframe
  no hereda las fuentes de la página y `stripe.elements()` no recibía la
  opción `fonts`, así que caía al sans del sistema desde T7.
- **Texto de apoyo unificado**: 16 captions armados a mano con
  `fontSize 10.5–12 + var(--gray-d)` en 7 pantallas pasan a la clase
  `.caption` existente (11.5px, `--gray-txt`); los 2 de monospace (CLABE,
  dígitos de tarjeta) conservan su familia pero adoptan el mismo gris. Se
  acaba la convivencia de dos grises para el mismo rol.

## 0.12.0 — D4: tarjeta guardada, conectado al contrato v2.16 publicado (2026-07-22)

Primera decisión del roadmap ratificado (acta 2026-07-22). Durante la
implementación mock-first el backend PUBLICÓ D4 (v2.16.0, verificado en el
repo hermano y en `/health` del vivo), con una forma más rica que el texto del
acta — y el contrato publicado manda: `GET /payment-methods` conserva `id`
(uuid) + `last_four`/`bank_name`/`type`/`display` y AGREGA
`stripe_payment_method_id` (pm_…); la garantía acepta **`payment_method_id`
(uuid) para tarjeta guardada**; `save_payment_method` (default false) guarda
la tarjeta tipeada. Cierra G-04/G-05 y disuelve G-06.

- **Selector de tarjetas guardadas en la garantía** (`CreateMesaFlow`): banco +
  ····últimos 4 + vencimiento + badge "Principal" (la principal viene
  preseleccionada). Elegir una guardada saltea Stripe Elements (sin re-tipeo,
  viaja su uuid como `payment_method_id`) y mantiene el 3DS
  (`requires_action`); "➕ Usar otra tarjeta" abre Elements con el checkbox
  **"Guardar esta tarjeta para la próxima"** (ratificado: prendido por
  defecto → `save_payment_method: true`).
- **El mismo selector en el pago** (`MesaScreen`). El invitado sin cuenta
  sigue igual que hoy (Elements, sin checkbox). Modo demo `?demo=1` intocado.
- **Cuenta → Tarjetas y Topup**: sin cambios visibles (el contrato conservó
  banco/tipo); el alta de Cuenta sigue vía setup-intent. En la garantía se
  quitó el bootstrap de setup-intent de v2.14: desde v2.16 el cliente Stripe
  se crea solo (confirmado por el aviso de publicación y verificado en vivo).
- **Mock** espejando v2.16: seed con dos tarjetas (uuid + pm_), reuso por
  `payment_method_id`, `save_payment_method` honrado — en la garantía la
  tarjeta se guarda RECIÉN al confirmar el 3DS (como el backend, que guarda en
  el webhook del hold): cancelar el 3DS no deja tarjetas fantasma.
- **Robustez del Card Element** (hallazgos de la review adversaria del diff):
  al desmontar, `CardField` resetea el estado del padre (antes un
  `complete: true` colgado dejaba el botón habilitado con el iframe nuevo
  vacío) y expone `empty`, con lo que la carga tardía de tarjetas ya no pisa
  la selección si el usuario está tipeando una nueva. Fix también del alta
  mock repetida en Cuenta (id fijo → no-op silencioso con éxito falso).
- **contract-mirror refrescado a v2.16.0**: `schemas/index.js`,
  `routes/mesas.js`, `routes/payment-methods.js`, `routes/webhooks.js`,
  `docs/settlement.js.ref`. (En v2.15.0/D6 el espejo quedó byte-idéntico: el
  calendario de México vive en el outbox app→dashboard, fuera del contrato del
  comensal.)
- **GAPS.md**: G-04, G-05 y G-06 → RESUELTOS por la publicación v2.16.0.

## 0.11.1 — Modo demo: simular tarjeta (sin iframe de Stripe) (2026-07-22)

Extiende el modo demo (`?demo=1`) para que la grabación en navegador
automatizado no dependa de tipear en el iframe cross-origin de Stripe Elements
(el paso más frágil de automatizar). **Todo detrás del mismo flag; sin `?demo=1`
el pago sigue creando el `pm_` desde Elements como hoy.**

- **`DEMO_PM_ID = 'pm_card_visa'`** (`src/api/index.ts`): PaymentMethod de test
  de Stripe (Visa 4242, aprueba sin 3DS). Token público de test; nunca se usa
  sin el flag.
- **Garantía** (`CreateMesaFlow`): en demo se saltea `createCardPaymentMethod`
  y se manda `stripe_payment_method_id: pm_card_visa` (se mantiene el
  `setup-intent` que crea el cliente Stripe lazy). El campo de tarjeta se
  reemplaza por una nota "💳 Tarjeta de prueba ···· 4242 (demo)" y el botón deja
  de exigir `cardState.complete`.
- **Pago** (`MesaScreen`): idéntico — en demo el pago de la parte manda
  `pm_card_visa` en vez de crear el `pm_` desde el iframe.
- Verificado por curl contra el backend vivo: garantía y cobro con
  `pm_card_visa` = `succeeded`, sin 3DS.

## 0.11.0 — Modo demo sin cámara para grabar el video (2026-07-22)

Bypass de cámara para grabar el video-demo del comensal (aplicación YC) en un
navegador automatizado, que se traba en el escaneo: `getUserMedia`/el diálogo
de archivo nunca produce un frame. **Todo detrás de `?demo=1`; sin el flag la
app se comporta EXACTAMENTE igual que hoy. No toca el contrato ni el
happy-path.**

- **Flag `IS_DEMO`** (`src/api/index.ts`): se activa con `?demo=1` en la URL
  (`.../live/?demo=1`; también se lee dentro del hash). Se evalúa una vez al
  cargar.
- **Escaneo sin cámara** (`CreateMesaFlow`): en modo demo el botón pasa a ser
  **"🧾 Usar ticket de ejemplo"**, que genera una imagen mínima válida (JPEG
  8×8) y la manda al MISMO `POST /api/ocr` — el backend responde el ticket de
  ejemplo de siempre (La Parolaccia, $840, 6 ítems) y avanza a dividir. No hay
  ticket hardcodeado nuevo: mismo endpoint, mismo resultado, sin `getUserMedia`.
- **Cartel del mock oculto** en modo demo: se esconde el aviso amber
  "…todavía no leemos la foto de verdad…" que delataría la maqueta en cámara.
- **Bloque "Cuenta · saldo y movimientos" oculto** en el home en modo demo
  (sugiere wallet/prepago; fuera del encuadre).
- El pago sigue siendo Stripe real (no se tocó): la tarjeta de test se ingresa
  con Stripe Elements como siempre.

## 0.10.0 — Deploy real público + pago con tarjeta nueva (2026-07-22)

Para el video-demo del comensal (aplicación YC): dejar el front navegable en
una URL pública contra el backend vivo de Railway (v2.14.3).

- **Deploy dual en GitHub Pages** (`.github/workflows/deploy-demo.yml`):
  `/` sigue siendo la demo mock (feedback de diseño); `/live/` es el build real
  (`VITE_MOCK=0`) contra `payme-app-backend-production.up.railway.app`. La
  publishable key de Stripe la sirve el backend (`GET /api/config`), no va como
  variable. `VITE_RESTAURANT_ID` sale de la variable de repo homónima (G-01).
- **Pago con tarjeta nueva en la pantalla de pago** (`MesaScreen`): en modo
  real, un usuario sin tarjeta guardada ahora ingresa la tarjeta con Stripe
  Elements inline; se crea el `pm_` y se manda como `stripe_payment_method_id`
  (campo que el contrato de `POST /:code/pay` ya aceptaba). Antes la opción
  "Tarjeta" no recolectaba nada y el pago fallaba con `no_payment_source`.
  Cubre el paso "pagar con 4242" del video. 3DS ya estaba manejado.
- Registro confirmado **sin OTP/SMS**: `POST /auth/register` toma
  `{email, phone?, password, first_name, last_name}` y devuelve tokens.

## 0.9.0 — T7 (parte 1): Stripe.js integrado (2026-07-19)

Primera mitad de T7: todo el lado del front listo para hablar con el backend
real. Falta levantar el backend (requiere PostgreSQL) para verificar de punta
a punta.

- **Nueva dependencia: `@stripe/stripe-js` 9.10.0** — única del proyecto
  además de React, alcance ratificado por Mati. Sin wrapper de React: los
  Elements se montan a mano (`src/components/CardField.tsx`) para no sumar una
  segunda librería.
- Carga **diferida**: Stripe queda en un chunk aparte de 2,7 kB que la demo
  (`VITE_MOCK=1`) no descarga nunca. La clave publicable se pide a
  `GET /api/config`; la secreta jamás sale del backend.
- `confirmGuarantee3ds` real: confirma el 3DS y **sondea la mesa** hasta que
  deja `pending_auth` — el cambio lo hace el webhook, no la respuesta de
  Stripe, así que sin el sondeo se compartía el link con la mesa sin abrir.
- 3DS también en el **pago** (`requires_action` en `POST /:code/pay`), que
  antes se daba por cobrado sin confirmar.
- Alta de tarjeta real: SetupIntent → Elements → `POST /payment-methods`.
- **G-02** (login no devuelve `user`): se guarda el email tipeado y
  `utils/identity.ts` deriva el nombre para saludar, con la deuda documentada.
- **G-01** (no hay endpoint de restaurantes): el `restaurant_id` sale de
  `VITE_RESTAURANT_ID` con mensaje de error explícito si falta.
- `scripts/t7-setup-db.sh` + `scripts/T7_RUNBOOK.md`: preparan la base local,
  corren las 4 migraciones y siembran el restaurante. **No tocan ni un archivo
  del backend** (repo de solo lectura).
- Fix: la banda de demo se perdía al hacer scroll (la altura de viewport
  estaba duplicada entre `.app` y `.screen`).

### Gaps nuevos encontrados al integrar
- **G-04 (bloqueante para la garantía con tarjeta)**: `POST /mesas` exige un
  `stripe_payment_method_id` (`pm_…`) que `GET /payment-methods` **no
  devuelve**. No se puede garantizar una mesa con una tarjeta ya guardada: hay
  que tipearla cada vez. `POST /:code/pay` sí acepta el id interno, así que la
  asimetría parece un descuido del contrato.
- **G-05**: consecuencia del anterior para las tarjetas guardadas.

## 0.8.0 — Revisión previa al feedback de diseño (2026-07-19)

Aplicación de los 47 hallazgos confirmados por una revisión multi-agente
(83 crudos → 47 tras verificación adversarial). Todo lo que no es decisión
estética quedó resuelto.

**Nada del contrato se filtra ya a la pantalla** (`src/utils/labels.ts`):
- Estados de mesa en español ("Falta pagar" en vez de `partially_paid`), con
  el color del badge acorde a la tarjeta.
- Movimientos del wallet con etiqueta humana en vez de `payment_mesa`.
- Pantalla de cobro sin `pending`/`succeeded`/`processed`: "Confirmando el
  cobro → Acreditando en la mesa → Listo".
- Fuera "Tier 7", "backend", "OCR", "3-D Secure", "modo mock" de los textos.

**Sin callejones sin salida**:
- El invitado ya no puede quedar atrapado: `navigate('home')` reescribía el
  hash sin el token `?t=` y lo expulsaba al login perdiendo el link. Ahora
  las pantallas de invitado no ofrecen salidas que rompan su acceso, y la
  mesa cerrada siempre muestra barra de acción.
- El paso 3DS tiene botón de volver y de cancelar (antes la única salida era
  autorizar, con la mesa ya creada sin garantía).
- Si no queda nada por tomar, el botón lo dice en vez de pedir lo imposible.

**Demo creíble de punta a punta**:
- El estado persiste en `localStorage` (`payme_mock_state_v1`): recargar ya
  no borra mesas, pagos ni saldo. Botón "Reiniciar la demo" en Perfil.
- Un link de invitación abierto en OTRO dispositivo funciona: la mesa se
  materializa con el ticket de ejemplo en vez de dar "no encontrada".
- La vista de invitado se puede ver estando logueado (antes era inalcanzable
  para quien evalúa), con aviso "Así lo ve quien recibe tu link".
- Banda persistente "Demo · datos de ejemplo, no se cobra dinero real" y
  aviso explícito en la pantalla de pago.
- Números coherentes: la garantía de PA-1099 es por saldo (su débito estaba
  contradicho), la transferencia de Juan tiene su movimiento y la cadena de
  saldos cierra en $1,250; los slots usan `splitEqual` como el backend.
- El saludo toma el nombre de quien entra, no el del usuario de ejemplo.
- "Saldo disponible" → "Tu saldo PayMe" (G-03: el contrato no expone el
  saldo retenido, así que no se puede afirmar que esté disponible).

**Accesibilidad**: contraste AA en countdown, badges, placeholders y textos
sobre navy (`--orange-txt`, `--teal-txt`, `--gray-txt`); `role="radiogroup"`
en métodos de pago y propina; `role="alert"` en errores; `role="status"` en
cobro y toasts (siempre montados); `aria-label` en botones de ícono;
`aria-hidden` en emojis decorativos; `<h1>` real en cada pantalla;
checkboxes decorativos ocultos al lector; barras de progreso con ARIA.

**Consistencia**: clases `.btn-sm` y `.caption` en vez de nueve overrides
inline distintos; terminología unificada en "consumos".

## 0.7.0 — Funcionalidades restantes del contrato + demo compartible (2026-07-18)

- **Avisos** (`GET /notifications` + `unread-count` + `read-all`): inbox con
  no-leídos, campanita con badge en el home.
- **Invitaciones in-app** (`GET /invitations` + `accept`): tarjeta en el home
  y en Avisos; aceptar te lleva a la mesa del que te invitó (mesa seed PA-4520
  de Sofía, partes iguales).
- **Estadísticas del mes** (`GET /account/stats`): gastado / salidas /
  promedio + restaurante favorito en Cuenta → Historial.
- **Tarjetas**: hacer principal (`PATCH /:id/default`) y quitar (`DELETE`).
- **Amigos**: quitar amigo con confirmación. **Grupos**: quitar miembro y
  eliminar grupo.
- Workflow de deploy del demo mock a GitHub Pages (`deploy-demo.yml`).

## 0.6.0 — T6 (2026-07-18)

- Estados vacíos en mesas/movimientos/amigos/grupos; mensajes de error en
  español mapeados desde los códigos reales del contrato (`insufficient_funds`
  con disponible/requerido, `wallet_requires_auth`, `item_already_locked`,
  `guarantee_failed`, `mesa_not_payable`, `no_slots_available`).
- Accesibilidad: aria-labels en botones de ícono, `role=status` en toasts,
  inputs ≥16px (sin zoom iOS), safe-areas notch, targets táctiles grandes.

## 0.5.0 — T5 (2026-07-18)

- Cuenta (`s-account`): saldo, tabs Historial (wallet-transactions con los 11
  tipos reales) y Tarjetas (payment-methods).
- Cargar (`s-topup` + **A-3**): OXXO con voucher y vencimiento, tarjeta con
  acreditación inline, y **SPEI** con CLABE virtual (`GET /api/wallet/clabe`),
  límites reales $50–$10,000.
- Transferir (`s-transfer`): amigo + monto + concepto, idempotencia, manejo de
  `402 insufficient_funds`.
- Amigos (`s-friends`): lista, búsqueda, alta por email/payme_id.
- Grupos (`s-groups`): lista, detalle con miembros, crear, sumar amigos.
- Perfil (`s-profile`): identidad, accesos, cerrar sesión, nota G-02.

## 0.4.0 — T4 (2026-07-18)

- Pago (`s-payment`): propina 0/10/15/20% al mozo elegido (staff real de la
  mesa), métodos saldo/tarjeta/Apple Pay, `idempotency_key` por intento.
- Procesando (`s-processing`): estados reales `pending → succeeded → processed`.
- Comprobante (`s-confirm`) con desglose ítems/propina/total.
- **Expirada A-2** (`s-expired`): "Cubrió tu garantía $X · Recibió el
  restaurante $TOTAL" — semántica nueva, la maqueta decía lo contrario.
  Demo: botón "ver qué pasa si expira" → mesa PA-1099.

## 0.3.0 — T3 (2026-07-18)

- **Invitado por link (momento mágico)**: `#/mesa/:code?t=token` entra SIN
  cuenta ni login; banner "Te invitaron a", selección con lock, pago solo con
  tarjeta/Apple Pay (saldo pide cuenta — `wallet_requires_auth`), comprobante
  con invitación a crear cuenta.

## 0.2.0 — T2 (2026-07-18)

- Mesas Abiertas (`s-open`) con progreso, countdown vivo y estados reales.
- Wizard del organizador: scan-mock (`s-scan`) → ticket (`s-ticket`) →
  división consumo/igual con stepper de comensales (`s-division`) →
  **"Garantizá la mesa" (A-1, pantalla nueva)**: card con `requires_action`/3DS
  simulado o wallet (congela saldo; `402` con disponible/requerido si no
  alcanza) → compartir link/WhatsApp (`s-share`, link una sola vez).
- Detalle de mesa: mis ítems con lock (`s-myitems`), ítems pagados/tomados por
  otros, slots de división igualitaria, invitar desde la mesa.
- Mock con reglas del contrato: store en memoria con garantía, saldo retenido,
  locks, slots FIFO, expiración con captura de faltante (A-2).

## 0.1.0 — T1 (2026-07-18)

- T0: `contract-mirror/` construido desde `../payme-app-backend` v2.13 (schemas,
  16 rutas, auth middleware, money/stateMachine, schema.sql, docs) con README de
  procedencia y resumen del contrato verificado. Gaps G-01/G-02/G-03 anotados en
  `GAPS.md`.
- Esqueleto Vite + React 18 + TypeScript estricto, espejo del stack del
  dashboard frontend (mismas versiones, cero librerías de UI).
- Router propio por hash (`src/router.ts`) con soporte de `?t=` dentro del hash
  (preparado para el link de invitado de T3).
- Fachada de datos `src/api/` con adaptador mock (`VITE_MOCK=1`) que replica
  los shapes reales del contrato; cliente HTTP real con refresh token rotativo
  según `README_v2.5.2` (el refresh viejo se reemplaza SIEMPRE).
- `src/utils/money.ts`: réplica exacta y tipada de `utils/money.js` del backend
  (procedencia documentada). `format.ts` solo para presentación.
- Auth según contrato: login / registro / logout / restauración de sesión.
  G-02 respetado: el login real no trae `user` (saludo genérico en ese caso).
- Shell de navegación completo + Home (maqueta `s-home`) con saldo real
  (`GET /account/balance`) y contador de mesas abiertas (`GET /mesas/open`).
  Pantallas de tiers futuros como stubs navegables.
- CI: GitHub Actions con typecheck + build.
