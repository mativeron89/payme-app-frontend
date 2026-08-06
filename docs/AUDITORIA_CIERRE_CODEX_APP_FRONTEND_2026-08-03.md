# Auditoría de cierre Codex · App Frontend v0.29.5

**Fecha:** 2026-08-03

**Repo:** `payme-app-frontend`

**Rama local:** `codex/audit-2026-08-02-app-frontend`

**Base auditada:** `3af0057`

**Fuente contractual local:** App Backend
`e8a3faf2f520b249cbe6001f14ef70230a405695` (v2.28.8)

**Acciones externas:** ninguna. No hubo push, PR, deploy, consulta a producción,
secretos ni datos reales.

## Veredicto

El alcance local card-only cierra **GREEN de calidad**: no quedaron P0/P1
adicionales en la reauditoría adversarial del código modificado. El candidato
completo permanece **NO-GO de release/piloto** por bloqueos contractuales,
operativos y de producto enumerados abajo. Un check local verde no acredita CI
remoto, deploy ni estado de ningún entorno externo.

## Correcciones cerradas

1. El journal monetario v5 liga cada área al principal estable y exige
   generación, key, lease/familia, fingerprint y CAS. Conserva resultados
   ambiguos, impide mutaciones cruzadas y permite una operación posterior sólo
   mediante una adquisición terminal explícita. G-17 quedó reauditado y cerrado
   en seguridad local.
2. Las sesiones usan principal+familia, rotación bajo lock, tombstone y
   compare-and-swap. Requests o respuestas tardías de otra familia no pueden
   escribir estado de la sesión actual.
3. El alta de tarjeta conserva solamente key, etapa y referencia `pm_` en
   `sessionStorage`; nunca guarda `client_secret`. Captura principal+familia al
   iniciar, usa los tokens actuales de esa misma familia en cada request y
   verifica el actor antes y después de SetupIntent, Stripe, persistencia,
   attach y limpieza. La escritura es CAS: `setup` nace sólo sobre vacío y
   `attach` sólo avanza sobre la misma key, por lo que K1 no resucita sobre K2.
4. SetupIntent, attach e invitaciones tienen decoders fail-closed de los campos
   usados por la UI. El attach liga el `stripe_payment_method_id` devuelto al
   solicitado. Un link liga código de mesa y token. Un replay `expired` es
   terminal: no se presenta como éxito y libera la key para un intento fresco.
   Los decoders permiten compatibilidad aditiva; no se presentan como una
   validación exhaustiva de campos que el consumidor no usa.
5. El mock reproduce idempotencia, autoridad natural y expiración de
   invitaciones, SetupIntent/attach y mutaciones monetarias relevantes.
6. Las respuestas monetarias se ligan al request y contexto conocido; un 2xx
   incompleto o cruzado no acredita mesa, pago, topup ni transferencia.
7. OCR rechaza más de 8 MiB antes de red, igual que el receptor auditado. El
   helper de portapapeles sólo informa éxito después de comprobar la escritura
   en los flujos card-only. El uso directo histórico dentro de Topup queda
   diferido al plan durmiente del wallet.
8. Los residuos legacy G-19 quedan en cuarentena opaca y fail-closed: no se
   atribuyen, reenvían ni limpian. Ya no son P0 de código; siguen como P1
   operativo/upgrade condicionado a inventario y reconciliación autenticada.

## Espejo contractual

Se compararon todos los archivos fuente, con sus mapeos especiales documentados
en `contract-mirror/README.md`:

```text
MIRROR_COUNT=67 MIRROR_MISMATCH=0 MIRROR_MISSING=0
```

El README propio no cuenta como fuente espejada. No se aplicó ningún parche del
frontend dentro de las 67 copias.

## Evidencia local final

Ejecutada después de las últimas correcciones:

```text
npm test (corrida 1)  -> Test Files 19 passed (19) · Tests 150 passed (150)
npm test (corrida 2)  -> Test Files 19 passed (19) · Tests 150 passed (150)
npm run typecheck     -> tsc --noEmit limpio
build mock exacto     -> 75 modules · built in 802ms
build real exacto     -> 75 modules · built in 776ms
npm ls --all          -> exit 0; opcionales de otras plataformas ausentes
git diff --check      -> limpio
```

Comandos de build reproducidos:

```text
env VITE_MOCK=1 npm run build -- --base=/payme-app-frontend/
env VITE_MOCK=0 npm run build -- --base=/payme-app-frontend/live/ --outDir dist/live
```

Durante la misma auditoría, `npm ci` fue reproducible. Se aplicó la
actualización transitive compatible PostCSS `8.5.19→8.5.25` sugerida por el
audit y se repitió toda la batería anterior. `npm audit --omit=dev` informó 0
vulnerabilidades; el audit completo conserva 2 transitivas de desarrollo (1
moderada, 1 alta) en Vite/esbuild. La remediación automática propone Vite 8, un
major, por lo que G-23 queda como workstream de toolchain separado y no como
vulnerabilidad acreditada del bundle productivo.

## Bloqueos y gates vigentes

1. **P0:** App Backend permite fallback Connect→plataforma/STP en vez de fallar
   cerrado cuando no existe target Connect apto.
2. **P0 contractual / P1 backend:** `save_payment_method` puede quedar prometido
   y sellado sin guardado futuro bajo direct charges.
3. **P1 D1-E:** falta el flujo de disputas con devolución explícita de la
   comisión PayMe.
4. **P1 D1-D:** faltan avisos y auto-refund ratificado para pagos tardíos
   inequívocos de hasta MXN 2.000.
5. **P1 privacidad:** outbox de items/tips carece de `tables_count`, min-sample
   uniforme y retracción coordinada.
6. **P1 integridad:** una sucursal sin mapping puede provocar skip sin
   quarantine/replay.
7. **G-24 P1 pre-release/piloto:** `?demo=1` puede activar `pm_card_visa` y el
   bypass OCR desde URL. El artefacto live debe compilar ese modo inalcanzable;
   una demo separada sólo es admisible con entorno Stripe test, acceso y datos
   aislados explícitamente acreditados. El estado externo actual no se verificó.
8. El apagado durmiente del wallet fue ratificado pero **no se implementó en
   esta auditoría**, conforme a la orden: post-auditoría debe quedar fuera de
   UI y fail-closed por flags, conservando código/schema/rutas/tests. Reactivar
   requiere gate IFPE.
9. Apple Pay y Google Pay son MUST: primer pago mediante hoja nativa, sin alta
   previa ni tipeo. Su `pm_` efímero no sirve off-session; Cuentas Junior
   necesita tarjeta guardada del padre. Requieren integración y pruebas físicas.
10. PQ-2 continúa en STOP: D-03 contradice el modelo técnico de registro. No se
    consumió `registration_required` para inventar una decisión de producto.
11. G-19 exige inventario operativo de residuos reales o acreditación de cero
    exposición antes de liberar un navegador/upgrade afectado; nunca limpiar a
    ciegas.

## Exclusiones y residuales

- `AGENTS.md` era untracked antes de esta orden, no fue modificado y debe quedar
  fuera de todo stage/commit.
- No se implementó el apagado wallet ni Apple/Google Pay durante la auditoría.
- No se resolvieron decisiones cross-repo, de privacidad, producto o dinero sin
  acta.
- No se ejecutó E2E visual, CI remoto ni verificación externa.
