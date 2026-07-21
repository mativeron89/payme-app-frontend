# CHANGELOG — PayMe App Backend v2.14 (Outbox Etapa 2 · eventos de agregados)

**Base:** v2.13.0 (repo GitHub `payme-app-backend`, CI verde). **Fecha:** 2026-07-19.
**Alcance:** Etapa 2 del outbox App→Dashboard según acta-contrato ratificada (`ops/actas/[PAYME]_ACTA_CONTRATO_OUTBOX_ETAPA2_EVENTOS_AGREGADOS.md`, 2026-07-18). El receptor (dashboard v1.0.8) ya persiste y valida estricto los tres eventos.
**Diff:** 1 módulo nuevo + 1 migración chica + 3 archivos tocados + tests + este changelog. Cero dependencias nuevas, cero cambios en flujos de dinero, cero cambios en los 5 eventos vivos.

## Nuevo: `services/aggregateEmitter.js` — emisor del lote de agregados
- **Tres eventos nuevos** al liquidar la mesa (misma tx que `table_charged`, `services/settlement.js` Fase 3): `item_aggregate_updated` · `item_association_updated` · `tip_aggregate_updated`.
- **Semántica del acta §4: totales ABSOLUTOS, no deltas.** En cada settle se recalcula el acumulado del `(business_date, service_window)` de la mesa liquidada — atribuido por su hora de APERTURA (`created_at`), misma convención de calendario MX que `table_opened` (UTC-6 fijo, corte 05:00, dinner ≥ 17) — y se emiten solo las filas cuyo total cambió: ítems de esta mesa, pares de esta mesa, tips Total + hora + grupo de esta mesa. Cada evento va COMPLETO (el upsert del receptor pisa campo a campo).
- **Envelope SIN `mesa_id`** (acta §3.1: su ausencia rutea al handler de agregados). Outbox con `aggregate_type='branch_aggregate'`, `aggregate_id = branch_id` y **secuencia por branch** (`restaurant_branches.last_emitted_sequence`, `UPDATE … RETURNING` en la misma tx) — satisface el UNIQUE existente sin cruzarse con las secuencias por-mesa.
- **Ítems:** clave `item_name` con `TRIM`; `status <> 'refunded'` (coherente con el neteo D1 de E3); `category` solo si existe (un `null` rompería la validación del receptor).
- **Asociaciones:** guard min-sample EN EL EMISOR — solo pares con coocurrencia ≥ 5 (doble barrera con la supresión en lectura del receptor). Al ser absolutos, un par que cruza el umbral sale entonces con su total completo.
- **Tips:** familias del acta §5.3 — Total (SIEMPRE, si no el front queda en 0) + hora (`hour_bucket` = hora local de apertura, 0–23) + grupo. Una dimensión por evento, jamás combinadas. **Familia staff: NO se emite** (diferida por acta §6 — FK interna del dashboard; se necesita mapeo staff app→dashboard con acta nueva).
- **Grupos 7+ (ratificado por Mati 2026-07-19):** el contrato de tips solo admite buckets `1-2|3-4|5-6` (validación estricta del receptor), pero la app permite hasta 20 comensales. Las mesas de 7+ cuentan en Total y hora y NO emiten fila de grupo. Nuevo `tipGroupBucket()` — distinto del `groupSizeBucket` de mesas (`5-8`/`9+`), que sigue intacto.
- **Fallos:** el lote corre bajo `SAVEPOINT` — si el recálculo o el enqueue fallan: rollback del savepoint, `logger.error('outbox_aggregates_batch_failed')` y **el settle sigue** (el outbox nunca rompe la operación de dominio). Única excepción: violación de privacidad, que lanza (tripwire, `utils/eventPrivacy.js` corre antes de cada insert, sin cambios).

## E5 / E7 — siguen RETENIDOS
Esta etapa no los habilita (acta §1). Sin cambios en `eventEmitter.js` salvo el export de `localHour` (calendario MX, una sola fuente de verdad).

## Migración: `db/migrate_outbox_etapa2_v2.14.sql`
- `restaurant_branches.last_emitted_sequence bigint NOT NULL DEFAULT 0` (idempotente). Cableada en `migrate:fresh` y `migrate` (`package.json`) → el CI la corre solo.

