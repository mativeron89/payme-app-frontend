# CLAUDE.md — PayMe · Frontend de la App del Comensal

Este archivo gobierna a Claude Code en este repo (`payme-app-frontend`).
Leelo entero antes de tocar nada. Generado el 2026-07-18 y reconciliado el
2026-08-03 con el gobierno cross-repo y el baseline card-only ratificado.
Ante conflicto entre este archivo y una ocurrencia nueva: gana este archivo,
salvo que Mati ratifique el cambio.

## Con quién trabajás

**Mati** — founder de PayMe, sin experiencia técnica. Idioma: **español
rioplatense**, tono senior directo. Mati delega la ejecución una vez
ratificado el alcance: traé opciones pre-analizadas con UNA recomendación
clara y esperá su OK en los checkpoints. **Mati es el juez visual**: valida
cada pantalla mirando `npm run dev` en el navegador y, sobre todo, EN EL
TELÉFONO — esta app se usa en la mesa de un restaurante.

## El workspace y el mapa de repos

Workspace local `PayMe/` con carpetas hermanas:

1. `payme-app-backend` — **EL CONTRATO DE ESTE FRONT** (Node/CommonJS,
   Stripe Connect; su checkpoint final se verifica, no se presume). El cierre
   local de auditoría usa exactamente
   `e8a3faf2f520b249cbe6001f14ef70230a405695` (v2.28.8), copiado en
   `contract-mirror/`; no implica que esté publicado. Mueve dinero real.
   **SOLO LECTURA ABSOLUTA: no se edita, no se "arregla", jamás.**
   ⚡ Trae el **pivote a Stripe Connect** (v2.22–v2.24): el pago con tarjeta es
   un *direct charge* sobre la cuenta conectada del restaurante — el
   restaurante es merchant of record. **Apagado por flag** en el backend
   (`CONNECT_DIRECT_CHARGES`); este front ya lo consume desde v0.26/0.27.
2. `payme-dashboard-backend` (repo v1.0.16, prod v1.0.12) — otro dominio. NO SE TOCA.
3. `payme-dashboard-frontend` — en desarrollo con su propio Claude Code y su
   propio CLAUDE.md. **FUERA DE TU ALCANCE: no produzcas nada para el
   dashboard.**
4. **Este repo** — `payme-app-frontend`: el front web de la app que usan los
   comensales para abrir mesa, dividir y pagar. Acá sí trabajás.
5. `ops/` — actas y kits del proyecto.

**Convivencia del ecosistema**: la prioridad #1 de PayMe hasta nuevo aviso
es que el dashboard quede navegable (desbloquea demos con restaurantes).
Esta misión avanza en paralelo sin competir: no le pidas a Mati
ratificaciones urgentes que choquen con el dashboard; ante conflicto de
agenda, el dashboard gana.

## El contrato — única fuente de verdad

**El contrato vive en el código de `../payme-app-backend`, no en la
maqueta.** Lo que no está en ese código, no existe. Nunca inventes un
endpoint, campo o shape.

- **Primera tarea de T0**: pedile a Mati autorizar acceso de lectura a
  `../payme-app-backend` (Claude Code puede requerir aprobar carpetas fuera
  de la sesión) y construí **`contract-mirror/`** en este repo: los
  `schemas/*.js`, las rutas, el seed si existe y el README del backend (que
  documenta el modo mock). Documentá procedencia y regla de solo lectura,
  como hizo el dashboard frontend en su `contract-mirror/README.md`.
- **La maqueta** `../_maquetas/preview_segun_backend_v2_7_COMPLETO.html` es
  el spec visual y de flujo (~19 pantallas). Su estética y estructura se
  respetan; **sus números, textos y estados se verifican SIEMPRE contra el
  contrato** — lección dura del proyecto: varias cifras de maquetas estaban
  desactualizadas.
- Los nombres de campos/estados citados en este archivo vienen del acta de
  auditoría y del briefing del ecosistema; **re-verificalos en T0 contra el
  código real** antes de tipearlos en `src/`.
- Demo end-to-end: el backend corre local en modo Stripe test. El MVP no usa
  STP, saldo, topups ni transferencias; no se habilitan para completar una demo.

## Baseline vigente ratificado (2026-08-02)

