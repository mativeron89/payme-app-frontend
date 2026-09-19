# Estudio · abrir mesa sin QR y el cambio de cuenta de Google

**Orden:** `APP-OPEN-MESA-AND-GOOGLE-SWITCH-STUDY-AF-40-20260919` (sha256 `0abadb3d…736c`) ·
**Decisión:** `DECISION_MATI_MESA_SIN_QR_Y_RESTAURANTE_DESDE_EL_TICKET_20260919.md` (sha256 `c43a2d9d…b5c9`) ·
**Hallazgos de partida:** `ops/bibliotecario-claude-20260917/LIVE_VERIFICADO_APP_PRUEBA_DEL_DUENO_20260919.md` (H1–H5).

**Base medida:** `payme-app-frontend` `13800c920c288e7c582efa2414b09b0dc07dff39` (= `origin/main`, lo
servido). Escrito por App Frontend - Opus el 2026-09-19. **Es un estudio de sólo lectura: no cambia
código de producto. Lo construye Codex.** Las reproducciones corrieron en el mock local
(`VITE_MOCK=1`, Playwright, sin red externa) con un spec temporal que NO se commitea; su salida
está en la carpeta de evidencia de la orden. No se sondeó `app.paymemx.com`.

Cada afirmación lleva su grado: **MEDIDO** (lo corrí o lo leí en el código de esta base),
**LEÍDO** (lo dice el código, no lo ejercité) o **HIPÓTESIS** (falta una medición, y se dice cuál).

---

## 1 · H1 · la mesa no se abre y no avisa

### Veredicto: la lectura del Bibliotecario es correcta, y el defecto es MÁS ANCHO

- **MEDIDO · de dónde sale el restaurante.** `src/screens/CreateMesaFlow.tsx:283-287`:
  `QR_RESTAURANT_ID ?? (IS_MOCK ? MOCK_RESTAURANTS[0].id : VITE_RESTAURANT_ID ?? '')`.
  `QR_RESTAURANT_ID` es `?r=` en la query o en el hash, **leído una sola vez al cargar el módulo**
  (`src/api/index.ts:167-176`). En producción, sin QR y sin variable de build, `restaurantId` es
  `''`; el efecto de `:302-317` pone `restaurantError` y **no pide nada al backend**. Eso coincide
  con los registros: nunca hubo `GET /restaurants/:id`.
- **MEDIDO · el corte.** `createMesa()` (`:742`) llega a `if (!restaurant) { setError(restaurantError …); return; }`
  (`:880-884`) y vuelve sin pedir la mesa. Coincide con que nunca llegó un `POST /api/mesas`.
- **MEDIDO · por qué no se ve.** El paso `ticket` («¿Cómo dividen?», `:1359-1706`) **no dibuja
  `error` ni `restaurantError`**: ninguno aparece en ese bloque. Sólo los dibujan el paso `scan`
  (`:1188` y el aviso naranja de `:1197`) y el paso `garantia` (`:1732`). Con el dinero apagado,
  «Continuar» llama a `createMesa()` **desde el paso `ticket`** (`:1698`) y nunca cambia de paso
  si algo falla.
- **MEDIDO · reproducido en el navegador (mock).** Riel de dinero apagado y
  `?r=00000000-0000-4000-8000-00000000dead`: en el paso de escanear se ve el aviso naranja «Este QR
  no corresponde a un restaurante disponible.». En «¿Cómo dividen?», **tres toques en «Continuar»:
  la URL no cambia, no hay ningún `role="alert"`, el aviso naranja ya no está y no se crea ninguna
  mesa** (las mesas del mock siguen en 4). El control con restaurante abre la mesa y llega a
  «Compartir la mesa». Capturas `h1-01-scan-con-aviso.png` y `h1-02-dividen-sin-aviso.png`.

### La CLASE: todo lo que `createMesa()` dice por `setError` es invisible desde «¿Cómo dividen?»

