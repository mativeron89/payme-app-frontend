import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import { informativeSelectionResponse } from '../../api/contractResponses';
import { originalParticipants } from '../../api/mesaPresentation';
import { leerParteDelDetalle } from '../../api/miParte';
import { decodeParticipantes } from '../../api/participantes';
import { cerroPorSeleccion } from '../../screens/MesaScreen';
import { readInformativeSelectionCapability } from '../../screens/informativeSelectionView';
import { propioEnConsumo, seleccionCierraLaMesa } from '../../screens/antesDeCerrar';
import { confirmedConsumptionProgress, restanteInformativo } from '../../screens/mesaItemsView';
import { EjemploLocal, type EstadoDelEjemplo } from './estadoEjemplo';
import { CODIGO_EJEMPLO, PLATOS_DE_EJEMPLO } from './fixtureEjemplo';
import {
  bloquearEnEjemplo,
  detalleDeEjemplo,
  participantesDeEjemplo,
  reemplazarInformativaEnEjemplo,
  seleccionInformativaDeEjemplo,
  soltarEnEjemplo,
} from './mesaDeEjemplo';

const [TAGLIATELLE, RISOTTO, PIZZA] = PLATOS_DE_EJEMPLO.map((p) => p.id);

function armada(division: 'consumo' | 'igual' | 'total', personas: number): EstadoDelEjemplo {
  const ejemplo = new EjemploLocal();
  ejemplo.empezar();
  ejemplo.armarMesa(division, personas, Date.UTC(2026, 9, 19, 12));
  return ejemplo.leer();
}

function con(estado: EstadoDelEjemplo, seleccion: ReadonlyMap<string, number>): EstadoDelEjemplo {
  return { ...estado, seleccion, guardadaEn: seleccion.size > 0 ? Date.UTC(2026, 9, 19, 12, 5) : null };
}

describe('D363 · el detalle de la mesa de ejemplo', () => {
  it('es el ticket de la ficha: Restaurante Ejemplo, tres platos y $600, mesa PA-1224 abierta', () => {
    const { mesa } = detalleDeEjemplo(armada('consumo', 1));
    expect(mesa.code).toBe(CODIGO_EJEMPLO);
    expect(mesa.restaurant.name).toBe('Restaurante Ejemplo');
    expect(mesa.items.map((i) => [i.name, i.price_cents, i.quantity])).toEqual([
      ['Tagliatelle Bolognese', 19500, 1],
      ['Risotto ai Funghi', 22000, 1],
      ['Pizza Margherita', 18500, 1],
    ]);
    expect(mesa.total_cents).toBe(60000);
    expect(mesa.status).toBe('open');
    expect(mesa.my_role).toBe('opener');
    expect(mesa.expected_participants).toBe(1);
    expect(originalParticipants(mesa.original_participants)).toBe(1);
  });

  it('P3 · publica guarantee_mode: false explícito y sin motivo de cierre', () => {
    const { mesa } = detalleDeEjemplo(armada('igual', 2));
    expect(Object.hasOwn(mesa, 'guarantee_mode')).toBe(true);
    expect(mesa.guarantee_mode).toBe(false);
    expect(mesa.closure_reason).toBeNull();
  });

  it('punto 5 · no trae nada que prenda la propina, «Mi parte» ni el desglose del ticket', () => {
    for (const division of ['consumo', 'igual', 'total'] as const) {
      const { mesa } = detalleDeEjemplo(armada(division, 2));
      for (const clave of ['tip_setting', 'share_totals', 'my_share', 'ticket_totals', 'ticket_adjustments']) {
        expect(Object.hasOwn(mesa, clave), `${division}: ${clave}`).toBe(false);
      }
      // Lo que leen las pantallas: «Mi parte» ausente entera, como un dueño que no la publica.
      expect(leerParteDelDetalle(mesa)).toEqual({ tipSetting: undefined, shareTotals: undefined, myShare: undefined });
    }
  });

  it('la selección informativa sólo existe en «igual», y el lector estricto de la pantalla la acepta', () => {
    const consumo = detalleDeEjemplo(armada('consumo', 2)).mesa;
    const igual = detalleDeEjemplo(armada('igual', 2)).mesa;
    const total = detalleDeEjemplo(armada('total', 1)).mesa;
    expect(readInformativeSelectionCapability(consumo.informative_selection_capability))
      .toEqual({ contract: 'payme.app.informative-selections/v2', supported: false, mutable: false });
    for (const mesa of [igual, total]) {
      expect(mesa.division_mode).toBe('igual');
      expect(readInformativeSelectionCapability(mesa.informative_selection_capability))
        .toEqual({ contract: 'payme.app.informative-selections/v2', supported: true, mutable: true });
      expect(mesa.items.every((i) => restanteInformativo(i) === 10000)).toBe(true);
      expect(mesa.division_slots?.map((s) => s.amount_cents).reduce((a, b) => a + b, 0)).toBe(60000);
    }
    expect(consumo.items.every((i) => i.informative_remaining_bps === null)).toBe(true);
    expect(consumo.division_slots).toBeUndefined();
  });

  it('la ficha: con el Tagliatelle elegido, la mesa va $195 de $600 (32,5 %), en consumo y en igual', () => {
    const consumo = detalleDeEjemplo(con(armada('consumo', 1), new Map([[TAGLIATELLE, 10000]]))).mesa;
    const igual = detalleDeEjemplo(con(armada('igual', 2), new Map([[TAGLIATELLE, 10000]]))).mesa;
    expect(confirmedConsumptionProgress(consumo)).toMatchObject({ status: 'known', assignedCents: 19500, complete: false });
    expect(confirmedConsumptionProgress(igual, (i) => i.informative_remaining_bps))
      .toMatchObject({ status: 'known', assignedCents: 19500, complete: false });
    const tag = consumo.items.find((i) => i.id === TAGLIATELLE)!;
    expect(tag).toMatchObject({ remaining_bps: 0, my_bps: 10000, locked_by_me: true, my_releasable_bps: 10000, my_paid_bps: 0 });
  });

  it('sin mesa armada no hay detalle: el ejemplo no inventa una mesa antes de Continuar', () => {
    const ejemplo = new EjemploLocal();
    ejemplo.empezar();
    expect(() => detalleDeEjemplo(ejemplo.leer())).toThrow('ejemplo_sin_mesa');
    expect(() => participantesDeEjemplo(ejemplo.leer())).toThrow('ejemplo_sin_mesa');
  });

  it('nadie más se sumó: la lista vacía es la que el decodificador real da para «nadie»', () => {
    expect(participantesDeEjemplo(armada('consumo', 3))).toEqual(decodeParticipantes({ participants: [] }));
    expect(participantesDeEjemplo(armada('consumo', 3))).toEqual([]);
  });
});

