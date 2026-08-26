# Handoff owner-first · G-25 solicitudes salientes · App Backend v2.71.0

Este archivo congela el contrato que App Frontend debe consumir. No autoriza
publicación ni cambios cross-repo por sí solo.

## POST `/api/friends`

Status de éxito deliberadamente uniforme: `202`.

```json
{
  "requested": true,
  "request_id": "uuid-opaco-del-intento"
}
```

`request_id` identifica sólo la intención del actor. Su presencia, ausencia,
valor o permanencia **no acredita** que el email/payme_id buscado exista, que
haya una solicitud real ni que el destino la haya visto, aceptado o rechazado.

## GET `/api/friends/requests?direction=outgoing`

```json
{
  "direction": "outgoing",
  "requests": [
    {
      "id": "uuid-opaco-del-intento",
      "requested_at": "2026-08-26T00:00:00.000Z"
    }
  ]
}
```

Cada intento autorizado genera un elemento con la misma forma, exista o no el
destino. La salida no contiene `user`, `user_id`, `payme_id`, email, nombre,
apellido, estado del destino ni estado de la solicitud real. El Frontend no
debe reconstruir ni mostrar identidad a partir de esta colección.

La variante `direction=incoming` conserva su DTO anterior con `user`: ahí hay
una solicitud real y el destinatario necesita identificar a quien la inició
para aceptarla o rechazarla.

## DELETE `/api/friends/requests/:requestId`

Propietario del recibo:

```json
HTTP 200
{ "cancelled": true }
```

Recibo inexistente o ajeno:

```json
HTTP 404
{ "error": "request_not_found" }
```

La respuesta no informa si había un destino o una solicitud real. El Frontend
puede retirar el elemento local sólo después del `200`; ante otro status debe
mantenerlo o reconciliar nuevamente el GET.

## Orden de adopción

1. Congelar/publicar el contrato owner en App Backend (este archivo y tests),
   sin desplegarlo todavía.
2. Adaptar App Frontend para aceptar la proyección opaca y dejar de depender de
   `requests[].user`; ese build puede tolerar el DTO anterior durante el orden
   de publicación, pero nunca debe mostrar identidad saliente no aceptada.
3. Publicar primero el Frontend compatible y después App Backend v2.71.0 con la
   migración aplicada. Ninguna de esas acciones está autorizada por este handoff.

No hay fallback autorizado al DTO viejo de persona saliente: volver a mostrar
o inferir el destino reabre G-25.
