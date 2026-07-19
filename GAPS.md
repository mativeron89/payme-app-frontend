# GAPS — datos/endpoints que el front necesita y el contrato del App Backend no cubre

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