Fuente: `../ops/actas/[PAYME]_ACTA_2026-08-02_MVP_100_TARJETA_MUERTE_WALLET.md`.
Esta decisión supersede cualquier descripción histórica incompatible de este
archivo, la maqueta, el mock o `GAPS.md`.

- **A-1 · Garantía del organizador (v2.11, OBLIGATORIA)**: `POST /mesas`
  mantiene historia contractual `card | wallet`, pero el MVP usa **solo
  `card`**. La mesa nace `pending_auth` y pasa a `open` recién cuando el hold
  se autoriza: `requires_capture` con posible 3DS (el `client_secret` se usa
  en memoria con Stripe.js; nunca se persiste). Implica UNA pantalla
  nueva que la maqueta no tiene — **"Garantizá la mesa"**, entre dividir e
  invitar — más el manejo de `requires_action` y el estado visible
  "Garantizada". Sin garantía no hay mesa: va en el tier del flujo de
  apertura, no después.
- **A-2 · Mesa expirada, semántica nueva**: el conflicto histórico se
  resolvió — la garantía captura el faltante. La pantalla de expiración
  dice **"tu garantía cubrió $X"**, nunca "los $X no se cobran a nadie".
- **Wallet muerto para el MVP**: saldo, garantía/pago wallet, topups, P2P,
  CLABE, SPEI y STP quedan fuera. El plan de apagado ya está ratificado y
  permanece dormido hasta su implementación post-auditoría: flags/UI y
  comportamiento fail-closed, conservando código/schema e historia legacy.
  Una reactivación futura exigiría gate IFPE; nunca se usa como fallback.
- **Apple Pay y Google Pay** tienen plan ratificado y son MUST del card-only:
  permiten el primer pago sin tarjeta previa mediante un `pm_` efímero, nunca
  off-session ni guardado. Permanecen **apagados en real y mock** hasta cerrar
  la integración y prueba física iPhone/Safari y Android/Chrome. Un enum,
  botón mock o capability hardcodeada no acredita soporte.
- **G-11 es P0 contractual**: en direct charges el backend no cumple hoy
  `save_payment_method`; una advertencia posterior no corrige una promesa
  previa. No liberar el front mientras el checkbox pueda prometer guardado sin
  una solución contractual/fail-closed coordinada.
- **El candidato sigue NO-GO de release/piloto** aunque sus checks locales
  cierren: además de G-11, App Backend conserva el fallback Connect→plataforma,
  D1-D/E incompletas, agregados con cohorte insuficiente y skips sin replay
  cuando falta el mapping de branch. El inventario vigente está en `GAPS.md`.
- **PQ-2 sigue en STOP de producto:** el checkpoint técnico y el espejo ya
  contienen fecha de nacimiento/capability, pero D-03 contradice el modelo de
  alta vigente. No interpretar `registration_required` ni modificar el registro
  hasta la enmienda y orden coordinada App Backend↔App Frontend.
- **El modo `?demo=1` YA NO EXISTE (eliminado el 2026-08-03).** Sustituía
  Stripe Elements por un PaymentMethod de test y salteaba la captura OCR, y se
  activaba desde la URL. Se eliminó por completo —no se gateó— cuando Mati
  confirmó que la demo ya pasó y no se graba ninguna más: sin usuario, un flag
  que nadie va a volver a prender es superficie que alguien puede prender por
  error. G-24 quedó cerrado por eliminación. **El modo mock (`VITE_MOCK=1`) es
  otra cosa y se conserva**: es el riel de desarrollo. Si alguien necesita
  volver a grabar, se decide de nuevo y se implementa en un artefacto aparte.

Los flujos vigentes son home, cuenta/tarjetas, amigos, grupos, mesas abiertas,
scan-mock, ticket, división consumo/igual, invitaciones, locks, pago con tarjeta
y propina, estados `pending → succeeded → processed` y expiración honesta.

## Reglas duras (innegociables)

1. **GAPS.md**: todo lo que el front necesite y el contrato no tenga se
   ANOTA ahí (G-01, G-02, ...) y Mati lo lleva al dueño del contrato. Nunca
   se resuelve inventando ni se mockea en silencio.
2. **Mock-first**: adaptador propio activable con `VITE_MOCK=1` que replica
   los shapes reales del alcance card-only. El mock no reabre wallet ni
   simula Apple/Google Pay antes de la integración física.
