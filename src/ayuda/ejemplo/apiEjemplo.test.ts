import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, type Api } from '../../api';
import {
  CLASIFICACION_DEL_EJEMPLO,
  PedidoCortadoPorElEjemplo,
  RECIBEN_CODIGO_DE_MESA,
  envolverApi,
  type ClaseDelMetodo,
} from './apiEjemplo';
import { EjemploLocal } from './estadoEjemplo';
import { PLATOS_DE_EJEMPLO, RESTAURANTE_DE_EJEMPLO } from './fixtureEjemplo';

/**
 * La población sale de la interfaz `Api` leída con el compilador, no de una
 * lista escrita acá: un método nuevo de la fachada sin clasificar pone esto rojo.
 */
function miembrosDeLaInterfaz(): ReadonlyArray<{ readonly nombre: string; readonly primerParametro: string | null; readonly tipo: string | null }> {
  const ruta = new URL('../../api/index.ts', import.meta.url);
  const fuente = ts.createSourceFile('index.ts', readFileSync(ruta, 'utf8'), ts.ScriptTarget.Latest, true);
  const interfaz = fuente.statements.find((s): s is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(s) && s.name.text === 'Api');
  if (!interfaz) throw new Error('falta la interfaz Api en src/api/index.ts');
  return interfaz.members.map((m) => {
    if (!ts.isMethodSignature(m)) throw new Error(`miembro que no es método: ${m.getText(fuente)}`);
    const primero = m.parameters[0];
    return {
      nombre: m.name.getText(fuente),
      primerParametro: primero ? primero.name.getText(fuente) : null,
      tipo: primero?.type ? primero.type.getText(fuente) : null,
    };
  });
}

const METODOS = Object.keys(CLASIFICACION_DEL_EJEMPLO) as Array<keyof Api>;
const DE_CLASE = (clase: ClaseDelMetodo) => METODOS.filter((m) => CLASIFICACION_DEL_EJEMPLO[m] === clase);
type Metodo = (...args: unknown[]) => unknown;

/** Una fachada falsa: cada método anota con qué lo llamaron y contesta su nombre. */
function baseFalsa() {
  const llamadas: Array<{ metodo: string; args: unknown[]; esBase: boolean }> = [];
  const base = {} as Record<string, Metodo>;
  for (const metodo of METODOS) {
    base[metodo] = function (this: unknown, ...args: unknown[]) {
      llamadas.push({ metodo, args, esBase: this === base });
      return Promise.resolve(`base:${metodo}`);
    };
  }
  return { base: base as unknown as Api, llamadas };
}

function llamar(fachada: Api, metodo: keyof Api, ...args: unknown[]): unknown {
  return (fachada[metodo] as unknown as Metodo)(...args);
}

afterEach(() => vi.restoreAllMocks());

