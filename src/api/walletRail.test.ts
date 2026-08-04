import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WALLET_RAIL_KEYS,
  applyWalletRailConfig,
  getWalletRailState,
  readWalletRail,
  resetWalletRailForTests,
  subscribeWalletRail,
} from './walletRail';

/**
 * OLA 5D · el apagado del riel saldo deja de ser decisión de este repo.
 *
 * Lo que estos tests fijan NO es "wallet está apagado" —eso ya estaba probado y
 * seguía siendo verdad con una constante propia—. Fijan que **la autoridad se
 * movió**: que el front LEE la capability del backend en vez de decidirla.
 *
 * Por eso el test más importante del archivo es el que parece contradecir la
 * ratificación: `enabled: true` del backend tiene que ENCENDER el riel. Sin ese
 * caso, un `return false` hardcodeado pasaría todos los demás y el archivo daría
 * verde sin probar nada de lo que dice probar — la lección 4 del ciclo, aplicada
 * al instrumento.
 */

/** Lo que publica hoy el emisor, copiado del espejo `routes/config.js:43-46`. */
function configDelEmisor(walletRail: unknown = { enabled: false, account_activity: true }) {
  return {
    version: '2.31.0',
    currency: 'mxn',
    features: {
      apple_pay: false,
      google_pay: false,
      stp_dispersal: false,
      ocr_real: false,
      wallet_rail: walletRail,
      account_birth_date: { supported: true },
    },
  };
}

describe('readWalletRail · la capability manda, y falla cerrado', () => {
  it('lee el contrato exacto del emisor: riel APAGADO, actividad de cuenta CONSERVADA', () => {
    const s = readWalletRail(configDelEmisor());
    expect(s).toEqual({
      walletRailEnabled: false,
      accountActivity: true,
      status: 'authoritative',
      offendingKeys: [],
    });
  });

  /**
   * ⭐ EL CASO DE CONTROL. Si este test no existiera, cualquier implementación
   * que devuelva `false` siempre pasaría el resto del archivo, y no habría forma
   * de distinguir "el front lee la capability" de "el front sigue decidiendo".
   *
   * No contradice la ratificación: el emisor congela `enabled: false` con una
   * constante y su propia suite lo prueba. Lo que se prueba acá es que si algún
   * día una orden nueva con IFPE lo enciende, este front OBEDECE — que es lo que
   * significa que la capability sea autoritativa.
   */
  it('CONTROL · si el backend enciende el riel, el front lo enciende', () => {
    const s = readWalletRail(configDelEmisor({ enabled: true, account_activity: true }));
    expect(s.walletRailEnabled).toBe(true);
    expect(s.status).toBe('authoritative');
  });

  it('ausencia de la clave = backend previo a OLA 5 → riel APAGADO', () => {
    const config = configDelEmisor();
    delete (config.features as Record<string, unknown>).wallet_rail;
    const s = readWalletRail(config);
    expect(s.status).toBe('absent');
    expect(s.walletRailEnabled).toBe(false);
    // Y la superficie card-only NO se esconde por hablar con un backend viejo.
    expect(s.accountActivity).toBe(true);
  });

  it('el backend puede apagar la actividad de cuenta, pero sólo diciéndolo', () => {
    // No es un caso deseado —la ratificación manda conservarla— pero si el
    // emisor lo declarara, el consumidor lo obedece. Lo que NO puede pasar es
    // que se apague sin que nadie lo haya dicho: ver el test de fail-open.
    const s = readWalletRail(configDelEmisor({ enabled: false, account_activity: false }));
    expect(s.accountActivity).toBe(false);
    expect(s.status).toBe('authoritative');
  });
});

