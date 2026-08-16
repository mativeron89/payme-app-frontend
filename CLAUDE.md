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
   Stripe Connect; su checkpoint final se verifica, no se presume). El espejo
   vigente usa exactamente `415651ca4ef393a333206269e4a7f598c2b647de`
   (App Backend **v2.49.0**), copiado en `contract-mirror/`: **79 archivos**.
   🔴 **CORREGIDO el 2026-08-16 y remedido.** Acá decía *«es un commit LOCAL del
   dueño, aún sin publicar — `origin/main` está en `86f53bc`, v2.48.0»*, y **las
   dos mitades ya son falsas**: `415651c` **está publicado** (`git branch -r
   --contains` lo ubica en `origin/main`) y el remoto del dueño está en
   `c800a0d`, **v2.49.1**, con su HEAD local en `68d2982`, v2.49.2.
   ⚠️ **El aviso caducó por progreso ajeno, no por un error de quien lo escribió:
   era cierto el 13/08 y el dueño publicó después.** Es la clase de afirmación
   que ningún gate mira —el gate compara contenido, no si el commit salió— así
   que se remide, no se infiere.
   **La lección que el aviso traía SIGUE VIGENTE y por eso no se borra: espejar
   nunca implica que esté publicado.** Que hoy coincidan es una casualidad
   fechada, no una propiedad.
   ✅ **Remedido el 2026-08-16:** `--vigencia` verde —los 79 archivos siguen
   idénticos en el HEAD del dueño— y su inventario sólo cambió el campo `commit`:
   **misma población, mismo contenido.** El espejo no está atrasado.
   **La población la declara el DUEÑO**
   (`scripts/mirror-inventory.json`, copia de su
   `contract/mirror-inventory.json`, con mapeo `origen→destino`: siete de los
   79 se espejan renombrados). El gate `scripts/verificar-mirror.mjs` separa
   INTEGRIDAD (fiel al inventario · lo único verificable sin la fuente, y en
   CI se llama así, NO "paridad"), PARIDAD (la fuente respalda al inventario;
   sin fuente → exit 2 NO CERTIFICADO) y VIGENCIA (sigue igual en HEAD).
   Mueve dinero real.
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
  CLABE, SPEI y STP quedan fuera. Nunca se usa como fallback.
  **El apagado está IMPLEMENTADO, y su autoridad es del BACKEND (OLA 5D,
  2026-08-04).** `GET /api/config` publica `features.wallet_rail` desde
  v2.31.0 y este front lo LEE en `src/api/walletRail.ts`; ya no existe la
  constante propia `WALLET_RAIL_ENABLED`, y eliminarla fue parte de la
  corrección —mientras existiera, alguien podía leerla en vez de leer la
  capability, y un deploy de este front reencendía el riel sin que el backend
  se enterara—. Falla cerrado: capability ausente, mal formada o red caída →
  APAGADO. Un campo con forma de permiso por cuenta, rol o restaurante lo apaga
  **y se denuncia**. `account_activity` es un campo SEPARADO que falla al revés,
  a conservar: historial y estadísticas propias son card-only ratificado.
  **Nada se borró**: pantallas, métodos de fachada y decoders siguen durmientes.
  Reactivar exige gate IFPE, auditoría y ratificación nueva — una orden, jamás
  una variable de entorno.
- **Apple Pay y Google Pay** tienen plan ratificado y son MUST del card-only:
  permiten el primer pago sin tarjeta previa mediante un `pm_` efímero, nunca
  off-session ni guardado. Permanecen **apagados en real y mock** hasta cerrar
  la integración y prueba física iPhone/Safari y Android/Chrome. Un enum,
  botón mock o capability hardcodeada no acredita soporte.
- **G-11 CERRADO (backend v2.47.0, `aa28e84`), y la historia importa.** En
  direct charges el backend NO cumplía `save_payment_method`, y una
  advertencia posterior no corrige una promesa previa. El primer cierre
  (v2.46.0, `7e45db0`) fue **refutado** —cinco huecos; el peor: la wallet
  nativa se adjuntaba a Stripe ANTES de validarla—. `aa28e84` lo cierra en la
  causa (elegibilidad verificada antes de cualquier mutación remota) y hace
  **converger** la promesa (`card_save_intents` + sweep: un timeout ya no
  pierde la tarjeta, la resuelve en el tick siguiente). Este front lo consumió
  y lo reauditó leyendo el código espejado. 🔴 **La decisión de producto NO se
  revirtió**: el checkbox "Guardar esta tarjeta" sigue naciendo DESMARCADO
  (Mati, 2026-08-06) — una promesa por defecto es una promesa que nadie pidió,
  cumplible o no. Lo que cambió es que elegirla ahora se cumple.
- **El candidato sigue NO-GO de release/piloto** aunque sus checks locales
  cierren: App Backend conserva el fallback Connect→plataforma,
  D1-D/E incompletas, agregados con cohorte insuficiente y skips sin replay
  cuando falta el mapping de branch. El inventario vigente está en `GAPS.md`.
- **PQ-2 sigue en STOP de producto:** el checkpoint técnico y el espejo ya
  contienen fecha de nacimiento/capability, pero D-03 contradice el modelo de
  alta vigente. No interpretar `registration_required` ni modificar el registro
  hasta la enmienda y orden coordinada App Backend↔App Frontend.
- **CIERRE DEL PAGO SIN CUENTA (backend v2.32.0, espejado el 2026-08-04).**
  `GET /mesas/:code`, `items/lock` y `pay` **ya no aceptan invitado**: exigen
  sesión y contestan **401**. El token de `?t=` dejó de ser AUTORIZACIÓN y pasó
  a ser **CREDENCIAL**: se conserva a través del alta y se canjea en
  `POST /invitations/accept-link`, que inscribe por `user_id`.
  - El circuito ratificado: link por WhatsApp → **quien no tiene cuenta no ve la
    mesa** → se registra → el token sobrevive → se canjea → ahí sí ve, toma
    ítems y paga.
  - **401 ≠ 403.** 401 dice *"necesitás cuenta"* y manda al alta conservando el
    token; 403 diría *"no sos de esta mesa"*, que es otra pantalla. Confundirlos
    manda a la gente a la pantalla equivocada.
  - Los **cuatro** motivos de rechazo (inválido, vencido, cancelado,
    supersedido) comparten el mismo 403 **a propósito**: distinguirlos le diría
    a un desconocido si una mesa existe. No inventar copy que los separe.
  - El **503** no es un rechazo: es "no pudimos verificar". Reintentable.
  - `httpGuestRequest`, los parámetros `guestToken` de la fachada y las ramas
    `isGuest` de `MesaScreen` quedan **durmientes e intactos**, igual que
    `guestOrAuth` del otro lado. **No borrarlos**: mezclar borrado de código con
    un cambio de autorización sobre rutas de dinero es cómo se cuelan errores.
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
6. **El flujo del link es el momento mágico de la demo**: entra temprano (T3),
   no al final. ⚠️ **Desde el backend v2.32.0 ese flujo YA NO ES "sin cuenta".**
   Ver el baseline de abajo: el link lleva al alta y después al canje. Sigue
   siendo el momento mágico —un link de WhatsApp y estás pagando tu parte— pero
   con cuenta de por medio. No volver a implementar el pago de invitado.
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
| T3 | **Entrada por link** (momento mágico): entrada con hash, **canje del token con cuenta** (v2.32.0), selección con lock y pago card-only con su procesando/confirmación | `s-guest` (+ `s-processing`/`s-confirm`) + **nueva "Sumate a la mesa"** |
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
