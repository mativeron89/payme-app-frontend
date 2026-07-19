# GAPS — datos/endpoints que el front necesita y el contrato del App Backend no cubre

---

## 🟠 B-04 — `requireMesaParticipant` no selecciona `code` (corrompe ledger + Stripe)

Hallado el 2026-07-19 al verificar el fix v2.14.1. **Estaba tapado por B-01**:
como el endpoint nunca respondía, nadie vio que la fila venía incompleta.

`middleware/auth.js` → `requireMesaParticipant` usa `code` en el `WHERE` pero
**no lo selecciona** — ni en la consulta con JOIN ni en el fallback. Como
`req.mesa.code` queda `undefined`, se filtra a TODO lo que lo consuma aguas
abajo (todo eso lee `const mesa = req.mesa`):

| Superficie | Qué queda roto |
| --- | --- |
| `GET /api/mesas/:code` (routes/mesas.js:233-234) | respuesta sin la clave `code`; `full_name: "Mesa undefined - …"` |
| `POST /:code/pay` (routes/mesas.js:564) | **`wallet_transactions.description = "Pago mesa undefined"`** — registro del ledger |
| `POST /:code/pay` (routes/mesas.js:620) | **metadata `mesa_code: "undefined"`** en el PaymentIntent de Stripe — traza de conciliación |

Los dos últimos elevan esto de cosmético a **corrupción de datos en el camino
del dinero**: descripción del ledger y metadata de Stripe con "undefined".

Evidencia dura (mi pago real en PA-8804, verificado en la base v2.14.1):
```
SELECT description FROM wallet_transactions WHERE type='payment_mesa' ...;
 -> "Pago mesa undefined"    (debería decir "Pago mesa PA-8804")
```

Corroboración de que es un olvido y no criterio: el otro endpoint del mismo
archivo, `GET /mesas/open` (línea 165), **sí** hace `SELECT m.id, m.code, …`.

**Fix sugerido:** agregar `m.code` al `SELECT` con JOIN y `code` al fallback.

**Estado del front:** la pantalla de mesa ya no depende de eso (usa el código
de la ruta, que es más correcto). Pero el ledger y Stripe se llenan del lado
del backend, así que ese daño solo se arregla ahí.

---

## 🔴 B-01 — BUG BLOQUEANTE del backend (no es un gap: es un defecto)

**Hallado el 2026-07-19 durante T7, corriendo el backend v2.14.0 real contra
PostgreSQL 18. Reproducible al 100%.**

`middleware/auth.js` → `requireMesaParticipant` (línea ~147) ejecuta:

```sql
SELECT id, restaurant_id, opener_user_id, total_cents, paid_amount_cents,
       tip_amount_cents, division_mode, expected_participants,
       status, expires_at, metadata, fee_pct
  FROM mesas m
  LEFT JOIN restaurants r ON r.id = m.restaurant_id
 WHERE m.code = $1
```

`id`, `status` y `created_at` existen en **ambas** tablas, así que Postgres
aborta con `42702: column reference "id" is ambiguous`. La consulta **lanza**
(no devuelve 0 filas), por lo que el fallback sin JOIN de las líneas
siguientes es inalcanzable y el `catch` responde `500 mesa_check_failed`.

**Alcance — los tres endpoints del núcleo del producto quedan caídos:**

| Endpoint | Qué rompe |
| --- | --- |
| `GET /api/mesas/:code` | Nadie puede **abrir el detalle de una mesa** |
| `POST /api/mesas/:code/items/lock` | Nadie puede **reservar sus consumos** |
| `POST /api/mesas/:code/pay` | **NADIE PUEDE PAGAR** |

Crear la mesa y garantizarla sí funciona (`POST /api/mesas` no usa ese
middleware), así que el dinero se retiene pero después no se puede cobrar.

**Arreglo (verificado contra la base, NO aplicado — ese repo es de solo
lectura y esto merece acta):** calificar las columnas.

```sql
SELECT m.id, m.restaurant_id, m.opener_user_id, m.total_cents, m.paid_amount_cents,
       m.tip_amount_cents, m.division_mode, m.expected_participants,
       m.status, m.expires_at, m.metadata, r.fee_pct
  FROM mesas m
  LEFT JOIN restaurants r ON r.id = m.restaurant_id
 WHERE m.code = $1
```

**Por qué el CI no lo detecta:** las suites que tocan base están gateadas por
`DATABASE_URL_TEST`/`RUN_DB_TESTS` y varias están en skip declarado, así que
este camino nunca se ejerció contra un Postgres real.

**Estado: RESUELTO** en v2.14.1 (`1a4a7a0`, CI verde). Verificado por el front
el 2026-07-19 contra el backend real: `GET /mesas/:code` 200, `items/lock` 200,
`/pay` 201. El backend sumó `tests/sql-runtime.test.js`, que ejecuta estas
consultas contra el Postgres del CI en cada push.

---

## 🔴 B-02 y B-03 — `ON CONFLICT` contra un índice único PARCIAL

Hallados por el equipo del backend al barrer la capa SQL a partir de B-01.
**Los verifiqué de forma independiente contra Postgres 18 el 2026-07-19.**