describe('readWalletRail · conjunto CERRADO de claves', () => {
  it('el conjunto es exactamente el del emisor', () => {
    expect([...WALLET_RAIL_KEYS]).toEqual(['account_activity', 'enabled']);
  });

  /**
   * Una lista de PROHIBIDOS sólo defiende contra lo que ya se te ocurrió. El
   * conjunto cerrado atrapa el campo que nadie previó — incluido uno con nombre
   * inocente.
   */
  it('una clave de más apaga el riel aunque el nombre sea inocente', () => {
    const s = readWalletRail(
      configDelEmisor({ enabled: true, account_activity: true, telemetry: 1 }),
    );
    expect(s.walletRailEnabled).toBe(false);
    expect(s.status).toBe('malformed');
    expect(s.offendingKeys).toEqual(['telemetry']);
  });

  /**
   * ⭐ EL STOP. La ratificación es explícita: *"no existe permiso por cuenta,
   * rol, usuario ni restaurante que pueda reactivar wallet durante el MVP"*.
   * Un payload con esa forma no sólo no reenciende: se marca aparte para que sea
   * reportable, porque un apagado silencioso haría indistinguible "el backend
   * está bien" de "el backend intentó reactivar wallet por cuenta".
   */
  it.each([
    'enabled_for_restaurant',
    'enabled_for_user',
    'enabled_for_role',
    'per_branch',
    'sucursal_override',
    'tenant_enabled',
  ])('un permiso por principal (%s) apaga el riel Y se denuncia', (clave) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const s = applyWalletRailConfig(
      configDelEmisor({ enabled: false, account_activity: true, [clave]: true }),
    );
    expect(s.walletRailEnabled).toBe(false);
    expect(s.status).toBe('principal_scoped');
    expect(s.offendingKeys).toEqual([clave]);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain(clave);
    error.mockRestore();
  });

  it('una clave FALTANTE también apaga el riel', () => {
    expect(readWalletRail(configDelEmisor({ enabled: true })).walletRailEnabled).toBe(false);
    expect(readWalletRail(configDelEmisor({ enabled: true })).status).toBe('malformed');
    expect(readWalletRail(configDelEmisor({ account_activity: true })).status).toBe('malformed');
  });
});

describe('readWalletRail · nada que no sea el booleano true enciende el riel', () => {
  /**
   * Barrido de formas inválidas. El peligro concreto que cubre: `"false"` es
   * VERDADERO en JavaScript, así que una capability serializada como string
   * reencendería el riel por una coerción que nadie escribió a propósito.
   */
  const INVALIDOS: Array<[string, unknown]> = [
    ['config null', null],
    ['config string', 'ok'],
    ['config sin features', { version: '1' }],
    ['features null', { features: null }],
    ['features array', { features: [] }],
    ['wallet_rail null', configDelEmisor(null)],
    ['wallet_rail array', configDelEmisor([])],
    ['wallet_rail string', configDelEmisor('enabled')],
    ['wallet_rail booleano', configDelEmisor(true)],
    ['wallet_rail vacío', configDelEmisor({})],
    ['enabled string "true"', configDelEmisor({ enabled: 'true', account_activity: true })],
    ['enabled string "false"', configDelEmisor({ enabled: 'false', account_activity: true })],
    ['enabled numérico', configDelEmisor({ enabled: 1, account_activity: true })],
    ['enabled null', configDelEmisor({ enabled: null, account_activity: true })],
    ['account_activity string', configDelEmisor({ enabled: false, account_activity: 'si' })],
  ];

  it.each(INVALIDOS)('%s → riel APAGADO', (_nombre, payload) => {
    expect(readWalletRail(payload).walletRailEnabled).toBe(false);
  });

  /**
   * Guardarraíl del guardarraíl: si la tabla se vaciara, el `it.each` de arriba
   * pasaría sin ejecutar ni un caso y el archivo daría verde en vacío.
   */
  it('la tabla de inválidos no está vacía', () => {
    expect(INVALIDOS.length).toBeGreaterThan(12);
  });

  /**
   * FAIL-OPEN del otro campo, y es deliberado: la actividad de cuenta es
   * superficie card-only RATIFICADA que se conserva. Esconderla ante un fallo de
   * red sería repetir `07f0ba2`. Fallar "cerrado" acá significa NO ocultar.
   */
  it.each(INVALIDOS)('%s → la actividad de cuenta card-only NO se esconde', (_nombre, payload) => {
    expect(readWalletRail(payload).accountActivity).toBe(true);
  });
});

