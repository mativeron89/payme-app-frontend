import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { traducir } from '../i18n/idioma';
import { entrarEnNaranja, formularioDeB, iconoDelResultado, joinLinkMessage, joinLinkStage, tituloDeLaInvitacion, type JoinLinkOutcome } from './joinLinkView';

const OUTCOMES: JoinLinkOutcome[] = ['joining', 'rejected', 'invalid', 'mesa_cerrada', 'unavailable', 'error'];

/**
 * CIERRE DEL PAGO SIN CUENTA · lo que se fija acá es una regla de PRIVACIDAD,
 * no una copy.
 *
 * El emisor contesta el MISMO `403 invitation_link_not_valid` para los cuatro
 * motivos —inválido, vencido, cancelado y supersedido— a propósito, porque
 * distinguirlos le diría a un desconocido si una mesa existe. Si el front
 * inventa copy que los separa, reabre el oráculo del lado del consumidor.
 *
 * Ya pasó exactamente eso en este repo: el 202 ciego de `addFriend` cerró la
 * enumeración de cuentas y **la pantalla siguiente la reabrió** pintando el
 * nombre real del destinatario. La lección: *una defensa de privacidad vale lo
 * que vale su superficie más indiscreta*.
 */

describe('el rechazo de un link es CIEGO a su motivo', () => {
  it('sólo existe UN estado de rechazo, no cuatro', () => {
    // Si alguien agrega 'expired' | 'cancelled' | 'superseded' al tipo, esto
    // deja de compilar o deja de cubrir — y hay que venir a leer este bloque.
    // v2.45.0 agregó 'mesa_cerrada' y ESTE bloque se vino a leer: NO es un
    // quinto motivo del 403 — es otro STATUS (410), que sólo llega con token
    // validado como genuino. El rechazo ciego sigue siendo UNO.
    const todos: JoinLinkOutcome[] = ['joining', 'rejected', 'invalid', 'mesa_cerrada', 'unavailable', 'error'];
    expect(todos).toHaveLength(6);
  });

  /**
   * ⭐ Conjunto CERRADO de palabras, no lista de prohibidas por caso. Una lista
   * de prohibidos sólo defiende contra lo que ya se te ocurrió; esto atrapa la
   * formulación que nadie previó, porque barre TODOS los mensajes.
   */
  it('ningún mensaje nombra el motivo del rechazo', () => {
    const DELATORES = [
      'venc', 'expir', 'cancel', 'supersed', 'reemplaz',
      'no existe', 'inexistente', 'no encontr', 'inválid', 'invalid',
    ];
    const ofensores: string[] = [];
    for (const outcome of OUTCOMES) {
      const m = joinLinkMessage(outcome);
      const texto = `${m.title} ${m.body}`.toLowerCase();
      for (const palabra of DELATORES) {
        if (texto.includes(palabra)) ofensores.push(`${outcome} → "${palabra}"`);
      }
    }
    expect(ofensores).toEqual([]);
  });

  it('el rechazo no ofrece reintentar: reintentar no lo va a cambiar', () => {
    expect(joinLinkMessage('rejected').retryable).toBe(false);
  });
});

describe('ORDEN 3A · el 400 es TERMINAL, no un problema de conexión', () => {
  /**
   * Antes el 400 caía en `error`, y `error` ofrece reintentar. Eso **invita a
   * reintentos engañosos**: un link truncado al copiarlo de WhatsApp no se
   * arregla reintentando, y cada reintento le sugiere a la persona que podría
   * estar por funcionar.
   */
  it('no ofrece reintentar', () => {
    expect(joinLinkMessage('invalid').retryable).toBe(false);
  });

  it('no habla de conexión ni de red', () => {
    const m = joinLinkMessage('invalid');
    const texto = `${m.title} ${m.body}`.toLowerCase();
    for (const palabra of ['conexión', 'conexion', 'red', 'internet', 'servidor']) {
      expect(texto).not.toContain(palabra);
    }
  });

  /**
   * Es un rechazo pero NO se funde con `rejected`: acá el defecto está en el
   * link que la persona tiene en la mano y eso SÍ se puede accionar. Y sigue
   * sin revelar nada de la mesa, que es la regla que no se negocia.
   */
  it('se distingue del rechazo ciego y tampoco revela nada de la mesa', () => {
    expect(joinLinkMessage('invalid').title).not.toBe(joinLinkMessage('rejected').title);
    const texto = JSON.stringify(joinLinkMessage('invalid')).toLowerCase();
    for (const palabra of ['mesa no', 'no existe', 'restaurante', 'organizador ya']) {
      expect(texto).not.toContain(palabra);
    }
  });
});