describe('D363 · reservar y soltar en «por lo que pidió cada uno»', () => {
  it('reserva lo pedido, reemplaza lo propio del plato y la reserva no vence', () => {
    const estado = armada('consumo', 2);
    const primera = bloquearEnEjemplo(estado, [{ item_id: TAGLIATELLE, fraction_bps: 5000 }]);
    expect(primera.respuesta).toEqual({
      locked: [TAGLIATELLE], claims: [{ item_id: TAGLIATELLE, fraction_bps: 5000 }], lock_token: 'ejemplo', lock_expires_at: null,
    });
    const segunda = bloquearEnEjemplo(con(estado, primera.seleccion), [{ item_id: TAGLIATELLE, fraction_bps: 10000 }]);
    expect([...segunda.seleccion]).toEqual([[TAGLIATELLE, 10000]]);
  });

  it('punto 2 · sin la bandera, elegir los tres platos abriría «Con esto se cierra la mesa»; por eso va primera', () => {
    const { mesa } = detalleDeEjemplo(armada('consumo', 1));
    const borrador = new Map(PLATOS_DE_EJEMPLO.map((p) => [p.id, 10000]));
    expect(seleccionCierraLaMesa(
      mesa, (item) => item.remaining_bps, (item) => propioEnConsumo(item, borrador), borrador, { escribeConCualquierBorrador: true },
    )).toBe(true);
    const vista = readFileSync(new URL('../../screens/MesaDetailView.tsx', import.meta.url), 'utf8');
    const sf = ts.createSourceFile('MesaDetailView.tsx', vista, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function* recorrer(n: ts.Node): Generator<ts.Node> {
      yield n;
      for (const h of n.getChildren()) yield* recorrer(h);
    }
    const nodos = [...recorrer(sf)];
    const declaraciones = nodos.filter((n): n is ts.VariableDeclaration =>
      ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === 'listoCierraLaMesa');
    expect(declaraciones).toHaveLength(1);
    const predictor = declaraciones[0].initializer;
    if (!predictor || !ts.isArrowFunction(predictor) || !ts.isBinaryExpression(predictor.body)) {
      throw new Error('el predictor no es la función de conjunción esperada');
    }
    let primero: ts.Expression = predictor.body;
    while (ts.isBinaryExpression(primero) && primero.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      primero = primero.left;
    }
    expect(ts.isPrefixUnaryExpression(primero) && primero.operator === ts.SyntaxKind.ExclamationToken
      && ts.isIdentifier(primero.operand) && primero.operand.text === 'ejemplo').toBe(true);

    const llamadas = nodos.filter((n): n is ts.CallExpression =>
      ts.isCallExpression(n) && n.expression.getText(sf) === 'listoCierraLaMesa');
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].arguments.map((a) => a.getText(sf))).toEqual(['foto']);
    const condicion = llamadas[0].parent;
    if (!ts.isBinaryExpression(condicion) || condicion.left !== llamadas[0]
        || condicion.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken
        || condicion.right.getText(sf) !== '!confirmado'
        || !ts.isIfStatement(condicion.parent) || condicion.parent.expression !== condicion
        || !ts.isBlock(condicion.parent.thenStatement)) {
      throw new Error('la única llamada no gobierna la hoja con la foto recién leída');
    }
    const apertura = nodos.filter((n): n is ts.CallExpression =>
      ts.isCallExpression(n) && n.expression.getText(sf) === 'setHojaCierre'
      && n.arguments.length === 1 && ts.isStringLiteral(n.arguments[0]) && n.arguments[0].text === 'seleccion');
    expect(apertura).toHaveLength(1);
    const pasos = condicion.parent.thenStatement.statements;
    expect(pasos).toHaveLength(2);
    expect(ts.isExpressionStatement(pasos[0]) && pasos[0].expression === apertura[0]).toBe(true);
    expect(ts.isReturnStatement(pasos[1]) && pasos[1].expression === undefined).toBe(true);
    const terminar = nodos.find((n): n is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(n) && n.name?.text === 'terminarListo');
    expect(terminar).toBeDefined();
    expect(condicion.getStart(sf) > terminar!.getStart(sf) && condicion.getEnd() < terminar!.getEnd()).toBe(true);
    const fotos = [...recorrer(terminar!)].filter((n): n is ts.VariableDeclaration =>
      ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === 'foto');
    expect(fotos).toHaveLength(1);
    const lectura = fotos[0].initializer;
    expect(lectura && ts.isAwaitExpression(lectura) && ts.isCallExpression(lectura.expression)
      && lectura.expression.expression.getText(sf) === 'onPrepararListo'
      && lectura.expression.arguments.length === 0).toBe(true);
    expect(fotos[0].getEnd() < condicion.getStart(sf)).toBe(true);
  });

  it('nunca dice que la selección cerró la mesa, aunque cubra los tres platos', () => {
    const { respuesta } = bloquearEnEjemplo(armada('consumo', 1), PLATOS_DE_EJEMPLO.map((p) => ({ item_id: p.id, fraction_bps: 10000 })));
    expect(Object.hasOwn(respuesta, 'mesa_status')).toBe(false);
    expect(cerroPorSeleccion(respuesta)).toBe(false);
  });

  it('una porción 1/k sólo con k ≤ min(N, 20), por fracción o por denominador', () => {
    const tres = armada('consumo', 3);
    expect(bloquearEnEjemplo(tres, [{ item_id: RISOTTO, fraction_denominator: 3 }]).respuesta.claims)
      .toEqual([{ item_id: RISOTTO, fraction_bps: 3333 }]);
    expect(bloquearEnEjemplo(tres, [{ item_id: RISOTTO, fraction_bps: 3333 }]).respuesta.claims)
      .toEqual([{ item_id: RISOTTO, fraction_bps: 3333 }]);
    expect(() => bloquearEnEjemplo(tres, [{ item_id: RISOTTO, fraction_denominator: 4 }]))
      .toThrow('fraction_denominator_exceeds_original');
    expect(() => bloquearEnEjemplo(tres, [{ item_id: RISOTTO, fraction_bps: 2500 }]))
      .toThrow('fraction_not_allowed_for_original_participants');
    expect(() => bloquearEnEjemplo(armada('consumo', 1), [{ item_id: RISOTTO, fraction_bps: 5000 }]))
      .toThrow('fraction_not_allowed_for_original_participants');
  });

  it('rechaza un plato que no es del ejemplo y no reserva en «igual»', () => {
    expect(() => bloquearEnEjemplo(armada('consumo', 2), [{ item_id: 'otro', fraction_bps: 10000 }])).toThrow('item_not_found');
    expect(() => bloquearEnEjemplo(armada('igual', 2), [{ item_id: PIZZA, fraction_bps: 10000 }]))
      .toThrow('fraction_denominator_consumo_only');
  });

  it('soltar devuelve lo propio por el decodificador real, y no lista lo que no había', () => {
    const estado = con(armada('consumo', 2), new Map([[TAGLIATELLE, 5000]]));
    const { seleccion, soltados } = soltarEnEjemplo(estado, [TAGLIATELLE, PIZZA]);
    expect(soltados).toEqual([{ itemId: TAGLIATELLE, fractionBps: 5000 }]);
    expect(seleccion.size).toBe(0);
  });
});

