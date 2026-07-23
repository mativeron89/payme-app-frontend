# CHANGELOG — payme-app-frontend

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