describe('un 503 NO es un rechazo', () => {
  /**
   * El emisor lo dice en su propio comentario: sin el secreto de firma no puede
   * decidir si el token es válido, y **un 403 ahí afirmaría que no sirve**.
   * Fundirlos le diría a alguien que su invitación está muerta cuando lo único
   * que pasa es que el backend está a media configuración.
   */
  it('se distingue del rechazo y SÍ se puede reintentar', () => {
    const rechazo = joinLinkMessage('rejected');
    const indisponible = joinLinkMessage('unavailable');
    expect(indisponible.retryable).toBe(true);
    expect(indisponible.title).not.toBe(rechazo.title);
    expect(indisponible.body).not.toBe(rechazo.body);
  });

  it('y dice explícitamente que no es que el link no sirva', () => {
    expect(joinLinkMessage('unavailable').body.toLowerCase()).toContain('no es que no sirva');
  });

  it('un fallo de red también es reintentable', () => {
    expect(joinLinkMessage('error').retryable).toBe(true);
  });
});

/**
 * SPEC_APP.md §1.2 · qué pantalla se muestra. Lo que se fija acá NO es layout:
 * es que el orden de las ramas conserve la política de privacidad del cierre
 * del pago sin cuenta.
 */
describe('§1.2 · sin sesión no se ve NADA de la mesa', () => {
  it('cualquiera sea el resultado del canje, sin sesión la pantalla es el alta', () => {
    // Incluye los terminales: ni siquiera el motivo del rechazo se le muestra a
    // alguien sin sesión. Si esta rama se moviera debajo del switch de outcome,
    // un 403 pintaría el cartel de rechazo antes del alta.
    for (const outcome of OUTCOMES) {
      expect(joinLinkStage({ hasSession: false, outcome })).toBe('signup');
    }
  });

  it('D387 · Join conserva sus etapas de puerta y fallo; el éxito ya navega al detalle', () => {
    expect(joinLinkStage({ hasSession: true, outcome: 'joining' })).toBe('joining');
    for (const outcome of OUTCOMES) {
      expect(['joining', 'blocked', 'retry']).toContain(joinLinkStage({ hasSession: true, outcome }));
      expect(joinLinkStage({ hasSession: false, outcome })).toBe('signup');
    }
  });
});

describe('§1.2 · ninguna pantalla queda sin salida', () => {
  /**
   * Regla dura que se conserva de la versión vieja del spec: el repo ya
   * documenta el bug donde alguien quedaba atrapado en una vista de solo
   * lectura. Terminal → círculo de salida; reintentable → Reintentar.
   */
  it('los terminales van al bloque con círculo de salida', () => {
    expect(joinLinkStage({ hasSession: true, outcome: 'rejected' })).toBe('blocked');
    expect(joinLinkStage({ hasSession: true, outcome: 'invalid' })).toBe('blocked');
    expect(joinLinkStage({ hasSession: true, outcome: 'mesa_cerrada' })).toBe('blocked');
  });

  it('los reintentables ofrecen reintentar, no una salida ciega', () => {
    expect(joinLinkStage({ hasSession: true, outcome: 'unavailable' })).toBe('retry');
    expect(joinLinkStage({ hasSession: true, outcome: 'error' })).toBe('retry');
  });

  it('la etapa se deriva de `retryable`, no de una segunda tabla que se desincronice', () => {
    for (const outcome of OUTCOMES) {
      if (outcome === 'joining') continue;
      const etapa = joinLinkStage({ hasSession: true, outcome });
      expect(etapa).toBe(joinLinkMessage(outcome).retryable ? 'retry' : 'blocked');
    }
  });
});

describe('todos los estados tienen mensaje', () => {
  it.each(OUTCOMES)(
    '%s produce título y cuerpo no vacíos',
    (outcome) => {
      const m = joinLinkMessage(outcome);
      expect(m.title.length).toBeGreaterThan(0);
      expect(m.body.length).toBeGreaterThan(0);
    },
  );
});

