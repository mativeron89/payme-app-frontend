# ROADMAP D4–D7 · payme-app-frontend (consume D4, D7, D5)

**Decisiones RATIFICADAS por Mati el 2026-07-22.** Acta: `../ops/actas/[PAYME]_ACTA_2026-07-22_ROADMAP_PRODUCTO.md`.
Te tocan **D4, D7, D5**. **D6 NO te toca** (es cálculo interno del backend).

El backend (`payme-app-backend`) **define los contratos**; vos los **consumís**. **No inventes contrato:** `contract-mirror/` + `GAPS.md`, y **mock-first** (`VITE_MOCK=1`) replicando EXACTA la forma acordada hasta que el backend publique cada endpoint. Cuando aterrice en el backend, sincronizá `contract-mirror` y conectá.

## Forma de trabajo
Una decisión a la vez; **PLAN del tier** (qué muestra cada pantalla, contra qué campos del contrato) → OK de Mati → codear. `typecheck` + `build` verdes antes de commitear. Diffs quirúrgicos, **sin dependencias nuevas fuera de Stripe.js**. Mobile-first. Seguí el orden en que el backend vaya publicando (sugerido **D4 → D7 → D5**).

---

## D4 · Tarjeta guardada
**Contrato:** `GET /payment-methods` (auth) → `{id (pm_…), brand, last4, exp_month, exp_year, is_default}`; guardar = señal `save_payment_method=true` al pagar/garantizar con tarjeta nueva; reusar = mandar `stripe_payment_method_id`.
**UI:** checkbox "guardar tarjeta" en la entrada (Stripe Elements) del paso de garantía/pago; selector de tarjetas guardadas (marca + ····last4) en garantía y en pago; elegir una guardada **saltea Elements** pero mantiene el manejo de **3DS** (`requires_action`). Sin re-tipeo.

## D7 · Propina por comensal
Cada comensal (organizador e invitados) elige **su %** en SU paso de pago; el organizador **DECLARA N** (cantidad de personas) al abrir la mesa.
Mostrar la propina como **(total ÷ N) × su %**. Presets sugeridos **10/15/20 + personalizado** (mostráselos a Mati en el plan); permitir **0**. Cada uno deja **solo su** propina; nadie carga la de otro.
Usá el cálculo del backend como fuente; si hacés preview en el front, **centavos enteros y mismo redondeo**.

## D5 · OCR real (revisión antes de dividir)
Tras escanear, mostrar el ticket que devuelve el backend en una pantalla **EDITABLE** para que el usuario **revise/corrija ANTES de dividir** (guardarraíl: si el total está mal, la división está mal). Camino de **carga manual** si el OCR falla.
