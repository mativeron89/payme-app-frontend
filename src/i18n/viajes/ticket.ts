/** AF-VIAJES · EN de las pantallas de Viajes (ticket). El diseño no trae inglés: lo escribió App Frontend. */
export const EN_VIAJES_TICKET: Record<string, string> = {
  // Ticket nuevo (1h) y «¿Quiénes estuvieron?» (la pantalla nueva de presentes).
  'Ticket nuevo': 'New ticket',
  // D255-6 · quien carga elige quién pagó (reemplaza «quien escanea primero pagó»).
  '¿Quién pagó?': 'Who paid?',
  'El pago completo queda a nombre de quien pagó.': 'The full payment goes under whoever paid.',
  'Quien pagó ya no está en el viaje. Elige de nuevo.': "Whoever paid is no longer on the trip. Choose again.",
  // D263 · pagaron varios: partes iguales o «Ajustar montos».
  'Ajustar montos': 'Adjust amounts',
  'Volver a partes iguales': 'Back to equal parts',
  'Suman {0} de {1}': 'Adds up to {0} of {1}',
  'Cuánto pagaste tú': 'How much you paid',
  'Cuánto pagó {0}': 'How much {0} paid',
  'Los montos tienen que sumar {0}. Ahora suman {1}.': 'The amounts have to add up to {0}. Right now they add up to {1}.',
  'Escribe cuánto pagó cada uno. Tienen que sumar {0}.': 'Enter how much each one paid. They have to add up to {0}.',
  'Los montos no suman el total. Revísalos.': "The amounts don't add up to the total. Check them.",
  // D263 · al entrar a un ticket que pagaron varios.
  'Pagaron {0} personas': '{0} people paid',
  'Quiénes pagaron': 'Who paid',
  'Invitan quienes pagaron': "It's on those who paid",
  'Cada uno pone lo que pagó. Nadie les debe nada.': 'Each one covers what they paid. Nobody owes them anything.',
  'Cada uno pone lo que pagó. No te toca nada.': "Each one covers what they paid. You don't owe anything.",
  'Tipo de lugar': 'Type of place',
  '¿Cómo lo dividen?': 'How do you split it?',
  'Cada uno elige lo suyo': 'Everyone picks their own',
  'Entre los que estuvieron': 'Among those who were there',
  'Invitas tú, nadie te debe': "It's on you, nobody owes you",
  '¿Quiénes estuvieron?': 'Who was there?',
  'Se divide entre los marcados. Desmarca a quien no estuvo.':
    "It's split among those checked. Uncheck anyone who wasn't there.",
  'Compartir con el viaje': 'Share with the trip',
  'Compartiste el ticket con el viaje.': 'You shared the ticket with the trip.',
  'Este viaje ya tiene el máximo de tickets.': 'This trip already has the maximum number of tickets.',
  // Sin el escaneo, el recibo ya usado o inválido.
  'No encontramos el ticket escaneado.': "We couldn't find the scanned ticket.",
  'Volver al viaje': 'Back to the trip',
  'Este ticket ya se cargó en otro viaje.': 'This ticket was already added to another trip.',
  'No pudimos validar el ticket. Escanéalo de nuevo.': "We couldn't validate the ticket. Scan it again.",
  // Ticket ya cargado (1k).
  'Este ticket ya está en el viaje': 'This ticket is already in the trip',
  '{0} lo cargó el {1} a las {2} y quedó como quien lo pagó. No se carga dos veces.':
    "{0} added it on {1} at {2} and is set as the one who paid. It isn't added twice.",
  'Ya cargaste este ticket el {0} a las {1}. No se carga dos veces.':
    "You already added this ticket on {0} at {1}. It isn't added twice.",
  'Elegir lo que consumí': 'Choose what I had',
  'Escanear otro ticket': 'Scan another ticket',
  // El ticket del viaje (1i, 1j, partes iguales). «Escanear ticket», «Pagó {0}» y
  // «Te toca» viven en `viaje.ts` (los comparte con 1g). «Pagaste tú» vive acá y
  // lo usan también 1g (`viajeView.ts`) y 1s (`ViajeCerradoScreen.tsx`).
  'Pagaste tú': 'You paid',
  'Quién ya eligió': 'Who already chose',
  '{0} · falta elegir': "{0} · hasn't chosen",
  'Total del ticket {0}': 'Ticket total {0}',
  'Guardamos lo que consumiste.': 'We saved what you had.',
  'Alguien ya eligió parte de ese plato. Revisa lo que queda.':
    "Someone already chose part of that dish. Check what's left.",
  'Invita {0}': "It's on {0}",
  '{0} pagó el total de este ticket. No te toca nada.': "{0} paid the whole ticket. You don't owe anything.",
  'Invitas tú': "It's on you",
  'Pagaste el total de este ticket. Nadie te debe nada.': "You paid the whole ticket. Nobody owes you anything.",
  'Se divide entre los que estuvieron': "It's split among those who were there",
  'Guardamos quiénes estuvieron.': 'We saved who was there.',
  // D276 · quiénes estuvieron en las tres formas, el gasto personal y el no presente.
  'Sólo eligen los que estuvieron. Desmarca a quien no estuvo.':
    'Only those who were there choose. Uncheck anyone who wasn\'t.',
  'Es un gasto personal: sólo lo ves tú y no suma al total del viaje.':
    "It's a personal expense: only you see it, and it doesn't count toward the trip total.",
  'Es tu gasto personal: sólo lo ves tú y no suma al total del viaje.':
    "It's your personal expense: only you see it, and it doesn't count toward the trip total.",
  'Guardaste el gasto personal.': 'You saved the personal expense.',
  'Alguien ya no está en el viaje. Revisa quiénes estuvieron.':
    "Someone is no longer on the trip. Check who was there.",
  'No estuviste en este ticket: no eliges nada.': "You weren't there for this ticket: you don't choose anything.",
  'Es tu gasto personal: no hay nada que elegir.': "It's your personal expense: there's nothing to choose.",
  '{0} ya eligió: no se puede desmarcar.': '{0} already chose: they can\'t be unchecked.',
  'Alguien ya eligió: no se puede desmarcar.': "Someone already chose: they can't be unchecked.",
  // V-02 · el ticket de un viaje que ya no está abierto (desde Estadísticas): sólo para ver.
  'Este viaje ya se cerró: el ticket es sólo para ver.': 'This trip is closed: the ticket is view-only.',
  'Ya elegiste: no te puedes desmarcar.': "You already chose: you can't be unchecked.",
  // D278-2 · D284 · el total impreso del ticket del viaje.
  'Tus platos {0} · Tu parte del resto {1}': 'Your dishes {0} · Your share of the rest {1}',
  // D278-3 · D282-2 · corregir un ticket o un gasto ya cargado.
  'Corregir ticket': 'Correct ticket',
  'Corregir gasto': 'Correct expense',
  'Corregiste el ticket.': 'You corrected the ticket.',
  'Corregiste el gasto.': 'You corrected the expense.',
  'Nombre del lugar': 'Name of the place',
  'Fecha': 'Date',
  'Hora': 'Time',
  'Renglones': 'Lines',
  'Agregar renglón': 'Add line',
  'Nombre de {0}': 'Name of {0}',
  'Nombre del renglón nuevo': 'Name of the new line',
  'Precio de {0}': 'Price of {0}',
  'Precio del renglón nuevo': 'Price of the new line',
  'Uno menos de {0}': 'One less {0}',
  'Uno menos del renglón nuevo': 'One less of the new line',
  'Uno más de {0}': 'One more {0}',
  'Uno más del renglón nuevo': 'One more of the new line',
  'Sacar {0}': 'Remove {0}',
  'Sacar el renglón nuevo': 'Remove the new line',
  'Servicio, descuentos e IVA': 'Service, discounts and VAT',
  'Lo que el ticket suma o resta aparte de los platos.': 'What the ticket adds or takes off besides the dishes.',
  'Servicio': 'Service',
  'IVA aparte': 'VAT on top',
  'Antes {0}': 'Before {0}',
  '¿Cuánto pagó cada uno?': 'How much did each one pay?',
  'Cambió el total: escribe lo que pagó cada uno. Tienen que sumar {0}.':
    'The total changed: enter what each one paid. They have to add up to {0}.',
  'Cada renglón necesita un nombre.': 'Every line needs a name.',
  'Revisa los montos: escribe sólo números, como 120 o 120.50.': 'Check the amounts: enter numbers only, like 120 or 120.50.',
  'El total tiene que ser mayor que $0 y de hasta $1,000,000.': 'The total has to be more than $0 and up to $1,000,000.',
  'Escribe una descripción.': 'Enter a description.',
  'Cambiaste el precio de {0}: quienes lo eligieron van a tener que volver a elegir.':
    'You changed the price of {0}: whoever chose it will have to choose again.',
  'Cambiaste la cantidad de {0}: quienes lo eligieron van a tener que volver a elegir.':
    'You changed the quantity of {0}: whoever chose it will have to choose again.',
  'Sacaste {0}: quienes lo eligieron van a tener que volver a elegir.': 'You removed {0}: whoever chose it will have to choose again.',
  'Cambiaste {0} renglones que ya se eligieron ({1}): quienes los eligieron van a tener que volver a elegir.':
    'You changed {0} lines that were already chosen ({1}): whoever chose them will have to choose again.',
  'Tú también.': 'You too.',
  'Vas a tener que volver a elegir {0}.': 'You will have to choose {0} again.',
  'Alguien que pagó ya no está en el viaje: el total no se puede cambiar.':
    "Someone who paid is no longer on the trip: the total can't be changed.",
  'Este ticket ya no está en el viaje.': 'This ticket is no longer on the trip.',
  'Sólo quien cargó o pagó este ticket puede corregirlo.': 'Only whoever added or paid this ticket can correct it.',
  'El ticket cambió mientras lo corregías. Revísalo de nuevo.': 'The ticket changed while you were correcting it. Check it again.',
  'El total cambió: escribe cuánto pagó cada uno.': 'The total changed: enter how much each one paid.',
  'Con este cambio el viaje pasaría su tope de gastos. Revisa los montos.':
    'With this change the trip would go over its spending limit. Check the amounts.',
};
