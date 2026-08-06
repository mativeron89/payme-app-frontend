# Runbook · cuarentena de residuo monetario legacy (G-19 / N-09)

**Alcance:** app del comensal (`payme-app-frontend`). Solo lectura de evidencia
local del navegador. **No cubre** reembolsos, ajustes ni nada que mueva dinero:
eso es del App Backend y de soporte.

## Qué es esto

Las versiones anteriores a v0.29.x guardaban intentos monetarios en
`sessionStorage` bajo `payme_idem_*` y `payme_pending_*`, **sin registrar de qué
usuario ni de qué familia de sesión eran**. Un residuo así no se puede atribuir:
no hay forma de saber si protegía un cobro que salió, uno que no salió, o uno de
otra persona que usó el mismo navegador.

Por eso la app **congela el área monetaria** (abrir mesa, pagar, cargar,
transferir) antes de tocar la red, en vez de arriesgar un segundo cobro. Falla
cerrada a propósito.

## Qué NO hay que hacer

- **No borrar el residuo a ciegas.** Es la única evidencia local de que hubo un
  intento. Se conserva incluso después de reconciliar.
- **No usar un TTL** ni "esperar a que se destrabe solo". La cuarentena no
  caduca: se levanta con una decisión humana o no se levanta.
- **No pedirle al usuario que limpie el navegador.** Eso destruye la evidencia
  y no reconcilia nada.

## Procedimiento

1. **Identificar el área congelada.** La pantalla la nombra: abrir mesa, pagar
   una mesa, cargar saldo o transferir. La app lista las claves de residuo
   halladas (solo los nombres, nunca el contenido).

2. **Buscar la operación en el backend**, por el usuario y la ventana temporal
   del residuo:
   - abrir mesa → ¿existe una mesa abierta o cerrada de ese usuario en ese
     restaurante, con garantía retenida?
   - pagar mesa → ¿hay un `payment_attempt` de ese usuario en esa mesa?
     ¿tomó casillero (`claimed_by_me`) o fracción?
   - cargar saldo → ¿hay un `topup` de ese usuario en ese monto?
   - transferir → ¿hay una `transfer` de ese usuario a ese destinatario?

3. **Resolver según lo que diga el backend:**

   | Hallazgo en backend | Acción |
   | --- | --- |
   | La operación **existe y está cobrada** | No hay nada que reintentar. Se le informa al usuario y se libera la cuarentena; el próximo intento será una operación NUEVA y consciente. |
   | La operación **existe y falló/se canceló** | No se cobró. Se libera la cuarentena. |
   | La operación **no existe** | No se cobró. Se libera la cuarentena. |
   | **No se puede determinar** | **No se libera.** Escalar. Una cuarentena sostenida es preferible a un cobro duplicado. |

4. **Liberar** desde la propia pantalla, con la confirmación explícita. La app
   marca el área como reconciliada y **deja el residuo intacto**. A partir de ahí
   la operación siguiente abre una generación nueva con clave nueva.

5. **Registrar** qué se encontró y qué se decidió. G-19 exige inventario de
   exposición real antes de liberar un área afectada en una población.

## Qué garantiza el código

- `readLegacyQuarantine(scope, operation)` informa el estado sin lanzar, para
  que la pantalla pueda **explicar** el bloqueo en vez de sólo fallar.
- `releaseLegacyQuarantine(scope, operation)` marca el área como reconciliada
  **por área**: liberar "abrir mesa" no libera "pagar".
- El residuo **nunca** se borra desde el front.
- Un registro de cuarentena corrupto se lee como congelado, no como liberado.

Tests: `src/api/legacyQuarantine.test.ts`.