## Tests (`tests/outbox.test.js`)
- **Puros:** bordes de `tipGroupBucket` (incluido 7+ → null), `itemPairs` (únicos, a<b, sin auto-pares), `localHour`, y los payloads de los tres eventos pasan el guard de privacidad.
- **DB (gated por `DATABASE_URL_TEST`, corren en CI):** lote completo de una mesa (ítems con TRIM + tips Total/hora/grupo, envelope sin `mesa_id`, secuencia por branch 1..N); totales absolutos recalculados y par emitido recién al cruzar coocurrencia ≥ 5 (con revenue del acumulado completo); mesa de 7+ sin fila de grupo pero contando en Total; aislamiento de clave (lunch no mezcla con dinner; mesa sin liquidar no cuenta); rollback del dominio → cero eventos y secuencia intacta; restaurante sin mapping → skip ruidoso.

## Correcciones post-revisión adversarial (2026-07-19)
Revisión multi-agente del commit sobre el acta y el código real del receptor. De 15 hallazgos preliminares, 5 sobrevivieron la refutación cruzada. Se corrigieron los dos que son defectos inequívocos del emisor:

- **`category` pisada por el default `'other'` (corregido).** El agregado resolvía la categoría con `MAX(mi.category)` sobre toda la población. Las únicas categorías de la app son `italian|japanese|mexican|cafe` y el default `'other'` (`routes/mesas.js:102`, `services/matching.js:30`), y **`'other'` es lexicográficamente MAYOR que todas las reales**: bastaba UNA fila del día cargada sin categoría para que el evento emitiera `category='other'` y, vía el upsert que pisa, el plato perdiera su categoría en el dashboard de forma permanente. Ahora: `COALESCE(MAX(NULLIF(mi.category,'other')), 'other')` — prefiere cualquier categoría real, cae a `'other'` solo si no hay ninguna. Test de regresión agregado.
- **`tables_with_tip_count` sin cobertura de su rama falsa (corregido).** Todas las mesas de los tests tenían propina > 0, así que el contador siempre coincidía con `tables_count` y una regresión del tipo `tables_with_tip_count: rows.length` habría pasado verde. Se sumó una mesa liquidada con `tip: 0` a la población dinner y se afirma la desigualdad (7 mesas / 6 con propina).

## Pendientes que NO se tocaron (requieren decisión de Mati)
- **Divergencia de calendario entre familias.** Los agregados atribuyen por `mesas.created_at`; los 5 eventos de mesa (E1 `table_opened`) usan la hora de EMISIÓN — ningún call-site les pasa `occurredAt` (`settlement.js:101`, `settlement.js:158`, `webhooks.js:673`). Una mesa creada 16:55 con el hold autorizado 17:02 queda como `dinner` en el snapshot de mesa y como `lunch` en los agregados. No hay error de dinero ni doble conteo (cada familia es internamente consistente), pero las dos vistas del dashboard discrepan para esa mesa. Unificar toca E1, que es contrato vivo → requiere ratificación. Documentado en el encabezado de `aggregateEmitter.js`.
- **Ventana de lost-update entre settles concurrentes del mismo restaurante.** `POPULATION_SQL` lee la población ANTES de tomar el lock de `restaurant_branches`, así que dos settles simultáneos pueden emitir totales absolutos calculados sobre poblaciones que se ignoran mutuamente; el que se entrega último pisa. Se autocorrige en el siguiente settle del mismo turno, salvo que la carrera sea la última del turno. El acta §7 ya declara el riesgo de orden como conocido y aceptado (mitigación real = gating por secuencia en el receptor, con acta). El arreglo del lado emisor sería tomar el lock ANTES de leer la población, pero eso alarga el lock dentro de la tx del settle → se decide junto con el punto siguiente.
- **`POPULATION_SQL` no es sargable.** Los predicados son expresiones sobre `created_at`, así que cada settle escanea todas las mesas históricas del restaurante. Con 200 mesas/día, a los 12 meses son ~73.000 filas leídas dentro de la tx del settle, creciendo sin techo. Arreglo propuesto: acotar con un rango sargable sobre `created_at` (fronteras UTC calculadas en JS) y/o índice dedicado.

## Verificación local
- `node --check` sobre todos los archivos tocados; suite pura verde local (94 pass). La suite DB la juzga el CI de GitHub con Postgres real, como siempre.

---

# v2.14.1 — SQL roto contra Postgres real (P0, preexistente desde v2.11)