`uq_mesa_participants_user` es un índice único **parcial**:

```
CREATE UNIQUE INDEX uq_mesa_participants_user
    ON mesa_participants (mesa_id, user_id) WHERE (user_id IS NOT NULL)
```

Postgres exige repetir ese predicado en el `ON CONFLICT`; sin él no puede
inferir el árbitro y aborta con `42P10` — **falla siempre, haya o no
conflicto** (es error de planificación, no de ejecución).

| # | Dónde | Endpoint que rompe | ¿Afecta a este front? |
| --- | --- | --- | --- |
| **B-02** | `routes/invitations.js:71` (`DO UPDATE`) | `POST /api/invitations/:id/accept` → 500 | **Sí**: aceptar una invitación in-app desde la pantalla de Avisos |
| **B-03** | `routes/mesas.js:721` (`DO NOTHING`) | `POST /api/mesas/:code/invitations` con `type:'in_app'` → 500 | **No hoy**: el front solo genera invitaciones `type:'link'`, que no pasan por ese `ON CONFLICT`. Bloquearía "invitar por PayMe ID" cuando se construya |

Verificación propia: `GET /api/invitations` responde 200 con los datos
completos; `POST /:id/accept` responde `500 {"error":"42P10"}`. Repitiendo el
predicado (`ON CONFLICT (mesa_id, user_id) WHERE user_id IS NOT NULL`) el
INSERT funciona.

**Estado: RESUELTOS** en v2.14.1. Verificado por el front:
`POST /invitations/:id/accept` → `200 {"accepted":true}`. No hizo falta ningún
parche del lado del front (se decidió a propósito no meter workarounds).

---

Regla del repo: acá se ANOTA, no se implementa ni se mockea en silencio.
Cada gap se lleva al dueño del contrato (`payme-app-backend`, vía Mati), que
decide si y cuándo entra. Cuando se resuelva, se actualiza este archivo y la
UI.

Nota: los deltas A-1 (garantía), A-2 (semántica de expiración) y A-3 (SPEI)
NO son gaps — ya están resueltos en el backend v2.13 y son trabajo de
primera clase de este front (ver CLAUDE.md).

| # | Qué falta | Dónde impacta | Qué hace el front mientras tanto | Estado |
| --- | --- | --- | --- | --- |
| G-01 | No hay endpoint para listar/buscar restaurantes, pero `POST /api/mesas` exige `restaurant_id` (uuid) y valida que exista y esté `active`. El OCR mock tampoco devuelve restaurante. | Abrir mesa (T2): sin un `restaurant_id` real no se puede crear mesa contra el backend. | En mock, el adaptador expone restaurantes de demo con uuids fijos. Para T7 (backend real) hace falta o un endpoint (`GET /api/restaurants`) o uuids seedeados conocidos. | Anotado 2026-07-18 |
| G-02 | No hay endpoint de perfil propio (`GET /api/me` o similar). `POST /auth/register` devuelve `user`, pero `POST /auth/login` devuelve SOLO tokens — tras un login no hay forma de saber nombre, `payme_id` ni email del usuario. | Home ("Hola, Mati"), Perfil (T5), y cualquier pantalla que muestre identidad. | En mock no afecta. Contra backend real: persistir el `user` de register en localStorage es parche parcial (no sobrevive login en otro device). | Anotado 2026-07-18 |
| G-03 | `GET /api/account/balance` devuelve `balance_cents` total pero no `held_balance_cents`. Con garantía wallet activa, el usuario "ve" saldo que no puede gastar (el backend calcula disponible = balance − held y devuelve 402). | Cuenta (T5) y pago con saldo (T4): el saldo mostrado puede no ser el gastable. | La UI dice "Tu saldo PayMe" (no "disponible") y maneja el `402 {available, required}`, que sí trae el disponible real. | Anotado 2026-07-18 |
| **G-04** | **`POST /api/mesas` con `guarantee_method:'card'` exige `stripe_payment_method_id` (`pm_…`), pero `GET /api/payment-methods` NO expone ese campo** (solo el `id` uuid interno). No hay forma de garantizar una mesa con una tarjeta ya guardada. Nótese que `POST /:code/pay` sí acepta `payment_method_id` uuid — la asimetría parece un descuido. | **Bloquea el flujo principal de A-1 en T7**: el organizador tendría que tipear su tarjeta completa cada vez que abre una mesa, aunque ya la tenga guardada. | Con backend real, garantizar con tarjeta obliga a pasar por Stripe Elements y crear un `pm_` nuevo cada vez. Alternativa sin fricción: garantizar con **saldo** (wallet), que no necesita Stripe. | Anotado 2026-07-19 |
| G-05 | No hay endpoint para registrar tarjetas *guardadas* usables en la garantía: `POST /api/payment-methods` guarda el `pm_` en la DB pero, por G-04, ese `pm_` no vuelve a salir. | Igual que G-04. | Si se resuelve G-04 exponiendo `stripe_payment_method_id` en el GET, este gap se cierra solo. | Anotado 2026-07-19 |
