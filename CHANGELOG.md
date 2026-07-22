# CHANGELOG — payme-app-frontend

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
