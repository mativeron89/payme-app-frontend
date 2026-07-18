# PayMe Backend v2.10 — Consolidado (app de comensales)

Carpeta **autocontenida** con TODO el backend de la app de comensales al día: base
v2.5.2 + cobro **garantizado (Modelo B)** + **abono SPEI** + fixes de v2.9 + PASE3 +
**Opción 1 (FINDING A)**. Node 18+ · Express · CommonJS · PostgreSQL 14+ · Stripe + STP.

> **⚠️ SIN VERIFICAR POR ENTORNO.** Acá no se puede ejecutar/CI/testear. Todo el código
> va a **PR + CI + tests + demo de STP/Stripe** antes de producción. Esto NO garantiza
> cero bugs: es una base auditada estáticamente con los parches conocidos aplicados o
> documentados.

---

## 1. Estructura (todo presente, en su lugar)

```
PayMe_Backend_v2.10_Consolidado/
├── server.js                ✏️ mounts abono + v2.10
├── package.json             ✏️ v2.10 + scripts migración
├── .env.example             (copia v2.5.2 — ver §6 vars nuevas)
├── README_v2.10_CONSOLIDADO.md   ← este archivo
├── README_v2.5.2.md         (referencia)
├── PATCHES_garantia.md      (parches §1/§2/§3/§4/§5 — garantía)
├── FINDING_A_opcion1.md     (parche Opción 1 + guard)
├── AUDITORIA_PASE3.md        (hallazgos A/B/C)
├── db/      pool.js · schema.sql · migrate_v2.5.0_to_v2.5.2.sql · migrate_garantia_v2.9_hardened.sql · migrate_abono_spei_v2.8.sql
├── middleware/  auth.js · envValidation.js
├── utils/   stateMachine.js✏️ · money.js · logger.js · idempotency.js · tokens.js · userId.js
├── schemas/  index.js
├── services/ paymentProcessor.js · settlement.js · stripe.js · stp.js · stpAbono.js · walletFunding.js · notifications.js✏️ · timer.js✏️ · stripe-oxxo.js · matching.js
├── routes/   mesas.js · webhooks.js · spei-funding.js · stp-webhook.js · auth.js · account.js · payment-methods.js · friends.js · groups.js · invitations.js · ocr.js · topup.js · transfers.js · staff.js · notifications.js · config.js
└── tests/    garantia.test.js · abono.test.js · integration*.test.js (4) · stateMachine · money · logger · userId · division-igualitaria
```
✏️ = reescrito en esta versión con su parche ya integrado.

---

## 2. Qué quedó YA INTEGRADO (no hay que tocar nada)

| Archivo | Cambio |
|---|---|
| `utils/stateMachine.js` | **FINDING B**: `TRANSITIONS.mesa` extendido (pending_auth, settling, settled, dispersing, completed, auth_failed). Aditivo (no puede romper transiciones previas). |
| `services/notifications.js` | Tipos nuevos `mesa_shortfall_charged` (BUG3) y `mesa_garantia_impagos` (Opción 1). |
| `services/timer.js` | **§4**: `settlement.sweepSettlements()` enganchado al tick (después de expirar mesas). |
| `server.js` | Mounts `/webhooks/stp` y `/api/wallet` (abono SPEI) + versión 2.10. |
| `package.json` | v2.10.0 + scripts `migrate:garantia`, `migrate:abono`. |
| `services/stripe.js` | Reescritura v2.9: agrega `capturePaymentIntent`, preserva todos los exports previos. |
| `services/stp.js` | Dispersión SPEI (firma RSA-SHA256, `dispersarSPEI`). |
| `services/stpAbono.js` + `routes/spei-funding.js` | **FINDING C**: `crearClabeVirtual` acepta `client` y corre en la tx (sin agotar el pool). |
| `services/walletFunding.js` | **BUG1**: INSERT en `topups` incluye `net_cents` + `idempotency_key`. |
| `services/settlement.js` | **BUG2** ya corregido (`cancelIntent(pi,'abandoned')`). *(Le falta Opción 1 → §3.)* |
| `db/migrate_garantia_v2.9_hardened.sql` | Migración endurecida (DO-block que dropea el CHECK de `mesas.status` por cualquier nombre). |

---

## 3. Qué FALTA APLICAR — 5 parches (archivos copiados tal cual + parche en doc)

**Por qué van como doc y no “inline”:** son los archivos del camino del dinero más
grandes (`mesas.js` 31KB, `webhooks.js` 20KB, `settlement.js` 19KB, `paymentProcessor.js`
24KB) o con validación condicional delicada (`schemas/index.js`). Reescribir a mano
20–31KB de código de pagos **que no puedo ejecutar ni testear** es la forma más fácil de
meter un bug invisible. Cada parche es chico y localizado, con anchors exactos; el dev lo
aplica, lo confirma con `git diff` y corre los tests. Preferí parche revisable antes que
archivo gigante reescrito a ciegas.

