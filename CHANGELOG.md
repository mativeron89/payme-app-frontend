# CHANGELOG — payme-app-frontend

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
