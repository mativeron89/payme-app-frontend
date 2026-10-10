/**
 * AF-VIAJES · EN de lo que comparten las pantallas de Viajes (`viajesView.ts`,
 * la pestaña de Inicio y la cámara dentro de un viaje). El diseño de Viajes no
 * trae inglés: lo escribió App Frontend y queda marcado así.
 * Las claves son el español literal de la «Lista final de textos».
 */
export const EN_VIAJES_COMUN: Record<string, string> = {
  '{0} y {1}': '{0} and {1}',
  'Debes {0}': 'You owe {0}',
  'Te deben {0}': 'You are owed {0}',
  'Estás a mano': "You're even",
  'Bar': 'Bar',
  'Súper': 'Grocery',
  'Restaurantes': 'Restaurants',
  'Bares': 'Bars',
  'Cafés': 'Cafés',
  // La cámara dentro de un viaje: sin «Cargarlo a mano» (el ticket exige el recibo).
  'Prueba sacar la foto de nuevo con más luz.': 'Try taking the photo again with more light.',
  // Inicio · la pestaña Viajes (1a, 1b).
  'Viajes': 'Trips',
  'Cerrados': 'Closed',
  'Crear viaje': 'Create trip',
  'Todavía no tienes viajes': "You don't have any trips yet",
  'No pudimos cargar tus viajes': "We couldn't load your trips",
  // D246 · la lista elegida en Inicio › Viajes.
  'No tienes viajes cerrados': "You don't have closed trips",
  'Crea uno, suma a tus amigos y escaneen los tickets del viaje. PayMe va calculando quién le debe a quién.':
    'Create one, add your friends and scan the trip receipts. PayMe keeps track of who owes whom.',
  // D265 · D267 · cada viaje abierto en Inicio, como una mesa abierta.
  'Tus viajes abiertos': 'Your open trips',
  'Tu viaje abierto': 'Your open trip',
  'Ver viaje →': 'See trip →',
  // Los estados de error que comparten las pantallas de Viajes (propuestos en el plan).
  'Este viaje ya no está disponible.': 'This trip is no longer available.',
  'Ver tus viajes': 'See your trips',
  'No pudimos cargar el viaje': "We couldn't load the trip",
  'Este viaje ya se cerró.': 'This trip is already closed.',
  'No pudimos guardarlo. Prueba de nuevo.': "We couldn't save it. Try again.",
};