describe('D363 · la selección informativa del ejemplo («En partes iguales» y «Pagar el total»)', () => {
  it('lo guardado vuelve ordenado, con hora, abierto y mutable, por el decodificador estricto', () => {
    const estado = armada('igual', 2);
    const ahora = Date.UTC(2026, 9, 19, 12, 30);
    const { seleccion, respuesta } = reemplazarInformativaEnEjemplo(estado, {
      items: [{ item_id: PIZZA, declared_fraction_bps: 5000 }, { item_id: TAGLIATELLE, declared_fraction_bps: 10000 }],
      confirm_closure: true,
    }, ahora);
    expect([...seleccion]).toEqual([[PIZZA, 5000], [TAGLIATELLE, 10000]]);
    expect(respuesta.selection.items.map((i) => i.item_id)).toEqual([TAGLIATELLE, PIZZA].sort());
    expect(respuesta.selection.updated_at).toBe(new Date(ahora).toISOString());
    expect(respuesta.mesa).toEqual({ code: CODIGO_EJEMPLO, division_mode: 'igual', status: 'open', mutable: true, closure_reason: null });
    // Lo que contesta el ejemplo es lo que el decodificador acepta, byte por byte.
    expect(informativeSelectionResponse(JSON.parse(JSON.stringify(respuesta)))).toEqual(respuesta);
  });

  it('aunque cubra los tres platos, la mesa sigue abierta: nunca cierra sola en el ejemplo', () => {
    const { respuesta } = reemplazarInformativaEnEjemplo(armada('total', 1), {
      items: PLATOS_DE_EJEMPLO.map((p) => ({ item_id: p.id, declared_fraction_bps: 10000 })),
      confirm_closure: true,
    });
    expect(respuesta.coverage.all_items_selected).toBe(true);
    expect(cerroPorSeleccion({ mesa_status: respuesta.mesa.status, closure_reason: respuesta.mesa.closure_reason })).toBe(false);
  });

  it('sin nada guardado no hay hora; y la lectura refleja lo que quedó en el estado', () => {
    const vacia = seleccionInformativaDeEjemplo(armada('igual', 2));
    expect(vacia.selection).toEqual({ source: 'informative', items: [], updated_at: null });
    const guardada = seleccionInformativaDeEjemplo(con(armada('igual', 2), new Map([[RISOTTO, 5000]])));
    expect(guardada.selection.items).toEqual([{ item_id: RISOTTO, declared_fraction_bps: 5000 }]);
    expect(guardada.selection.updated_at).not.toBeNull();
  });

  it('valida como el dueño: confirm_closure, cada plato una vez y 1/k con k ≤ N', () => {
    const dos = armada('igual', 2);
    expect(() => reemplazarInformativaEnEjemplo(dos, { items: [], confirm_closure: false as unknown as true })).toThrow('validation_error');
    expect(() => reemplazarInformativaEnEjemplo(dos, {
      items: [{ item_id: PIZZA, declared_fraction_bps: 5000 }, { item_id: PIZZA, declared_fraction_bps: 5000 }],
      confirm_closure: true,
    })).toThrow('validation_error');
    expect(() => reemplazarInformativaEnEjemplo(dos, {
      items: [{ item_id: PIZZA, declared_fraction_bps: 3333 }], confirm_closure: true,
    })).toThrow('validation_error');
    expect(() => reemplazarInformativaEnEjemplo(dos, {
      items: [{ item_id: 'otro', declared_fraction_bps: 5000 }], confirm_closure: true,
    })).toThrow('item_not_found');
    expect(() => seleccionInformativaDeEjemplo(armada('consumo', 2))).toThrow('informative_selection_not_available_for_division_mode');
  });

  it('el restante informativo es el entero menos lo declarado, y lo declarado no es una reserva', () => {
    const { mesa } = detalleDeEjemplo(con(armada('igual', 3), new Map([[RISOTTO, 3333]])));
    const risotto = mesa.items.find((i) => i.id === RISOTTO)!;
    expect(restanteInformativo(risotto)).toBe(6667);
    expect(risotto).toMatchObject({ remaining_bps: 10000, my_bps: 0, locked_by_me: false, my_releasable_bps: 0 });
  });
});
