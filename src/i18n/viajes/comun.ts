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
  // D302 · los viajes que todavía no empezaron, en Inicio › Viajes.
  'Próximos': 'Upcoming',
  'Viajes próximos': 'Upcoming trips',
  'No tienes viajes próximos': "You don't have upcoming trips",
  'Crea uno, suma a tus amigos y escaneen los tickets del viaje. PayMe va calculando quién le debe a quién.':
    'Create one, add your friends and scan the trip receipts. PayMe keeps track of who owes whom.',
  // D265 · D275 · cada viaje abierto en Inicio: foto, nombre y monto; lo que oye el lector de pantalla.
  'Tus viajes abiertos': 'Your open trips',
  '{0}, te deben {1}': '{0}, you are owed {1}',
  '{0}, debes {1}': '{0}, you owe {1}',
  '{0}, estás al día': "{0}, you're all settled",
  // D271 · D275 · el restaurante del viaje con gente por elegir.
  'Faltan {0} por elegir': '{0} left to choose',
  'Falta 1 por elegir': '1 left to choose',
  '{0}, faltan {1} por elegir': '{0}, {1} left to choose',
  '{0}, falta 1 por elegir': '{0}, 1 left to choose',
  // Los estados de error que comparten las pantallas de Viajes (propuestos en el plan).
  'Este viaje ya no está disponible.': 'This trip is no longer available.',
  'Ver tus viajes': 'See your trips',
  'No pudimos cargar el viaje': "We couldn't load the trip",
  'Este viaje ya se cerró.': 'This trip is already closed.',
  'No pudimos guardarlo. Prueba de nuevo.': "We couldn't save it. Try again.",
};