Con el dinero apagado, cada uno de estos cortes deja a la persona tocando «Continuar» sin respuesta
(LEÍDO en esta base, `CreateMesaFlow.tsx`):

| # | Línea | Cuándo pasa | Qué dice (no se ve) |
|---|---|---|---|
| 1 | `:755-758` | la identidad segura del actor todavía no está o falló | «Preparando una identidad segura…» / «No pudimos verificar…» |
| 2 | `:760-765` | la verificación de una apertura anterior está en curso o falló | «Estamos verificando…» / «No pudimos descartar…» |
| 3 | `:780-783` | hay una apertura congelada de otra sesión | «Esta apertura pertenece a una sesión anterior…» |
| 4 | `:880-884` | **sin restaurante (H1)** | «No pudimos identificar el restaurante: entra desde el QR de la mesa.» |
| 5 | `:948-951` | 2xx con una mesa que no quedó abierta | «La garantía sigue en verificación…» |
| 6 | `:971-1007` | el `POST /api/mesas` falla: 409 de reconciliación, `idempotency_key_terminal`, `idempotency_conflict`, cualquier 4xx, 5xx, red o timeout | cinco textos distintos, ninguno visible |

Fuera de la clase: `guarantee_failed` (`:973`) no se da sin garantía, y el guard de tarjeta
(`:787-793`) no dispara porque `cardChoice` nace `'new'` (`:218`); además avisa con un `toast`.
El #6 es el más serio para la etapa que viene: **cuando el backend esté caído, lento o rechace
la mesa, la persona tampoco se va a enterar**, y en el caso ambiguo (5xx/red) el texto oculto es
justamente el que le pide que reintente la MISMA apertura y no arme otra.

**Arreglo mínimo que se propone (para Codex):** dibujar `error` en el paso `ticket` con el mismo
`form-error role="alert"` que ya usan `scan` y `garantia`, junto al botón que lo produce. Y, antes
del botón, **no dejar avanzar sin restaurante**: si `restaurantError` está puesto, mostrarlo en el
paso `ticket` y deshabilitar «Continuar» con esa explicación. Una vez que exista la mesa sin QR
(§3), la segunda parte cambia; la primera queda igual.

### Por qué ningún e2e lo cazó

- **MEDIDO:** en mock `restaurantId` es siempre `MOCK_RESTAURANTS[0].id` (`:285`), que existe. El
  único camino a «sin restaurante» es un `?r=` inválido, y ningún spec lo recorre con el dinero
  apagado. Los e2e de mesa sin garantía (`e2e/mesa-sin-garantia.spec.ts`, `abrirMesaConLink` en
  `e2e/_app.ts:76`) recorren el camino feliz.
- **Ninguna prueba ejercita un fallo de `createMesa()` en el modo sin garantía.** Los que existen
  miran el paso de garantía, que sí dibuja `error`.

**Tests que lo habrían cazado** (los escribe quien construya):

1. e2e: dinero apagado + `?r=` inexistente → escanear → «Continuar» en «¿Cómo dividen?» ⇒ **se ve
   un `role="alert"` que nombra el restaurante** y el botón está deshabilitado o explica por qué.
   Es la reproducción de esta orden, con la aserción al revés.
2. e2e: dinero apagado + costura del mock que haga fallar `POST /mesas` (500 y 409) ⇒ se ve el
   texto de cada caso en el paso `ticket`, y el 500 no abre una segunda mesa al reintentar.
3. Guarda estructural: cada `setError(` alcanzable desde `createMesa()` tiene un paso que lo
   dibuja; fallar si un paso que llama a `createMesa()` no renderiza `error`.

---

## 2 · Paso 4 bis · con `?r=<uuid>` «Tampoco»

### Lo que el front hace con `?r=`

