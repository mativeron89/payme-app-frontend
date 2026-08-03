# v2.28.8 — Cierre local de auditoría de dinero y evidencia Stripe

**Fecha:** 2026-08-03.

Este changelog describe el candidato **local** construido sobre `61ac4af`. No
acredita CI remoto, push, deploy, migraciones externas ni producción.

## Integridad monetaria y transaccional

- Todas las cantidades de dinero y bps que atraviesan los caminos auditados se
  validan como enteros seguros; PostgreSQL conserva los límites equivalentes.
- `db/pool.js` comprueba que una transacción haya terminado con un `COMMIT`
  real. Los efectos opcionales usan savepoints explícitos y los efectos
  monetarios obligatorios ya no pueden quedar ocultos por un `catch`.
- Pagos, garantía, settlement, topups, refunds Connect y STP preservan una
  evidencia durable antes de repetir o reconciliar un efecto remoto.
- El cierre de mesa vuelve a bloquear y releer el estado después de aislar los
  pagos en vuelo; no captura una garantía usando una foto vencida.

## Stripe, Connect y webhooks

- Los intentos de pago y topup guardan el contrato Stripe necesario para
  distinguir creación, replay, éxito, cancelación ambigua y revisión manual.
- Los refunds de direct charges usan fences, ledger append-only, prorrateo
  acumulado y devolución explícita de comisión conforme al acta D1 vigente.
- Los webhooks usan leases recuperables y rechazan metadata ajena, cuentas
  conectadas cruzadas y bindings inconsistentes sin mutar negocio.
- Tarjetas guardadas y tipeadas comparten un lifecycle durable
  `attaching/active/detaching`: el lock advisory y los índices parciales evitan
  que attach, detach, pago y garantía se contradigan en carreras.
- La evidencia de marca, funding, customer, cuenta conectada y ownership se
  verifica fail-closed. Apple Pay y Google Pay continúan fuera del código de
  esta auditoría; su plan MUST se ejecuta después con pruebas físicas.

## Autoridad, autenticación e idempotencia

- Registro, refresh/logout, límites bcrypt, CORS y correlation IDs conservan
  autoridad de servidor y fallan cerrados ante identidad o sesión inválida.
- Invitaciones usan autoridad natural y journal durable: retries equivalentes
  convergen, conflictos no reutilizan tokens y aceptar/revocar no cruza actor.
- El roster administrativo de staff exige sesión de manager/owner; el selector
  público para propina conserva únicamente `id`, `role` y `display_name`.
- Los replays de mesa y pago conservan el payload exacto, el slot y el estado
  remoto; un resultado ambiguo no se transforma en una operación nueva.
- `bcrypt` sube de 5 a 6. El árbol ya no contiene
  `@mapbox/node-pre-gyp`/`tar`.
- `multer` sube de 1.4.5-lts.2 a 2.2.0, por encima del mínimo 2.1.1 que corrige
  [GHSA-5528-5vmv-3xc2](https://github.com/expressjs/multer/security/advisories/GHSA-5528-5vmv-3xc2)
  (DoS remoto por recursión incontrolada). El parser OCR ahora devuelve 4xx
  estables ante tipo inválido, límite de 8 MiB y multipart truncado, y una
  regresión acredita que el proceso sigue vivo.
- `npm audit` completo informa cero vulnerabilidades.

## Schema y operación

Se incorporan y cablean las migraciones de contrato de intents, topups,
centavos seguros, refunds Connect, leases de webhook, elegibilidad de tarjeta,
autoridad/idempotencia de invitaciones y lifecycle de PaymentMethods. Tanto
`migrate:fresh` como la suite de wiring verifican su orden.

El rollout seguro requiere una ventana coordinada y sin tráfico incompatible:

1. backup e inventario externo autorizados;
2. aplicar migraciones;
3. ejecutar `preflight:card-evidence` y exigir cero obligaciones no resueltas;
4. desplegar inmediatamente el mismo candidato;
5. smoke tests y observación antes de reabrir tráfico.

Ningún paso externo fue ejecutado durante esta auditoría.

## Verificación local

- PostgreSQL local nuevo: `migrate:fresh` + `legal:sync`, verdes.
- Dos corridas CI-equivalentes consecutivas: **30 suites · 549/549 tests** en
  ambas.
- `node --check` sobre todos los JavaScript modificados o nuevos, verde.
- `npm audit --audit-level=low`: **0 vulnerabilidades**.
- `git diff --check`: limpio.

`npm run lint` sigue fallando antes de analizar código porque ESLint 9 no
encuentra `eslint.config.js`. Es una deuda preexistente del toolchain y el
workflow remoto vigente no ejecuta lint; no se corrigió de paso.

## Gates que este candidato no resuelve

- **NO-GO de release del ecosistema:** `save_payment_method` no puede prometer
  persistencia bajo direct charges hasta cerrar el contrato coordinado con el
  App Frontend.
- **NO-GO card-only:** el backend todavía puede resolver Connect como `null` y
  continuar con un cargo de plataforma. El MVP no autoriza fallback silencioso
  a wallet ni a un cargo de
  plataforma cuando Connect falta o no está listo. La conducta final y el
  rollout requieren decisión coordinada.
- **D1-D/E incompletas:** no están cableados los eventos de disputa ni la
  devolución explícita de comisión ratificada; el pago tardío queda durable en
  revisión manual, pero todavía no notifica siempre ni automatiza el caso
  inequívoco de hasta MXN 2.000. Son workstreams ratificados, no parches
  unilaterales de este cierre.
- **Privacidad cross-repo:** items y tips de outbox aún pueden emitirse con
  cohorte uno. Definir `tables_count`, supresión uniforme y retracción
  tombstone/cero requiere contrato App Backend↔Dashboard Backend; el receptor
  fail-closed no reemplaza el guard en el emisor.
- Si falta `restaurant_branches`, lifecycle/agregados hacen skip sin cuarentena
  ni replay. Antes de release se exige cobertura de mapping 100%; el mecanismo
  durable queda como deuda de disponibilidad.
- El wallet queda **durmiente, no borrado**. Flags, salida de UI y fail-closed
  pertenecen al plan ratificado post-auditoría; código, schema, rutas y pruebas
  legacy permanecen intactos. Reactivar exige gate IFPE.
- Apple Pay/Google Pay son MUST post-auditoría: primer pago sin tarjeta previa,
  hoja nativa y `pm_` efímero. Ese `pm_` no sirve para cargos off-session ni
  reemplaza la tarjeta guardada del padre en Cuentas Junior.
- Producción, Railway, Stripe real, secretos, datos reales y CI remoto no fueron
  consultados ni se infieren de esta evidencia.