3. **Stack espejo del dashboard frontend** (consistencia del ecosistema):
   React 18 + Vite + TypeScript estricto, fetch nativo, **cero librerías de
   UI**, router mínimo propio, CSS propio. **Mobile-first radical**: esto ES
   una app de teléfono; el desktop es secundario.
4. **Única dependencia nueva pre-justificada: Stripe.js/Elements** (tarjeta
   de garantía + confirmación 3DS). Al introducirla, presentale a Mati
   versión y alcance igual. Cualquier OTRA dependencia: prohibida sin su OK
   previo.
5. **Dinero = centavos enteros**, mostrados /100 en MXN. Sin floats. Si el
   backend expone utilidades de dinero propias, replicalas EXACTAS en
   `src/utils/` (como hizo el dashboard con `money.ts`) y anotá la
   procedencia.
6. **El flujo del invitado por link es el momento mágico de la demo**: entra
   temprano (T3), no al final.
7. Commits en español, cambios quirúrgicos, sin `as any`, tests + typecheck +
   builds real y mock, versión + entrada de CHANGELOG por tier.

## Ritual de trabajo

1. **Checkpoint por tier**: plan concreto de las pantallas del tier (qué
   muestra cada una, contra qué campos del contrato) → OK de Mati → codear.
2. **`npm run typecheck` y `npm run build` verdes antes de cada commit.**
3. **Juicio visual**: con `npm run dev` corriendo, decile a Mati qué mirar
   (y que lo abra en el teléfono). El tier cierra con su OK.
4. Push a `main` con OK de Mati; el CI valida.
5. Actas de decisión importantes → `../ops/`, y Mati las sube a Drive.

## Plan por tiers (ratificar T0 y cada tier con Mati)

| Tier | Contenido | Pantallas de la maqueta |
| --- | --- | --- |
| **T0** | Leer `../payme-app-backend`, construir `contract-mirror/`, contrastar maqueta vs contrato, relevar auth real y modo mock, ratificar alcance y este plan con Mati | — |
| T1 | Esqueleto Vite+React+TS, router propio, mock base, auth según contrato, shell de navegación + home | `s-home` |
| T2 | Flujo del organizador: abrir mesa con garantía **solo tarjeta** vía Stripe.js (`requires_action`/3DS simulado en mock) + estado "Garantizada", scan-mock, ticket, división consumo/igual, mis ítems (lock), compartir link/QR con hash | `s-open`, **nueva "Garantizá la mesa"**, `s-scan`, `s-ticket`, `s-division`, `s-myitems`, `s-share` |
| T3 | **Invitado por link** (momento mágico): entrada con hash, selección con lock y pago card-only con su procesando/confirmación | `s-guest` (+ `s-processing`/`s-confirm` en variante invitado) |
| T4 | Pago del organizador con propina al mozo, estados `pending → succeeded → processed`, confirmación, **expirada con semántica A-2**, notas | `s-payment`, `s-processing`, `s-confirm`, `s-expired`, `s-notes` |
| T5 | Cuenta y social card-only: tarjetas, historial propio de pagos, amigos, grupos y perfil. Las pantallas wallet/topup/transfer quedan dormidas y no navegables. | `s-account`, `s-friends`, `s-groups`, `s-profile` |
| T6 | Pulido móvil: estados vacíos/error, accesibilidad, performance | transversal |
| T7 | Conexión al backend real local y Stripe.js en test mode; sin STP/wallet y con Apple/Google apagados | — |

Los endpoints exactos de cada tier se fijan en T0 desde el contrato; este
plan inventaría pantallas y flujo, no paths.

## Prohibiciones (resumen)

- NO tocar los repos hermanos. NO producir nada para el dashboard.
- NO inventar endpoints/campos/shapes. NO floats para dinero.
- NO implementar el apagado wallet ni Apple/Google dentro de esta auditoría;
  ejecutarlos post-auditoría siguiendo sus planes ratificados.
- NO usar saldo/STP como fallback de tarjeta ni exponerlos en el mock.
- NO dependencias fuera de Stripe.js sin OK previo de Mati.
- NO asumir contexto que no esté acá, en `contract-mirror/` o en el repo:
  si algo falta de verdad, preguntale a Mati.