| # | Archivo | Parche | Dónde está |
|---|---|---|---|
| 1 | `routes/mesas.js` | **§1**: campos de garantía en el create + INSERT de columnas + `placeGuaranteeHold`. | `PATCHES_garantia.md` §1 |
| 2 | `schemas/index.js` | **§2**: `createMesa` con `guarantee_method` (requerido) + `payment_method_id`/`stripe_payment_method_id` + refine (card → necesita fuente). | `PATCHES_garantia.md` §2 |
| 3 | `routes/webhooks.js` | **§3**: interceptor `guarantee_auth` ANTES del `switch` + `handleGuaranteeAuthEvent`. **+ habilitar en Stripe el evento `payment_intent.amount_capturable_updated`** (§3.4). | `PATCHES_garantia.md` §3 |
| 4 | `services/settlement.js` | **Opción 1**: `cancelStaleAttemptsForMesa` + llamarla en `settleMesa` + notificación `mesa_garantia_impagos` al organizador. *(Si querés además cerrar el gap de audit-trail del FSM, hacé que `settleMesa`/`disperseMesa` llamen a `stateMachine.transition()` en settling/settled/dispersing/completed.)* | `FINDING_A_opcion1.md` (cambios 1–2) |
| 5 | `services/paymentProcessor.js` | **Guard FINDING A**: la condición que marca `fully_paid` solo dispara en estados pre-cierre (`open`/`partially_paid`). Una línea. | `FINDING_A_opcion1.md` (cambio 4) |

Sin §1/§2/§3 la **garantía** no funciona end-to-end (no se crea el hold, el schema
descarta los campos, y el webhook del hold no se rutea). Sin Opción 1 + guard, el caso de
pago tardío de FINDING A no está cubierto.

---

## 4. Orden de migración

```bash
# DB nueva:
npm run migrate:fresh        # schema.sql
npm run migrate:garantia     # migrate_garantia_v2.9_hardened.sql  (idempotente)
npm run migrate:abono        # migrate_abono_spei_v2.8.sql

# DB existente (v2.5.x):
npm run migrate              # = upgrade + garantia + abono, en ese orden
```
Las tres migraciones llevan `-v ON_ERROR_STOP=1` (obligatorio) y son idempotentes.

---

## 5. Deploy / checklist pre-piloto

1. Aplicar los **5 parches** del §3 (mesas, schemas, webhooks, settlement, paymentProcessor).
2. En **Stripe**: habilitar el evento `payment_intent.amount_capturable_updated` (lo usa el interceptor §3).
3. Setear las **env vars** de STP/CLABE (§6).
4. Correr migraciones (§4).
5. Correr tests: `npm test` (incluye `garantia.test.js` y `abono.test.js`).
6. **Demo de STP** para confirmar firma / CLABE / formato del callback (ver §7).
7. Revisar el **residual de FINDING A** y decidir manual-review vs reembolso automático.

---

## 6. Variables de entorno nuevas (garantía / abono)

`.env.example` está copiado tal cual de v2.5.2 (NO inventé nombres). El dev debe agregar,
**confirmando los nombres exactos contra `services/stp.js` y `services/stpAbono.js`**:

- Clave privada STP para firmar SPEI + su passphrase (firma RSA-SHA256 en `stp.js`).
- `CLABE_PREFIX` para las CLABEs virtuales (`stpAbono.js`, default `6461800000` → **confirmar con STP**).
- Secret opcional para validar el callback de abono (`X-Stp-Secret`, `stpAbono.validateAbono`).
- `guarantee_mode` por defecto en `true` (decisión D3).

---

## 7. Residual honesto (lo que esto NO cierra)

- **FINDING A (cola angosta):** un PI ya `processing` en el banco al cerrar la mesa **no se
  puede cancelar**; si confirma tarde, esa porción queda cobrada dos veces (al comensal y a
  la garantía del organizador). El guard (parche 5) evita el crash/loop, pero esa plata hay
  que devolverla. Recomendación: **revisión manual** primero, **reembolso automático** después
  (detalle en `FINDING_A_opcion1.md`).
- **STP:** orden de la cadena de firma, prefijo CLABE real, nombres de campos del callback y
  formato del ACK **no se pueden confirmar sin la documentación de STP + un demo**. Hasta
  entonces, lo de STP es “JS correcto pero sin confirmar contra STP”.
- **Node ≥18** obligatorio (`stp.js` usa `fetch` global).
- **Archivos reescritos** (`stateMachine`, `notifications`, `timer`, `server`): están
  reproducidos a partir del código auditado. Conviene un `git diff` contra el original para
  confirmar que solo cambió lo previsto.
- **Todo SIN VERIFICAR POR ENTORNO.** No reemplaza CI/tests/demo. No promete cero bugs.

---

## 8. Decisiones de producto congeladas (recordatorio)

- Cobro garantizado = **Modelo B** (pre-retención al organizador). Cubre **items_total**
  (ingreso del restaurante), **no** la propina.
- **D1**: si el organizador no puede cubrir el total al crear la mesa → 402 (bloquea).
- **D2**: pago con saldo = **congelar saldo** (`held_balance_cents`).
- **D3**: garantía **siempre** (`guarantee_mode` default true; `guarantee_method` requerido).
- **STP directo**, dispersión a la **cuenta bancaria real** del restaurante.
- **Abono SPEI a wallet** del usuario **incluido** (CLABE virtual por usuario → SPEI → acredita saldo).
- **Opción 1 (FINDING A):** al cerrar, cancelar pagos en vuelo; la garantía cubre; avisar al
  organizador quién quedó impago (con `user_id`/monto) para que arregle por fuera o pida los
  fondos por PayMe.