- **MEDIDO · sobrevive al login.** Abrir `/?r=<uuid>` sin sesión, entrar (email en el mock) y
  tocar «Nueva»: la URL después del login sigue siendo `…/?r=<uuid>`, y el ticket muestra ESE
  restaurante («Hanzo Sushi», el segundo del mock, no el default). El login de Google usa
  `ux_mode: 'popup'` (`src/api/googleIdentity.ts:203-209`): la página de PayMe **no se recarga ni
  navega**, así que tampoco puede perder la query. **LEÍDO:** ninguno de los que limpian la URL la
  toca: `signupInvitation.ts:121-140` («conserva `t`, `r` y cualquier otro dueño»),
  `facebookAuthFlow.ts:225-245`, `recoveryFlow.ts:109-120` y `router.ts:157-160` rearman la URL
  con el resto de la query.
- **MEDIDO · el service worker no interviene:** no atiende navegaciones
  (`src/sw/serviceWorker.js:58`, `request.mode === 'navigate'` ⇒ `return false`).
- **MEDIDO · el `?r=` se lee UNA vez, al cargar la página.** Con la app ya abierta, cambiar sólo
  el hash a `#/home?r=<uuid>` **no cambia nada**: el mock siguió mostrando su restaurante por
  defecto. En producción eso sería `''` y el corte de H1. Una query nueva (`/?r=`) siempre recarga
  el documento y entonces sí se lee.
- **LEÍDO · lo que sí pierde el `?r=`:**
  1. La PWA instalada abre `start_url: "/"` (`public/manifest.webmanifest`), sin query. Si Mati
     entró tocando el ícono y no el link, no había `?r=`.
  2. El regreso de Facebook (`LoginScreen.tsx:944`, redirección completa) vuelve a una URL de
     retorno fija. Facebook está oscuro hoy, así que no aplica a la prueba.
  3. Un link a `paymemx.com/?r=…` (la landing) no lleva la query al botón que abre la app.

### Lo que dicen los registros del backend, y lo que NO pueden decir

- **LEÍDO en el dueño** (`payme-app-backend` `8aa0b73`, `server.js:255-264`): el middleware
  `request` registra **toda** petición que pasa por `express.json`, con método y path, incluido
  `GET /api/restaurants/:id`. Una petición que hubiera llegado habría quedado registrada.
- **El hallazgo del Bibliotecario mira los registros «hasta las 17:53Z»**, y el paso 4 quedó
  anotado a las 17:52:59Z. **Si el 4 bis se hizo después de 17:53Z, esa ventana no lo cubre.**

### Causa · **SIN DETERMINAR con lo que hay: HIPÓTESIS, y cómo cerrarla**

En la base servida, un documento que carga con `?r=` en la URL pide `GET /api/restaurants/<id>`
al abrir «Nueva» (MEDIDO en mock; el código es el mismo con otro transporte). Que no aparezca
admite tres causas, en este orden de probabilidad:

1. **El `?r=` no estaba en la URL del documento que se usó:** se abrió desde la PWA, desde otra
   pestaña ya cargada, o desde la landing.
2. **La ventana de registros no cubrió el intento** (terminó a las 17:53Z).
3. El `<uuid>` venía en un formato que el front no leyó (por ejemplo, `?R=` o dentro de otro
   parámetro). Ni siquiera un uuid inválido habría evitado el `GET`.