**Fecha:** 2026-07-19. **Origen:** hallazgo P0 reportado por la sesión del frontend corriendo este backend contra un Postgres local, confirmado acá y ampliado con un barrido adversarial de toda la capa SQL del repo (3 hallazgos, los 3 confirmados por unanimidad de sus verificadores).
**No es regresión de Etapa 2:** las tres consultas vienen de `5acf8e9` (v2.11 consolidado). Ningún archivo de outbox está involucrado.

Los tres son SQL que Node acepta como string y que **Postgres rechaza en tiempo de ejecución**. Ninguna suite pura puede verlos, y las suites contra base nunca ejercitaron esos caminos.

- **`middleware/auth.js` → `requireMesaParticipant` (crítico).** El `SELECT` sobre `mesas m LEFT JOIN restaurants r` pedía `id` y `status` sin calificar, y ambas columnas existen en las DOS tablas → **42702** (`column reference is ambiguous`). Como la query *lanza* en vez de devolver 0 filas, el fallback sin JOIN quedaba inalcanzable y todo caía en el catch → `500 mesa_check_failed`. Tumbaba `GET /mesas/:code`, `POST /mesas/:code/items/lock` y **`POST /mesas/:code/pay`**: se retenía la garantía del organizador y después nadie podía pagar. Corregido calificando todas las columnas. **Ojo `created_at`:** también existe en ambas tablas; agregarla sin alias reintroduce el bug.
- **`routes/invitations.js` (crítico).** `ON CONFLICT (mesa_id, user_id) DO UPDATE` contra `uq_mesa_participants_user`, que es un índice único **PARCIAL** (`WHERE user_id IS NOT NULL`, `db/schema.sql:187`). Postgres solo infiere un índice parcial como árbitro si la sentencia repite su predicado; sin él aborta con **42P10** al planificar — falla SIEMPRE, haya conflicto o no. `POST /invitations/:id/accept` estaba roto al 100%. Corregido agregando `WHERE user_id IS NOT NULL` al conflict target.
- **`routes/mesas.js` (alto).** Idéntico defecto con `DO NOTHING`: `POST /mesas/:code/invitations` con `type='in_app'` roto al 100% (el path `type='link'` no usa `ON CONFLICT` y no estaba afectado). Corregido igual.

Que es bug y no criterio deliberado lo confirma el propio repo: `services/walletFunding.js:52` ya escribe `ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL`.

**Fallback sin JOIN de `requireMesaParticipant`: revisado y dejado intacto a propósito.** Es redundante (con `LEFT JOIN`, una mesa existente siempre trae `m.id`, así que la condición `!mRows[0].id` es inalcanzable y el único camino real es "mesa no encontrada → 404"). Sacarlo sería un refactor oportunista sobre el guard de un camino de dinero sin cobertura previa; no entra en un fix de P0.

## Tests: `tests/sql-runtime.test.js` (nuevo, gated por `DATABASE_URL_TEST`, corre en CI)
Cierra la clase de bug, no solo las tres instancias:
- Llama a la **función real** `requireMesaParticipant` (no una copia de su SQL, que se desincronizaría) con una mesa real: exige que no responda 500, que llame a `next()`, que resuelva `mesaRole='opener'` y que el JOIN traiga `fee_pct`. Segundo test con código inexistente → 404, que además ejercita el fallback.
- Ejecuta las dos sentencias `ON CONFLICT` contra Postgres **dos veces cada una** (inserta, después choca), verificando que no dupliquen fila. Alcance honesto: fijan la compatibilidad sentencia↔schema —incluido el predicado del índice parcial—, no el call-site.

Se descartó armar el harness HTTP completo: es la deuda grande de `garantia`/`abono` y no corresponde resolverla dentro de un fix de P0.

## Verificación
- `node --check` sobre los 4 archivos tocados; suite pura verde (94 pass, 0 fail). La suite nueva la juzga el CI con Postgres 14 real.

---

# v2.14.2 — `req.mesa.code` undefined en el camino del dinero (P0, destapado por v2.14.1)