describe('D363 · la clasificación cubre toda la fachada', () => {
  it('cada método de la interfaz Api tiene clase, y no hay clases de métodos que no existen', () => {
    const interfaz = miembrosDeLaInterfaz().map((m) => m.nombre).sort();
    expect(interfaz.length).toBeGreaterThan(0);
    expect([...METODOS].sort()).toEqual(interfaz);
  });

  it('los seis locales son los que MesaScreen pide solo, y todos reciben el código de la mesa', () => {
    expect(DE_CLASE('local').sort()).toEqual(
      ['getInformativeSelection', 'getMesa', 'getMesaParticipants', 'lockItems', 'releaseItems', 'replaceInformativeSelection'],
    );
    for (const metodo of DE_CLASE('local')) expect(RECIBEN_CODIGO_DE_MESA.has(metodo), metodo).toBe(true);
  });

  it('los que reciben un código de mesa son exactamente los de primer parámetro `code`/`mesaCode: string`', () => {
    const porLaInterfaz = new Set(miembrosDeLaInterfaz()
      .filter((m) => (m.primerParametro === 'code' || m.primerParametro === 'mesaCode') && m.tipo === 'string')
      .map((m) => m.nombre));
    // Excepción registrada: el `code` de googleRedirectRedeem es el de OAuth de Google, no el de una mesa.
    expect(porLaInterfaz.has('googleRedirectRedeem')).toBe(true);
    porLaInterfaz.delete('googleRedirectRedeem');
    expect([...RECIBEN_CODIGO_DE_MESA].sort()).toEqual([...porLaInterfaz].sort());
  });

  it('revisión de V sobre ff5dec7 · la lista «pasa» está fijada: un método nuevo o reclasificado se decide a mano', () => {
    // Literal, no un snapshot: `-u` no lo reescribe. Los 117 que pasan tal cual a la fachada con el ejemplo activo.
    const pasa = (Object.keys(CLASIFICACION_DEL_EJEMPLO) as Array<keyof typeof CLASIFICACION_DEL_EJEMPLO>)
      .filter((m) => CLASIFICACION_DEL_EJEMPLO[m] === 'pasa').sort();
    expect(pasa).toEqual([
      'acceptFriendRequest', 'acceptInvitation', 'acceptInvitationLink', 'acceptLegal', 'aceptarViaje',
      'acknowledgeFriendAvatarNotice', 'addFriend', 'addGroupMember', 'blockUser', 'borrarNotaDeViaje',
      'cambiarLinkDeInvitacion', 'cancelFriendRequest', 'cargarGastoDeViaje', 'cargarTicketDeViaje', 'cerrarViaje',
      'completeRecovery', 'corregirTicketDeViaje', 'crearNotaDeViaje', 'crearViaje', 'createGroup',
      'deleteAllNotifications', 'deleteGroup', 'deleteNotification', 'deleteProfileAvatar', 'editarNotaDeViaje',
      'editarViaje', 'elegirEnTicketDeViaje', 'eliminarTicketDeViaje', 'facebookLoginComplete', 'facebookLoginStart',
      'facebookRegisterComplete', 'facebookRegisterStart', 'getAvatarDeMiembroDeViaje', 'getCierreDeViaje',
      'getConfig', 'getFotoDeViaje', 'getFriendAvatar', 'getFriendAvatarNotice', 'getFriends', 'getGroup',
      'getGroups', 'getHistory', 'getIncomingFriendRequests', 'getInvitacionesAViajes', 'getInvitationInviterAvatar',
      'getInviterAvatar', 'getLegalAcceptance', 'getLegalText', 'getLinkDeInvitacion', 'getLinkedProviders', 'getMe',
      'getMovement', 'getMyMesas', 'getNotasDeViaje', 'getNotificationPreferences', 'getNotifications',
      'getOpenMesas', 'getOutgoingFriendRequests', 'getPendingInvitations', 'getPrivacyNotice', 'getProfileAvatar',
      'getProfileIdentity', 'getResumenDeViaje', 'getStats', 'getStatsDayparts', 'getStatsDishes',
      'getStatsEvolution', 'getStatsIngredients', 'getStatsRestaurants', 'getTicketDeViaje', 'getUnreadCount',
      'getUsername', 'getUsernameAvatar', 'getUsernameSuggestion', 'getViaje', 'getViajes', 'getVisitasDeViajes',
      'googleContinue', 'googleContinueLink', 'googleLink', 'googleLinkRedirectComplete', 'googleLinkRedirectStart',
      'googleLogin', 'googleRedirectRedeem', 'googleRedirectSignup', 'googleRegister', 'invitarAlViaje', 'login',
      'logout', 'marcarPresentesEnTicket', 'marcarTransferenciaDeViaje', 'markAllNotificationsRead',
      'markNotificationRead', 'mostrarPago', 'ocultarPago', 'onLegalAcceptanceRequired', 'onSessionExpired',
      'onUsernameRequired', 'ordenarNotasDeViaje', 'putNotificationPreferences', 'putProfileAvatar', 'putUsername',
      'quitarFotoDeViaje', 'rechazarViaje', 'register', 'rejectFriendRequest', 'removeFriend', 'removeGroupMember',
      'requestRecovery', 'restoreSession', 'revisarTicketDeViaje', 'salirDeViaje', 'searchUsernames',
      'subirFotoDeViaje', 'tildarItemDeNota', 'unblockUser', 'updateProfileIdentity',
    ]);
  });

  it('P3 · cerrar la mesa, pagar y pedir las solicitudes quedan cortados; y crear una mesa también', () => {
    for (const metodo of ['closeMesa', 'payMesa', 'getMesaJoinRequests', 'createMesa', 'scanTicket', 'fijarPropinaDeLaMesa', 'createInvitation', 'getPaymentMethods'] as const) {
      expect(CLASIFICACION_DEL_EJEMPLO[metodo], metodo).toBe('cortado');
    }
  });
});

