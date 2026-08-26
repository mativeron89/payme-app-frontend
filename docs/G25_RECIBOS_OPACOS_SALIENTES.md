# G-25 · consumidor de recibos opacos salientes

## Contrato owner-first adoptado

- App Backend contenido: `064c51aadd2266f8f47ed36461dd60f7b9f39b88`
  (v2.71.0).
- Publicador del inventario completo: `5b1e1f21cfe7f8d1504c5c8b8d9a87982c93f42e`.
- Inventario: 90 archivos, integridad/paridad/vigencia verificadas.
- Evidencia espejada:
  - `contract-mirror/routes/friends.js`: POST crea un receipt en todos los
    caminos; GET outgoing publica sólo `id/requested_at`; incoming conserva
    `user`; DELETE recibe el receipt id.
  - `contract-mirror/db/migrate_friend_request_receipts_v2.71.0.sql`:
    población owner-first para solicitudes históricas.
  - `contract-mirror/docs/HANDOFF_G25_SOLICITUDES_SALIENTES_V2.71.0.md`:
    shape y secuencia de release.

## Matriz de consumo

| Operación | Backend nuevo | Compatibilidad anterior | Frontera frontend |
|---|---|---|---|
| POST `/friends` | `{requested:true, request_id:UUID}` | `{requested:true}` | Acepta únicamente ambos shapes exactos. Nunca inventa id ni identidad. |
| GET incoming | `{id,user,requested_at}` | mismo DTO | Valida UUID/timestamp/persona y conserva identidad para aceptar/rechazar. |
| GET outgoing | `{id,requested_at}` | `{id,user,requested_at}` | Valida el DTO viejo pero lo proyecta inmediatamente al nuevo: `user` no sale del decoder. |
| DELETE receipt | `{cancelled:true}` | mismo 200 | Retira la fila local sólo después de decodificar el 200 exacto; error conserva y reconcilia. |

## Invariantes y mutantes

- El estado React saliente contiene sólo `requestId/requestedAt`.
- Receipt id, request id de amistad y user id son identidades distintas.
- Exigir `request_id` rompería la publicación Frontend primero: el fixture
  viejo debe seguir verde durante la ventana.
- Reintroducir `user` en el DTO decodificado rompe el test de keyset completo.
- Retirar antes de resolver DELETE rompe el test con promesa diferida.
- Cancelar por person/request id en lugar de receipt id rompe el mock causal.

## Publicación coordinada

1. Publicar y verificar este Frontend dual-compatible.
2. Publicar App Backend v2.71.0 y ejecutar su migración.
3. Verificar que POST y GET outgoing tienen cardinalidad no-oracular.
4. En una orden posterior, retirar la compatibilidad del DTO viejo sólo cuando
   producción acredite que ya no puede responderlo.

Esta implementación y este documento no acreditan publicación ni producción.
