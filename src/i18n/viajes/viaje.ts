/** AF-VIAJES · EN de las pantallas de Viajes (viaje). El diseño no trae inglés: lo escribió App Frontend. */
export const EN_VIAJES_VIAJE: Record<string, string> = {
  // 1g · el viaje abierto. «Escanear ticket», «Pagó {0}» y «Te toca» los usa también el ticket (1i, 1k):
  // viven acá. «Pagaste tú» es de otro archivo de Viajes y «Esperando pagos · faltan {0}» de `listas.ts`.
  'Escanear ticket': 'Scan ticket',
  'Pagó {0}': 'Paid by {0}',
  'Te toca': 'Your share',
  'Ver balance del viaje': 'See trip balance',
  'Falta que elija {0}': '{0} still to choose',
  'Cerrar viaje': 'Close trip',
  'Salir del viaje': 'Leave trip',
  // 1m · cerrar.
  '¿Cerrar {0}?': 'Close {0}?',
  'Ya no se pueden cargar tickets. PayMe calcula lo que debe cada uno y sugiere quién le transfiere a quién.':
    "No more tickets can be added. PayMe works out what each person owes and suggests who transfers to whom.",
  '{0} todavía no eligió en {1} del {2}. Si cierras ahora, los {3} que faltan se le asignan a {4}.':
    "{0} hasn't chosen yet at {1} on {2}. If you close now, the remaining {3} is assigned to {4}.",
  '{0} todavía no eligieron en {1} del {2}. Si cierras ahora, los {3} que faltan se reparten en partes iguales entre {4}.':
    "{0} haven't chosen yet at {1} on {2}. If you close now, the remaining {3} is split equally between {4}.",
  'Todavía no elegiste en {0} del {1}. Si cierras ahora, los {2} que faltan se te asignan a ti.':
    "You haven't chosen yet at {0} on {1}. If you close now, the remaining {2} is assigned to you.",
  'Todos eligieron lo suyo en los {0} tickets.': 'Everyone chose their items on the {0} tickets.',
  'Todos eligieron lo suyo en el ticket.': 'Everyone chose their items on the ticket.',
  'tú': 'you',
  'Les avisamos a todos que cerraste el viaje.': "We'll let everyone know you closed the trip.",
  'Revisar tickets': 'Review tickets',
  // Salir y 1q.
  '¿Salir de {0}?': 'Leave {0}?',
  'Ya no vas a ver los tickets de este viaje.': "You won't see this trip's tickets anymore.",
  'Saliste de {0}.': 'You left {0}.',
  'Todavía no puedes salir de {0}': "You can't leave {0} yet",
  'Ya elegiste consumos en {0} tickets. Podrás salir cuando se cierre el viaje y tus transferencias estén confirmadas.':
    "You already chose items on {0} tickets. You'll be able to leave once the trip is closed and your transfers are confirmed.",
  'Ya elegiste consumos en 1 ticket. Podrás salir cuando se cierre el viaje y tus transferencias estén confirmadas.':
    "You already chose items on 1 ticket. You'll be able to leave once the trip is closed and your transfers are confirmed.",
  'Ya elegiste consumos en este viaje. Podrás salir cuando se cierre el viaje y tus transferencias estén confirmadas.':
    "You already chose items on this trip. You'll be able to leave once the trip is closed and your transfers are confirmed.",
  'Tienes 1 transferencia sin confirmar. Podrás salir cuando esté confirmada.':
    'You have 1 unconfirmed transfer. You can leave once it is confirmed.',
  'Tienes {0} transferencias sin confirmar. Podrás salir cuando todas estén confirmadas.':
    'You have {0} unconfirmed transfers. You can leave once they are all confirmed.',
  'Pagaste un ticket de este viaje. Podrás salir cuando se cierre el viaje y quede todo pagado.':
    "You paid a ticket on this trip. You'll be able to leave once the trip is closed and everything is paid.",
  'Estás entre los que estuvieron en un ticket en partes iguales. Podrás salir cuando se cierre el viaje y quede todo pagado.':
    "You're among the people on a ticket split equally. You'll be able to leave once the trip is closed and everything is paid.",
  // 1n · 1o · 1p · esperando pagos.
  'Gasto del grupo {0}': 'Group spending {0}',
  'Transferencias sugeridas · {0}': 'Suggested transfers · {0}',
  'Tú le transfieres {0} a {1}': 'You transfer {0} to {1}',
  '{0} le transfiere {1} a {2}': '{0} transfers {1} to {2}',
  'Hazla desde tu banco y márcala aquí.': 'Make it from your bank and mark it here.',
  'Ya pagué': 'I paid',
  'Esperando que {0} confirme': 'Waiting for {0} to confirm',
  'Pendiente': 'Pending',
  'Anulada: una de las cuentas se dio de baja.': 'Voided: one of the accounts was deleted.',
  'PayMe no mueve dinero. Cada uno transfiere desde su banco y lo marca aquí.':
    "PayMe doesn't move money. Each person transfers from their bank and marks it here.",
  'Te transfieren': 'Transfers to you',
  '{0} marcó que te pagó. Revisa tu banco y confírmalo.': '{0} marked that they paid you. Check your bank and confirm it.',
  'No me llegó': "I didn't get it",
  'Recibí': 'I got it',
  'Faltan {0} de {1}': '{0} of {1} left',
  'transferencias': 'transfers',
  'Cuando todas estén pagadas, el viaje pasa a Cerrados.': 'Once they are all paid, the trip moves to Closed.',
  '{0} quedó cerrado. Todos pagaron y ya está en Cerrados.': '{0} is closed. Everyone paid and it is now in Closed.',
  // 1l · el balance en vivo.
  // D245 · la pantalla del viaje y Balance, más simples; D244 · la carga manual.
  'Carga manual': 'Add manually',
  'A favor: {0}': 'In your favor: {0}',
  'Consumos': 'Expenses',
  'Todavía no hay consumos.': 'No expenses yet.',
  // D256 · eliminar un ticket o un gasto desde Consumos.
  'Ticket eliminado': 'Receipt deleted',
  'Gasto eliminado': 'Expense deleted',
  'Ya no estaba': 'It was already gone',
  'El viaje ya no está abierto': 'The trip is no longer open',
  'Sólo pueden eliminarlo quien lo cargó o quien lo pagó.': 'Only the person who added it or who paid can delete it.',
  'No pudimos eliminarlo. Prueba de nuevo.': "We couldn't delete it. Try again.",
  'Pagó': 'Paid',
  'Descripción': 'Description',
  'Por ejemplo: gasolina': 'For example: gas',
  'Monto': 'Amount',
  '¿Entre quiénes?': 'Split between',
  'Se divide entre los marcados. Desmarca a quien no va.': "It's split among those checked. Uncheck anyone who isn't in.",
  'Total {0}': 'Total {0}',
  'Cargaste el gasto.': 'You added the expense.',
  'Escanear ticket para {0}': 'Scan a ticket for {0}',
  'Ticket para {0}': 'Ticket for {0}',
  'Alguien ya no está en el viaje. Revisa entre quiénes.': 'Someone is no longer on the trip. Check who it is split among.',
  // D255-8 · Configuración del viaje.
  'Agregar miembros': 'Add members',
  'Ya están en el viaje': 'Already on the trip',
  'Le mandamos la invitación a {0}.': 'We sent {0} an invitation.',
  'Invitados': 'Invited',
  'Falta que acepte': "Hasn't accepted yet",
  'Nombre y fechas': 'Name and dates',
  'Color': 'Color',
  'Foto': 'Photo',
  // D255 tramo 2 · nombre, fechas, color y foto del viaje.
  'Azul': 'Blue',
  'Verde': 'Green',
  'Violeta': 'Violet',
  'Rojo': 'Red',
  'Naranja': 'Orange',
  'Turquesa': 'Teal',
  'Sin color': 'No color',
  'Guardamos los cambios.': 'Changes saved.',
  'Listo: el viaje tiene foto nueva.': 'Done: the trip has a new photo.',
  'Quitamos la foto del viaje.': 'We removed the trip photo.',
  'La ven sólo los miembros del viaje.': 'Only trip members can see it.',
  'Cambiar la foto': 'Change the photo',
  'Elegir foto': 'Choose photo',
  'Muchas fotos seguidas. Prueba en unos minutos.': 'Too many photos in a row. Try again in a few minutes.',
  'Esa foto no sirve: usa una JPG, PNG o WEBP de hasta 5 MB.': "That photo won't work: use a JPG, PNG, or WEBP up to 5 MB.",
};