describe('D363 · la fachada envuelta', () => {
  it('con el ejemplo apagado y otro código, todo pasa tal cual a la fachada, con sus argumentos y su this', async () => {
    const { base, llamadas } = baseFalsa();
    const envuelta = envolverApi(base, new EjemploLocal());
    for (const metodo of METODOS) {
      await expect(llamar(envuelta, metodo, 'PA-12345', 'segundo')).resolves.toBe(`base:${metodo}`);
    }
    expect(llamadas.map((l) => l.metodo)).toEqual(METODOS);
    expect(llamadas.every((l) => l.esBase && l.args[0] === 'PA-12345' && l.args[1] === 'segundo')).toBe(true);
  });

  it('con el ejemplo apagado, PA-1224 (sin distinguir mayúsculas ni bordes) nunca llega a la fachada', async () => {
    const { base, llamadas } = baseFalsa();
    const envuelta = envolverApi(base, new EjemploLocal());
    for (const metodo of RECIBEN_CODIGO_DE_MESA) {
      for (const code of ['PA-1224', 'pa-1224', ' Pa-1224 ']) {
        await expect(llamar(envuelta, metodo, code)).rejects.toBeInstanceOf(PedidoCortadoPorElEjemplo);
      }
      // Control positivo: un código parecido sí pasa.
      await expect(llamar(envuelta, metodo, 'PA-12240')).resolves.toBe(`base:${metodo}`);
    }
    expect(llamadas.every((l) => l.args[0] === 'PA-12240')).toBe(true);
    expect(llamadas).toHaveLength(RECIBEN_CODIGO_DE_MESA.size);
  });

  it('el restaurante del ejemplo nunca sale: ni createMesa con su restaurant_id ni getRestaurant con su id, apagado o activo', async () => {
    for (const activo of [false, true]) {
      const { base, llamadas } = baseFalsa();
      const ejemplo = new EjemploLocal();
      if (activo) ejemplo.empezar();
      const envuelta = envolverApi(base, ejemplo);
      await expect(llamar(envuelta, 'createMesa', { restaurant_id: RESTAURANTE_DE_EJEMPLO.id, total_cents: 60000 })).rejects.toBeInstanceOf(PedidoCortadoPorElEjemplo);
      await expect(llamar(envuelta, 'getRestaurant', RESTAURANTE_DE_EJEMPLO.id)).rejects.toBeInstanceOf(PedidoCortadoPorElEjemplo);
      expect(llamadas, String(activo)).toEqual([]);
    }
    // Control positivo: con el ejemplo apagado, otro restaurante pasa en los dos.
    const { base, llamadas } = baseFalsa();
    const envuelta = envolverApi(base, new EjemploLocal());
    await expect(llamar(envuelta, 'createMesa', { restaurant_id: 'b0000000-0000-4000-8000-000000000001', total_cents: 60000 })).resolves.toBe('base:createMesa');
    await expect(llamar(envuelta, 'getRestaurant', 'b0000000-0000-4000-8000-000000000001')).resolves.toBe('base:getRestaurant');
    expect(llamadas.map((l) => l.metodo)).toEqual(['createMesa', 'getRestaurant']);
  });

  it('un método que no recibe código de mesa no se corta por un texto igual a PA-1224', async () => {
    const { base, llamadas } = baseFalsa();
    const envuelta = envolverApi(base, new EjemploLocal());
    await expect(llamar(envuelta, 'searchUsernames', 'pa-1224')).resolves.toBe('base:searchUsernames');
    await expect(llamar(envuelta, 'googleRedirectRedeem', 'PA-1224')).resolves.toBe('base:googleRedirectRedeem');
    expect(llamadas).toHaveLength(2);
  });

  it('con el ejemplo activo, los cortados se rechazan con cualquier argumento; apagado, pasan (control)', async () => {
    const ejemplo = new EjemploLocal();
    const { base, llamadas } = baseFalsa();
    const envuelta = envolverApi(base, ejemplo);
    ejemplo.empezar();
    for (const metodo of DE_CLASE('cortado')) {
      await expect(llamar(envuelta, metodo, 'PA-12345')).rejects.toMatchObject({ metodo, message: 'ejemplo_sin_red' });
      await expect(llamar(envuelta, metodo)).rejects.toBeInstanceOf(PedidoCortadoPorElEjemplo);
    }
    expect(llamadas).toHaveLength(0);
    ejemplo.descartar();
    for (const metodo of DE_CLASE('cortado')) await llamar(envuelta, metodo, 'PA-12345');
    expect(llamadas.map((l) => l.metodo)).toEqual(DE_CLASE('cortado'));
  });

  it('con el ejemplo activo, lo que pasa sigue pasando (avisos, amigos, Inicio)', async () => {
    const ejemplo = new EjemploLocal();
    const { base, llamadas } = baseFalsa();
    const envuelta = envolverApi(base, ejemplo);
    ejemplo.empezar();
    for (const metodo of DE_CLASE('pasa')) await expect(llamar(envuelta, metodo)).resolves.toBe(`base:${metodo}`);
    expect(llamadas.map((l) => l.metodo)).toEqual(DE_CLASE('pasa'));
  });

  it('con el ejemplo activo, los locales contestan de memoria para PA-1224 y pasan con otro código', async () => {
    const ejemplo = new EjemploLocal();
    const { base, llamadas } = baseFalsa();
    const envuelta = envolverApi(base, ejemplo);
    ejemplo.empezar();
    // Antes de Continuar no hay mesa: el rechazo es de la memoria, no de la red.
    await expect(envuelta.getMesa('PA-1224')).rejects.toThrow('ejemplo_sin_mesa');
    ejemplo.armarMesa('consumo', 2, 0);
    const detalle = await envuelta.getMesa('pa-1224');
    expect(detalle.mesa.code).toBe('PA-1224');
    expect(await envuelta.getMesaParticipants('PA-1224')).toEqual([]);
    expect(llamadas).toHaveLength(0);
    for (const metodo of DE_CLASE('local')) await llamar(envuelta, metodo, 'PA-12345', []);
    expect(llamadas.map((l) => l.metodo)).toEqual(DE_CLASE('local'));
  });

  it('reservar y soltar en el ejemplo cambian la mesa que se vuelve a leer', async () => {
    const ejemplo = new EjemploLocal();
    const envuelta = envolverApi(baseFalsa().base, ejemplo);
    ejemplo.empezar();
    ejemplo.armarMesa('consumo', 2, 0);
    const tag = PLATOS_DE_EJEMPLO[0]!.id;
    await envuelta.lockItems('PA-1224', [{ item_id: tag, fraction_denominator: 2 }]);
    expect((await envuelta.getMesa('PA-1224')).mesa.items.find((i) => i.id === tag)).toMatchObject({ my_bps: 5000, remaining_bps: 5000 });
    expect(await envuelta.releaseItems('PA-1224', [tag])).toEqual([{ itemId: tag, fractionBps: 5000 }]);
    expect((await envuelta.getMesa('PA-1224')).mesa.items.find((i) => i.id === tag)).toMatchObject({ my_bps: 0, remaining_bps: 10000 });
  });

  it('la selección informativa guardada en el ejemplo se vuelve a leer igual', async () => {
    const ejemplo = new EjemploLocal();
    const envuelta = envolverApi(baseFalsa().base, ejemplo);
    ejemplo.empezar();
    ejemplo.armarMesa('igual', 2, 0);
    const pizza = PLATOS_DE_EJEMPLO[2]!.id;
    const guardada = await envuelta.replaceInformativeSelection('PA-1224', {
      items: [{ item_id: pizza, declared_fraction_bps: 5000 }], confirm_closure: true,
    });
    expect(await envuelta.getInformativeSelection('PA-1224')).toEqual(guardada);
    expect((await envuelta.getMesa('PA-1224')).mesa.items.find((i) => i.id === pizza)?.informative_remaining_bps).toBe(5000);
  });

  it('sigue asignable y lee el método de la fachada en cada llamada (los tests que reemplazan api.X)', async () => {
    const { base } = baseFalsa();
    const envuelta = envolverApi(base, new EjemploLocal());
    (base as unknown as Record<string, Metodo>).getOpenMesas = () => Promise.resolve('reemplazado en la base');
    await expect(envuelta.getOpenMesas()).resolves.toBe('reemplazado en la base');
    const propio = vi.fn(() => Promise.resolve({ mesas: [] }));
    envuelta.getOpenMesas = propio;
    await envuelta.getOpenMesas();
    expect(propio).toHaveBeenCalledTimes(1);
  });
});

describe('D363 · el cableado: la `api` de la app es la envuelta', () => {
  it('tiene todos los métodos clasificados, y PA-1224 no sale a la red con el ejemplo apagado', async () => {
    expect(Object.keys(api).sort()).toEqual([...METODOS].sort());
    const red = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no debería salir'));
    await expect(api.getMesa('PA-1224')).rejects.toBeInstanceOf(PedidoCortadoPorElEjemplo);
    await expect(api.closeMesa('pa-1224')).rejects.toBeInstanceOf(PedidoCortadoPorElEjemplo);
    expect(red).not.toHaveBeenCalled();
  });
});
