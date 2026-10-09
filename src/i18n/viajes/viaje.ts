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
  'Ya elegiste consumos en {0} tickets. Podrás salir cuando se cierre el viaje y marques tu transferencia como pagada.':
    "You already chose items on {0} tickets. You'll be able to leave once the trip is closed and you mark your transfer as paid.",
  'Ya elegiste consumos en 1 ticket. Podrás salir cuando se cierre el viaje y marques tu transferencia como pagada.':
    "You already chose items on 1 ticket. You'll be able to leave once the trip is closed and you mark your transfer as paid.",
  'Ya elegiste consumos en este viaje. Podrás salir cuando se cierre el viaje y marques tu transferencia como pagada.':
    "You already chose items on this trip. You'll be able to leave once the trip is closed and you mark your transfer as paid.",
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
  'Balance': 'Balance',
  // D245 · la pantalla del viaje y Balance, más simples; D244 · la carga manual.
  'Carga manual': 'Add manually',
  'A favor: {0}': 'In your favor: {0}',
  'Consumos': 'Expenses',
  'Todavía no hay consumos.': 'No expenses yet.',
  'Pagó': 'Paid',
  'Descripción': 'Description',
  'Por ejemplo: gasolina': 'For example: gas',
  'Monto': 'Amount',
  '¿Entre quiénes?': 'Split between',
  'Se divide entre los marcados. Desmarca a quien no va.': "It's split among those checked. Uncheck anyone who isn't in.",
  'Total {0}': 'Total {0}',
  'Cargaste el gasto.': 'You added the expense.',
  'Alguien ya no está en el viaje. Revisa entre quiénes.': 'Someone is no longer on the trip. Check who it is split among.',
};