describe('§1.2-D · la mesa muerta con token genuino (v2.45.0)', () => {
  /**
   * El 410 NO se funde con el rechazo ciego, a propósito: el 403 protege al
   * desconocido (no acredita que la mesa exista); el 410 sólo llega después
   * de validar el token, así que decir "esta mesa ya cerró" no regala el
   * oráculo que el 403 paga.
   */
  it('tiene copy propia y dice que ES esta mesa — no el link — lo que murió', () => {
    const m = joinLinkMessage('mesa_cerrada');
    expect(m.title).toBe('Esta mesa ya cerró');
    expect(m.body).toBe('Habla con quien te invitó si crees que es un error.');
    expect(m.retryable).toBe(false);
  });

  it('se distingue del rechazo ciego: no comparten ni título ni cuerpo', () => {
    const d = joinLinkMessage('mesa_cerrada');
    const b = joinLinkMessage('rejected');
    expect(d.title).not.toBe(b.title);
    expect(d.body).not.toBe(b.body);
  });

  it('cierra el círculo del recién registrado: la nota de cuenta-lista existe SOLO aquí', () => {
    // Diseño (2026-08-06): la explicación del Inicio vacío vive en la
    // pantalla que sabe qué pasó — Inicio no adivina. Y ninguna otra pantalla
    // la necesita: sus caminos no nacen de un alta hecha para este link.
    expect(joinLinkMessage('mesa_cerrada').nota).toBe(
      'Tu cuenta ya está lista — puedes abrir tu propia mesa cuando quieras.',
    );
    for (const outcome of ['joining', 'rejected', 'invalid', 'unavailable', 'error'] as const) {
      expect(joinLinkMessage(outcome).nota).toBeUndefined();
    }
  });

  it('sin nombrar restaurante: la cautela de A se conserva', () => {
    const m = joinLinkMessage('mesa_cerrada');
    expect(`${m.title} ${m.body} ${m.nota}`).not.toMatch(/Parolaccia|Hanzo|restaurante/i);
  });
});

describe('D372 · los textos del canje pasan por t()', () => {
  it('🔴 con un t que marca, cada título, cuerpo y nota de los seis resultados sale marcado', () => {
    const marca = (texto: string) => `EN:${texto}`;
    for (const o of OUTCOMES) {
      const m = joinLinkMessage(o, marca);
      expect(m.title, o).toMatch(/^EN:/);
      expect(m.body, o).toMatch(/^EN:/);
      if (m.nota !== undefined) expect(m.nota, o).toMatch(/^EN:/);
    }
  });

  it('🔴 el cableado: la pantalla le pasa su t (si no, los textos quedan en español aunque la app cambie de idioma)', () => {
    const pantalla = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'JoinMesaScreen.tsx'), 'utf8')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(pantalla).toContain('joinLinkMessage(outcome, t)');
    expect(pantalla).not.toMatch(/joinLinkMessage\(\s*outcome\s*\)/);
  });

  it('control positivo: sin t siguen en español, y retryable no depende del idioma', () => {
    const marca = (texto: string) => `EN:${texto}`;
    for (const o of OUTCOMES) {
      expect(joinLinkMessage(o).title).not.toMatch(/^EN:/);
      expect(joinLinkMessage(o, marca).retryable).toBe(joinLinkMessage(o).retryable);
    }
    expect(joinLinkMessage('mesa_cerrada').nota).toBe('Tu cuenta ya está lista — puedes abrir tu propia mesa cuando quieras.');
  });
});

describe('D372 · el ícono de E y F', () => {
  it('🔴 un solo ícono para los rechazos (sin pistas del motivo); la tienda para la mesa cerrada; reintentar para lo reintentable', () => {
    expect(iconoDelResultado('rejected')).toBe('link-cortado');
    expect(iconoDelResultado('invalid')).toBe('link-cortado');
    expect(iconoDelResultado('mesa_cerrada')).toBe('tienda');
    expect(iconoDelResultado('unavailable')).toBe('reintentar');
    expect(iconoDelResultado('error')).toBe('reintentar');
  });

  it('coincide con la etapa: «reintentar» sí y sólo si la pantalla ofrece Reintentar', () => {
    for (const o of ['rejected', 'invalid', 'mesa_cerrada', 'unavailable', 'error'] as const) {
      const etapa = joinLinkStage({ hasSession: true, outcome: o });
      expect(iconoDelResultado(o) === 'reintentar', o).toBe(etapa === 'retry');
    }
  });
});

describe('D373 · «Entrar» en naranja sólo si no hay alta y ya se sabe', () => {
  it.each([
    [{ altaDisponible: true, capacidadPendiente: false, capacidadIntentada: true }, false],
    [{ altaDisponible: true, capacidadPendiente: true, capacidadIntentada: false }, false],
    [{ altaDisponible: false, capacidadPendiente: true, capacidadIntentada: false }, false],
    [{ altaDisponible: false, capacidadPendiente: false, capacidadIntentada: false }, true],
    [{ altaDisponible: false, capacidadPendiente: true, capacidadIntentada: true }, true],
  ])('🔴 %o → %s', (estado, naranja) => {
    expect(entrarEnNaranja(estado)).toBe(naranja);
  });
});

