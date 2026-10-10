/** AF-VIAJES · EN de las pantallas de Viajes (ticket). El diseño no trae inglés: lo escribió App Frontend. */
export const EN_VIAJES_TICKET: Record<string, string> = {
  // Ticket nuevo (1h) y «¿Quiénes estuvieron?» (la pantalla nueva de presentes).
  'Ticket nuevo': 'New ticket',
  'Lo pagaste tú': 'You paid it',
  // D255-6 · quien carga elige quién pagó (reemplaza «quien escanea primero pagó»).
  '¿Quién pagó?': 'Who paid?',
  'El pago completo queda a nombre de quien pagó.': 'The full payment goes under whoever paid.',
  'Quien pagó ya no está en el viaje. Elige de nuevo.': "Whoever paid is no longer on the trip. Choose again.",
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
};