**Para cerrarla hacen falta dos cosas, y ninguna es mía:** (a) que Mati diga la URL exacta y
desde dónde la abrió (link en Safari/Chrome, ícono de la PWA, otra pestaña); (b) los registros de
Railway filtrados por `path` que empiece con `/api/restaurants/` desde las 17:50Z hasta el final
de la prueba. **Aunque el `?r=` hubiera funcionado, cualquier otro fallo del `POST` habría sido
igual de mudo (§1, #6):** el 4 bis no descarta que el restaurante sí se haya leído y otra cosa
haya fallado. Por eso el arreglo de §1 va primero, sea cual sea la causa del 4 bis.

---

## 3 · Abrir mesa escaneando el ticket, sin QR · qué necesita la pantalla

Mati, literal: *«que el scan del ticket muestre los consumos y el restaurnte si es posible»*.
**No se diseña contrato acá: eso lo estudia el backend (AB-33).** Esto es lo que la pantalla
necesita recibir y cómo lo mostraría.

### Qué dato nuevo del dueño hace falta (lo pide la pantalla, lo decide AB-33)

1. **En la respuesta del OCR, un restaurante leído del ticket**, con su grado. Hoy
   `respuestaOcr` publica sólo `items`, `total_cents`, `total_detected_cents`, `warnings` y `mock`
   (`contract-mirror/services/ocrResponseContract.js:63-87`), y el decodificador del front exige
   claves exactas (`src/api/contractResponses.ts:198-206`). La pantalla necesita distinguir **tres
   casos, no dos**:
   - `catalogo`: el ticket coincide con un restaurante de PayMe → `id` + nombre + categoría;
   - `leido`: se leyó un nombre que no está en el catálogo → sólo el nombre, sin id;
   - `ninguno`: no se leyó nada.
   El campo tiene que ser **aditivo y opcional** para que un front anterior no rompa, y el front lo
   tiene que exigir con claves exactas como el resto.
2. **Que `POST /api/mesas` acepte una mesa sin `restaurant_id`** o con el candidato del ticket.
   Hoy `createMesa` exige `restaurant_id: uuid` (`contract-mirror/schemas/index.js:319-324`). Qué
   se guarda, qué va al Dashboard y qué pasa con las estadísticas por restaurante lo decide
   AB-33, no la pantalla.
3. **Que las lecturas que hoy dan por hecho un restaurante acepten uno ausente.** Las superficies
   que leen `restaurant.name`/`restaurant_name` son 9 (LEÍDO, `grep` sobre `src/` sin tests ni
   mock): `CreateMesaFlow`, `MesaScreen`, `HomeScreen`, `JoinMesaScreen`, `AvisosScreen`,
   `QueComesScreen`, `invitacionAdmision.ts`, `movementDetail.ts` y `types.ts`. Cada una necesita
   un texto para «sin restaurante identificado». Las estadísticas por cocina lo tratarían como
   `other`.

### Pantallas y estados que cambian

- **Escanear (`scan`):** el aviso naranja «entra desde el QR» deja de ser un error cuando no hay
  QR; pasa a ser neutro y sólo aparece si el QR vino roto (404).
- **«¿Cómo dividen?» (`ticket`):** arriba del ticket, una línea del restaurante con su grado:
  - por QR: «La Parolaccia» (como hoy);
  - por ticket, en el catálogo: «La Parolaccia · según el ticket»;
  - por ticket, fuera del catálogo: «“Taquería El Güero” · leído del ticket, sin verificar»;
  - sin dato: «Restaurante sin identificar». Si Mati lo decide, el nombre se puede corregir a mano
    ahí mismo, marcado como «escrito por ti».
  - Y el `error` visible junto a «Continuar» (§1), en todos los casos.
- **Compartir, la mesa, Inicio, Avisos, «Tus mesas»:** el mismo rótulo con su grado, o «Mesa sin
  restaurante» cuando no hay nombre.
- **Ticket de ejemplo (H3):** la respuesta del OCR ya trae `mock: true`, y el front lo decodifica
  pero **no lo muestra** (`contractResponses.ts:206`; `CreateMesaFlow.tsx:662-690` no lo lee).
  Mientras el OCR real no esté encendido, la pantalla debería decir «Ticket de ejemplo: la
  lectura real todavía no está activa». **Es un arreglo sólo de front, independiente de AB-33**,
  y evita que alguien crea que se leyó SU ticket.

### Cómo convive con el QR cuando exista

**El QR gana, siempre.** Es el único dato verificado: lo imprime el restaurante. Si el ticket
dice otro nombre, se muestra el del QR y no se pregunta. Sin QR, el ticket. Sin ninguno, «sin
identificar». El `?r=` sigue leyéndose al cargar, y conviene leerlo también al montar
`CreateMesaFlow` (hoy es sólo al cargar; ver §2) para que un QR escaneado con la app ya abierta
no se pierda.

---

## 4 · H2 y H5 · Google (`ux_mode: 'popup'`)

**LEÍDO:** `src/api/googleIdentity.ts:10-16` y `:203-209` inicializan GIS con
`ux_mode: 'popup'`, `auto_select: false` y `button_auto_select: false`, y el botón es el de
Google (`renderButton`, `:347-357`). No hay `disableAutoSelect` ni `revoke` de Google en ningún
lado; el único `revoke` del front es de otra cosa (`profileIdentity.ts:225`). `vercel.ts:44-58`
no pone `Cross-Origin-Opener-Policy`, así que la ventana conserva su `opener`. Que el primer
ingreso funcione lo confirma.

### H2 · «400 malformed» en una pestaña vieja (iPhone/Chrome)

**HIPÓTESIS con buena base.** En iOS una ventana emergente es una **pestaña más**. La de Google
se abre con parámetros de un solo uso para ESE intento. Cuando el ingreso termina, Google no
siempre cierra la pestaña en iOS, y volver a ella la recarga con parámetros ya consumidos: el
400 es de Google, no de PayMe. **No afecta el ingreso** (Mati volvió a PayMe y entró). Para
confirmarla: repetir en iPhone/Chrome y mirar si la pestaña sobrante es
`accounts.google.com/gsi/…`.

### H5 · en Safari, «Usar otra cuenta» no avanza

**SIN DIAGNOSTICAR: no lo pude reproducir** (no hay Safari de iOS acá). Hipótesis, en orden:

1. «Usar otra cuenta» saca a la ventana del flujo de GIS hacia el login de Google (varias
   navegaciones de dominio a dominio). En Safari la ventana puede perder el camino de vuelta
   hacia PayMe (el `postMessage` al `opener`) o quedar sin cookies de Google por la protección
   contra rastreo, y queda quieta.
2. La cuenta nueva tiene que aceptar algo (consentimiento, verificación) y esa pantalla no se ve
   bien dentro de la ventana.

**Cómo medirlo:** Safari de macOS (el mismo motor) con el inspector abierto sobre la ventana de
Google: ver en qué URL se queda y qué dice la consola. Sin eso, cualquier arreglo es a ciegas.

### Opciones (ninguna toca la guarda 8 del 26/08: el alta sigue copiando nombre y correo una sola vez)

| Opción | Qué resuelve | Riesgo / costo |
|---|---|---|
| **A · Aviso honesto + cambiar de cuenta a mano.** Debajo del botón: «¿Otra cuenta? Cierra la sesión de Google en este navegador y vuelve a tocar». Sólo front. | H5 con un rodeo; H2 no cambia | Barato y seguro. Traslada el trabajo a la persona. |
| **B · Redirección de GIS (`ux_mode: 'redirect'`).** Google vuelve a PayMe con la credencial por POST a una `login_uri`. | H2 (no hay ventana) y H5 (Safari maneja bien las redirecciones) | **Toca backend:** una ruta nueva con doble cookie contra CSRF (`g_csrf_token`). Se pierde el estado de la página (`?r=`, el alta en curso), que hay que llevar en `state`. |
| **C · OAuth 2.0 con código y `prompt=select_account`,** el mismo patrón que ya usa Facebook (`LoginScreen.tsx:944`: redirección completa). | H2 y H5, y **siempre** muestra el selector de cuentas | **Toca backend:** intercambio de código con el secreto del cliente y alta en la consola de Google. Es el más sólido, y el mismo camino que ya existe para Facebook. |
| **D · Un botón propio «Cambiar de cuenta» con `disableAutoSelect`/`revoke`.** | **Nada de H5.** `disableAutoSelect` sólo apaga la entrada automática de One Tap, que ya está apagada (`auto_select: false`); `revoke` quita el permiso a PayMe y vuelve a pedir consentimiento, pero no arregla la ventana. | Descartada: parece resolver y no resuelve. |

**Recomendación:** medir H5 primero (una hora en Safari de macOS). Mientras tanto, A. Si la
medición confirma que la ventana se pierde en Safari, C, porque reutiliza el patrón de Facebook y
arregla H2 de paso.

---

## 5 · Plan por etapas para Codex

1. **E1 · que no falle en silencio** (sólo front, chico, sin decisión nueva):
   - dibujar `error` en el paso `ticket`;
   - no dejar «Continuar» sin restaurante, con el motivo a la vista;
   - los tres tests de §1.
   Arregla H1 como «no avisa», no como «no se puede abrir».
2. **E2 · «Ticket de ejemplo»** (sólo front): mostrar el `mock: true` del OCR mientras el OCR real
   esté apagado.
3. **E3 · el `?r=` también al montar «Nueva»** (sólo front, chico), y cerrar el 4 bis con la
   medición de §2.
4. **E4 · mesa sin QR** (backend primero, owner-first): AB-33 define el restaurante del OCR y la
   mesa sin `restaurant_id`; después el front adopta el espejo y construye §3.
5. **E5 · Google en Safari:** medir H5 y después A o C según lo que decida Mati.
6. **Fuera de esta orden y de este front:** encender el OCR real (AWS Textract), que es de
   Mati/Codex con límite y canary.

---

## 6 · Preguntas para Mati (cerradas; la recomendada va primera)

**P1 · Mientras no exista la mesa sin QR, ¿qué hacemos cuando falta el restaurante?**
1. **Avisar y no dejar seguir (Recomendada).** «No pudimos identificar el restaurante: entra
   desde el QR de la mesa», a la vista, y el botón frenado.
2. Dejar abrir la mesa igual con un restaurante de prueba fijo, sólo mientras dure la prueba.
3. Esperar a que exista la mesa sin QR y no tocar nada ahora.

**P2 · Cuando el ticket no dice el restaurante o no lo encontramos, ¿qué muestra la mesa?**
1. **«Restaurante sin identificar», y la mesa se abre igual (Recomendada).**
2. Pedirle a quien abre la mesa que escriba el nombre, marcado «escrito por ti».
3. No dejar abrir la mesa sin un restaurante del catálogo.

**P3 · Mientras el lector de tickets sea de ejemplo, ¿lo decimos en pantalla?**
1. **Sí: «Ticket de ejemplo: la lectura real todavía no está activa» (Recomendada).**
2. No: se ve igual que un ticket real.
3. Apagar el escaneo hasta que el lector real esté encendido.

**P4 · Cambiar de cuenta de Google en Safari: ¿cómo seguimos?**
1. **Primero medir en Safari qué pasa, y mientras tanto un aviso de cómo cambiar de cuenta
   (Recomendada).**
2. Pasar ya a la entrada de Google por redirección, como la de Facebook (toca backend).
3. Dejarlo como está: con la cuenta de siempre funciona.

---

### Evidencia

`/Users/matiasveron/.codex/runs/payme-app-open-mesa-google-study-af-20260919/`:
- `repro.txt`: salida de las cuatro sondas;
- `capturas/`: H1 en el paso de escanear y en «¿Cómo dividen?».

El spec temporal que las produjo no se commitea. Búsqueda web sobre GIS y Safari: sin un
resultado concluyente, y por eso H5 queda SIN DIAGNOSTICAR; se consultó la referencia de
`ux_mode` de Google (https://developers.google.com/identity/gsi/web/reference/js-reference).