**Fecha:** 2026-07-19. **Origen:** hallazgo del frontend al verificar el fix v2.14.1 contra Postgres real, confirmado y acotado acá.
**Relación con v2.14.1:** el guard `requireMesaParticipant` nunca incluyó `code` en su SELECT (ni la query con JOIN ni el fallback). Estuvo TAPADO por el bug de columna ambigua (B-01): como la query lanzaba 42702, `req.mesa` nunca se seteaba y nadie llegaba a consumir `code`. Al arreglar el 42702, el endpoint empezó a responder y el `code` faltante se volvió observable. No es una regresión nueva de v2.14.1 sino un bug latente que el fix destapó — parte del mismo P0.

`req.mesa.code` quedaba `undefined` y se propagaba a todo lo que lo consume aguas abajo (los handlers hacen `const mesa = req.mesa`):

| Superficie | Qué quedaba roto |
|---|---|
| `GET /mesas/:code` (`routes/mesas.js:233-234`) | respuesta sin la clave `code`; `full_name = "Mesa undefined - <restaurante>"` |
| `POST /:code/pay` (`routes/mesas.js:564`) | `wallet_transactions.description = "Pago mesa undefined"` — **registro del LEDGER** |
| `POST /:code/pay` (`routes/mesas.js:620`) | `mesa_code = "undefined"` en la metadata del PaymentIntent de Stripe — **traza de conciliación** |

Los dos últimos son corrupción de datos en el camino del dinero, no cosmética. Corregido agregando `code` a las DOS consultas (`m.code` en el JOIN, `code` en el fallback).

**Verificación propia — `code` es el ÚNICO campo faltante.** Barrí todos los `mesa.<campo>` consumidos por los handlers que pasan por el guard (`id, code, restaurant_id, opener_user_id, total_cents, paid_amount_cents, tip_amount_cents, division_mode, expected_participants, status, expires_at, fee_pct`): los otros 11 ya estaban en el SELECT. `mesa.code` en `routes/mesas.js:148` es del handler de creación (usa una `mesa` local, no `req.mesa`) y no está afectado. Que es olvido y no criterio lo confirma `GET /mesas/open` (`routes/mesas.js:165`), que sí hace `SELECT m.id, m.code, ...`.

## Tests
Reforcé el test del middleware en `tests/sql-runtime.test.js`: además de exigir que la query ejecute, ahora afirma `req.mesa.code === mesa.code`. Cierra el hueco que señaló el front (el test previo verificaba que ejecuta sin error, no qué columnas devuelve) sin armar harness HTTP.

## Verificación
- `node --check` sobre los archivos tocados; suite pura verde (94 pass, 0 fail). La suite de SQL en runtime la juzga el CI con Postgres real.

---

# v2.14.3 — Stripe rechaza el cobro contra cuentas modernas (P0, destapado en el despliegue demo)

**Fecha:** 2026-07-19. **Origen:** primer despliegue real de la app (Railway + cuenta Stripe test de verdad) durante el sprint de demo. El cobro/hold nunca se había ejercido contra una cuenta Stripe moderna.

`services/stripe.js` → `createPaymentIntent` no declaraba `payment_method_types` ni `automatic_payment_methods`. Con la `apiVersion` pinneada (`2024-09-30.acacia`), Stripe activa por defecto `automatic_payment_methods` con `allow_redirects: 'always'`; al `confirm` sin `return_url`, **rechaza el PaymentIntent** exigiendo una URL de retorno — incluso con la cuenta configurada sólo para tarjetas. Síntoma en el despliegue: `POST /mesas` (hold de garantía) y `POST /mesas/:code/pay` devolvían `402 guarantee_failed` / error de cobro con el mensaje de Stripe pidiendo `return_url`.

PayMe cobra **tarjeta directo, server-side, sin UI de redirect**, así que la corrección es declararlo explícito: **`automatic_payment_methods: { enabled: true, allow_redirects: 'never' }`** en el `paymentIntents.create` (una línea, exactamente lo que sugiere el propio error de Stripe). Cubre el hold de garantía Y el pago (ambos pasan por `createPaymentIntent`). No cambia montos, idempotencia ni el modelo de garantía.

Misma clase que los P0 de SQL (v2.14.1/.2): bug latente que sólo aparece contra infraestructura real. Verificación real: smoke E2E de punta a punta contra la cuenta Stripe test (registro → hold → pago → settle → eventos en `sent`).

## Verificación
- `node --check` sobre `services/stripe.js`; suites puras verdes. La confirmación de fondo es el smoke E2E contra Railway + Stripe test (no un mock).