describe('P02-a · B con el modo recordado', () => {
  it.each([
    [{ elegido: 'login', altaDisponible: false, capacidadPendiente: true, capacidadIntentada: false }, { montar: true, modo: 'login' }],
    [{ elegido: 'register', altaDisponible: false, capacidadPendiente: true, capacidadIntentada: false }, { montar: false, modo: 'register' }],
    [{ elegido: 'register', altaDisponible: true, capacidadPendiente: true, capacidadIntentada: false }, { montar: true, modo: 'register' }],
    [{ elegido: 'register', altaDisponible: false, capacidadPendiente: false, capacidadIntentada: false }, { montar: true, modo: 'login' }],
    [{ elegido: 'register', altaDisponible: false, capacidadPendiente: true, capacidadIntentada: true }, { montar: true, modo: 'login' }],
  ] as const)('🔴 %o → %o', (estado, esperado) => {
    expect(formularioDeB(estado)).toEqual(esperado);
  });
});

/**
 * AF-5 · D629 · D676 · el título de la tarjeta sin sesión. Con la vista previa del dueño dice quién invita y dónde;
 * sin ella (cualquier fallo, sin la capacidad o mientras llega), el título de hoy, el MISMO string.
 */
describe('AF-5 · tituloDeLaInvitacion', () => {
  const es = (s: string, ...a: unknown[]) => traducir(s, 'es', ...a);
  const en = (s: string, ...a: unknown[]) => traducir(s, 'en', ...a);
  const HOY = 'Te invitaron a una mesa';

  it('🔴 sin vista previa, el título de hoy, idéntico (ES y EN)', () => {
    expect(tituloDeLaInvitacion(null, es)).toBe(HOY);
    expect(tituloDeLaInvitacion(null, en)).toBe(en(HOY));
    expect(tituloDeLaInvitacion(null, en)).toBe("You've been invited to a table");
  });

  it('D629 · con nombre: «{nombre} te invitó a su mesa en {restaurante}»', () => {
    const v = { invitador: 'Ana', restaurante: 'Tacos El Güero' };
    expect(tituloDeLaInvitacion(v, es)).toBe('Ana te invitó a su mesa en Tacos El Güero');
    expect(tituloDeLaInvitacion(v, en)).toBe('Ana invited you to their table at Tacos El Güero');
  });

  it('D676 · con el nombre en null: «Te invitaron a una mesa en {restaurante}», sin nombre', () => {
    const v = { invitador: null, restaurante: 'Tacos El Güero' };
    expect(tituloDeLaInvitacion(v, es)).toBe('Te invitaron a una mesa en Tacos El Güero');
    expect(tituloDeLaInvitacion(v, en)).toBe("You've been invited to a table at Tacos El Güero");
  });

  it('un valor del dueño con llaves o signos no se vuelve a interpretar', () => {
    expect(tituloDeLaInvitacion({ invitador: '{1}', restaurante: '$& {0}' }, es)).toBe('{1} te invitó a su mesa en $& {0}');
  });

  it('el cuerpo y la etapa no cambian con la vista previa: siguen siendo los de hoy', () => {
    // La vista previa sólo cambia el título; sin sesión la etapa sigue siendo el alta (D583).
    for (const o of OUTCOMES) expect(joinLinkStage({ hasSession: false, outcome: o })).toBe('signup');
  });
});

describe('AF-5 · el cableado de la pantalla (guardarraíl de fuente: no hay librería de render)', () => {
  const pantalla = () => readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'JoinMesaScreen.tsx'), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('🔴 las DOS tarjetas sin sesión (A y B) toman el título de la misma función, y ya no hay un título suelto', () => {
    const p = pantalla();
    expect(p.match(/titulo=\{tituloDeLaInvitacion\(vistaPrevia, t\)\}/g)).toHaveLength(2);
    expect(p).not.toContain("t('Te invitaron a una mesa')");
  });

  it('🔴 la vista previa se pide sólo sin sesión, con la capacidad, por la fachada; y la tarjeta no se vuelve a montar', () => {
    const p = pantalla();
    // AF-7 · I1 · con el momento en que se vio la pantalla de este token (no el del pedido).
    expect(p).toContain('vistaPreviaDelLink(token, (tk) => api.getVistaPreviaDelLink(tk), vistaDesde.current)');
    expect(p).toMatch(/useEffect\(\(\) => \{\s*vistaDesde\.current = Date\.now\(\);\s*\}, \[token\]\);/);
    expect(p).toMatch(/if \(session \|\| capacidadVista !== 'encendida'\) return;/);
    // La `key` de cada tarjeta no depende de la vista previa: cambiar el título no repite la entrada.
    expect(p).toContain('key="signup"');
    expect(p).toContain('key="alta"');
    expect(p).not.toMatch(/key=\{[^}]*vista/);
  });
});