describe('store del riel', () => {
  beforeEach(() => resetWalletRailForTests());
  afterEach(() => resetWalletRailForTests());

  it('arranca APAGADO antes de que conteste nadie', () => {
    expect(getWalletRailState()).toEqual({
      walletRailEnabled: false,
      accountActivity: true,
      status: 'pending',
      offendingKeys: [],
    });
  });

  it('avisa a los suscriptores cuando llega la capability', () => {
    const visto: string[] = [];
    const off = subscribeWalletRail(() => visto.push(getWalletRailState().status));
    applyWalletRailConfig(configDelEmisor());
    off();
    applyWalletRailConfig(configDelEmisor({ enabled: true, account_activity: true }));
    expect(visto).toEqual(['authoritative']); // y nada después de desuscribirse
    expect(getWalletRailState().walletRailEnabled).toBe(true);
  });
});

describe('el MOCK respeta la capability, no la ignora', () => {
  beforeEach(() => resetWalletRailForTests());
  afterEach(() => resetWalletRailForTests());

  /**
   * Un mock que se saltara `wallet_rail` y apagara el riel por otro camino no
   * estaría respetando la capability: la estaría IGNORANDO, y enseñaría un
   * producto donde el apagado no depende del backend. Ya pasó en este repo que
   * un mock permisivo le ocultó un defecto vivo a quien verificaba a mano.
   */
  it('la config del mock atraviesa el mismo lector y apaga el riel', async () => {
    const { mockGetConfig } = await import('./mock/mockApi');
    const s = readWalletRail(await mockGetConfig());
    expect(s.status).toBe('authoritative');
    expect(s.walletRailEnabled).toBe(false);
    expect(s.accountActivity).toBe(true);
  });

  /**
   * ESTRUCTURA, NO COMENTARIO. El mock hardcodea los valores; el emisor los
   * declara en `routes/config.js`. Si el emisor los cambia y el mock no, el mock
   * pasa a enseñar un comportamiento que ya no existe. Este test lee el ESPEJO
   * como texto y los compara.
   */
  it('los valores del mock son los que declara el espejo del emisor', async () => {
    const fuentes = import.meta.glob('/contract-mirror/routes/config.js', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    const texto = Object.values(fuentes)[0];
    // Si el espejo se mueve de lugar o se renombra, esto falla en vez de pasar
    // en vacío — que es como muere una verificación estructural.
    expect(texto, 'no se encontró contract-mirror/routes/config.js').toBeTruthy();

    const bloque = /const WALLET_RAIL = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(texto!);
    expect(bloque, 'no se encontró el bloque WALLET_RAIL en el espejo').toBeTruthy();

    const declarado: Record<string, boolean> = {};
    for (const m of bloque![1].matchAll(/(\w+):\s*(true|false)/g)) {
      declarado[m[1]] = m[2] === 'true';
    }
    expect(Object.keys(declarado).sort()).toEqual([...WALLET_RAIL_KEYS]);

    const { mockGetConfig } = await import('./mock/mockApi');
    const delMock = (await mockGetConfig()).features.wallet_rail;
    expect(delMock).toEqual(declarado);
  });
});

/**
 * NADA SE BORRA · la ratificación manda conservar el código wallet durmiente,
 * y "conservar durmiente" corre contra la corriente de todo el tooling: el
 * compilador, el linter y el próximo que abra el archivo empujan a borrar.
 *
 * Y al mismo tiempo NO puede volver una constante de riel propia de este repo,
 * que es el defecto de autoridad que OLA 5D corrige. Las dos cosas se fijan acá,
 * estructuralmente, sobre el árbol entero.
 */
describe('barrido estructural del árbol', () => {
  const fuentes = import.meta.glob('/src/**/*.{ts,tsx}', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;

  it('el barrido ve el árbol (si no, todo lo de abajo pasa en vacío)', () => {
    expect(Object.keys(fuentes).length).toBeGreaterThan(20);
  });

  it('ningún archivo vuelve a declarar una constante de riel wallet propia', () => {
    const ofensores: string[] = [];
    for (const [ruta, cuerpo] of Object.entries(fuentes)) {
      if (ruta.endsWith('walletRail.test.ts')) continue; // este archivo la nombra
      // Una asignación a nivel de módulo con un literal: exactamente la forma
      // que hacía que el apagado fuera decisión de un deploy del front.
      if (/(const|let|var)\s+WALLET_RAIL_ENABLED\s*(:[^=]+)?=\s*(true|false|IS_MOCK)/.test(cuerpo)) {
        ofensores.push(ruta);
      }
    }
    expect(ofensores).toEqual([]);
  });

  it('las pantallas dormidas del riel siguen en el árbol: nada se borró', () => {
    const rutas = Object.keys(fuentes);
    expect(rutas).toContain('/src/screens/TopupScreen.tsx');
    expect(rutas).toContain('/src/screens/TransferScreen.tsx');
  });

  /**
   * ⭐ EL DEFECTO QUE ESTE BARRIDO EXISTE PARA IMPEDIR, y que apareció de verdad
   * en el barrido adversarial de este mismo cambio.
   *
   * Las capabilities pasaron de CONSTANTE a valor ASÍNCRONO. Un `useEffect` con
   * deps `[]` las lee en el primer render —cuando todavía valen su default por
   * fail-closed— y **no las vuelve a mirar nunca**. Con el riel encendido por el
   * backend, `HomeScreen` y `CuentaScreen` renderizaban la tarjeta de saldo y
   * dejaban el monto en "…" para siempre, porque `getBalance()` no se llamaba.
   *
   * Es la clase entera del cambio: **todo lo que leyó una constante UNA VEZ se
   * rompe cuando esa constante empieza a llegar por red.** Un comentario no lo
   * evita; el barrido sí, porque el próximo que agregue un efecto que lea una
   * capability se entera al correr los tests.
   *
   * **Límite declarado:** empareja el cuerpo del efecto hasta su cierre de nivel
   * de componente, así que un efecto escrito con otra indentación o con un
   * `}, [` anidado se captura corto y podría dar falso NEGATIVO. Y sólo mira las
   * tres capabilities nombradas. Sirve contra el caso probable, no contra uno
   * adversarial.
   */
  it('ningún efecto lee una capability sin declararla en sus dependencias', () => {
    const CAPABILITIES = ['walletRailEnabled', 'accountActivity', 'showAccountActivity'];
    const EFECTO = /useEffect\(\s*\(\)\s*=>\s*\{([\s\S]*?)\n\s*\},\s*\[([^\]]*)\]\s*\)/g;

    const ofensores: string[] = [];
    let efectosVistos = 0;
    for (const [ruta, cuerpo] of Object.entries(fuentes)) {
      if (ruta.includes('.test.')) continue;
      for (const m of cuerpo.matchAll(EFECTO)) {
        efectosVistos++;
        const [, body, deps] = m;
        for (const cap of CAPABILITIES) {
          if (body.includes(cap) && !deps.includes(cap)) {
            ofensores.push(`${ruta} → efecto que lee ${cap} con deps [${deps.trim()}]`);
          }
        }
      }
    }
    // Guardarraíl: si la regex dejara de emparejar, el test pasaría en vacío.
    expect(efectosVistos).toBeGreaterThan(8);
    expect(ofensores).toEqual([]);
  });
});
