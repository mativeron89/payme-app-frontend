import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  FacebookDataDeletionPage,
  FacebookDataDeletionView,
  type EstadoBorrado,
} from './FacebookDataDeletionPage';
import { PrivacyNoticeView, type EstadoAviso } from './PrivacyNoticePage';
import { PublicApp, URL_APP } from './PublicApp';

/**
 * Las dos superficies públicas, renderizadas · APP-FE-META-PUBLIC-COMPLIANCE-01.
 *
 * Sin jsdom (ratificación de Mati): se usa `renderToStaticMarkup`, que es lo
 * mismo que ya hacen `AppHeader.identity.test.tsx` y compañía. Los efectos no
 * corren en SSR, así que **no hay red en este archivo**: lo que se afirma es el
 * HTML de cada estado, con el estado puesto a mano.
 *
 * 🔴 Por eso las vistas son puras y viven separadas de los componentes que
 * consultan. Con la vista adentro del que hace fetch, «cargando» sería lo único
 * observable desde vitest y los otros seis estados quedarían sin ninguna
 * afirmación fuera del navegador.
 */

const SENTINELA = 'SENTINELAxyz012345_-abcd';

const AVISO = {
  kind: 'aviso_privacidad' as const,
  version: '1.4.0',
  hash: 'a'.repeat(64),
  effective_from: '2026-08-01T00:00:00Z',
  body: 'Primer párrafo del aviso.\n\nSegundo párrafo.',
};

const FUENTES: Record<string, string> = Object.fromEntries(
  ['PublicApp.tsx', 'PrivacyNoticePage.tsx', 'FacebookDataDeletionPage.tsx', 'publicRoute.ts']
    .map((n) => [n, readFileSync(new URL(`./${n}`, import.meta.url), 'utf8')]),
);

/**
 * 🔴 EL BARRIDO MIRA CÓDIGO, NO PROSA — y esto lo escribo después de que mi
 * propia guarda me pusiera cuatro tests en rojo.
 *
 * Los comentarios de estos archivos NOMBRAN lo que está prohibido: explican por
 * qué no hay `dangerouslySetInnerHTML`, por qué no se monta `AuthProvider`, por
 * qué no se toca `localStorage`. Un barrido sobre el texto crudo lee esas
 * explicaciones como violaciones — **se veta lo que ejecuta, no lo que se
 * cuenta**. Es la misma convención que ya aplica `coloresMigrados.test.ts`:
 * *«si hace falta el viejo para explicar la historia, va en un comentario»*.
 *
 * Se sacan los bloques `/* … *\/` y las líneas que ARRANCAN con `//`. No se
 * tocan los `//` a mitad de línea, a propósito: ahí viven las URLs
 * (`https://app.paymemx.com/`) y un stripper ingenuo las cortaría al medio,
 * que es cómo un instrumento empieza a medir otra cosa.
 */
const codigo = (fuente: string): string =>
  fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

describe('/privacy · los tres estados', () => {
  const render = (estado: EstadoAviso): string =>
    renderToStaticMarkup(<PrivacyNoticeView estado={estado} onReintentar={() => undefined} />);

  it('✅ con el aviso: título, versión, vigencia y CUERPO OWNER', () => {
    const html = render({ fase: 'ok', aviso: AVISO });
    expect(html).toContain('Aviso de privacidad');
    expect(html).toContain('Versión 1.4.0');
    expect(html, 'la vigencia se muestra como fecha, sin hora ni zona').toContain('2026-08-01');
    expect(html).toContain('Primer párrafo del aviso.');
    expect(html, 'sin aviso leído no puede ofrecer reintentar').not.toContain('Reintentar');
  });

  it('✅ cargando lo dice, y no muestra cuerpo', () => {
    const html = render({ fase: 'cargando' });
    expect(html).toContain('Cargando el aviso vigente');
    expect(html).not.toContain('Primer párrafo');
  });

  /**
   * 🔴 NO VERIFICABLE NO ES UN CALLEJÓN SIN SALIDA. La orden reserva el retry
   * manual justamente para esta lectura: sin botón, la única salida sería que
   * la persona adivine que tiene que recargar.
   */
  it('🔴 no verificable: lo dice, ofrece reintentar y NO inventa un aviso', () => {
    const html = render({ fase: 'no-verificable' });
    expect(html).toContain('No pudimos leer el aviso vigente');
    expect(html).toContain('Reintentar');
    expect(html, 'una copia guardada publicaría un texto posiblemente vencido')
      .not.toContain('Primer párrafo');
  });

  it('🔴 el cuerpo del aviso NUNCA se inyecta como HTML', () => {
    const html = render({
      fase: 'ok',
      aviso: { ...AVISO, body: '<img src=x onerror="alert(1)">' },
    });
    expect(html, 'el cuerpo llegó al DOM como marcado vivo').not.toContain('<img');
    expect(html, 'debe verse escapado, como texto').toContain('&lt;img');
  });
});

describe('/facebook-data-deletion · los cinco estados', () => {
  const render = (estado: EstadoBorrado): string =>
    renderToStaticMarkup(<FacebookDataDeletionView estado={estado} />);

  it.each([
    ['cargando', 'Consultando el estado'],
    ['pendiente', 'Pendiente'],
    ['completada', 'Completada'],
    ['no-encontrada', 'No encontrada'],
    ['no-verificable', 'No verificable'],
  ] as const)('✅ `%s` se ve con su texto propio', (fase, texto) => {
    expect(render({ fase } as EstadoBorrado)).toContain(texto);
  });

  /**
   * 🔴 CADA ESTADO ES DISTINGUIBLE DE LOS OTROS CUATRO. Sin esto, un `render`
   * que devolviera siempre el bloque completo pasaría los cinco casos de
   * arriba: `toContain` no dice que lo demás no esté.
   */
  it('🔴 los cinco son mutuamente excluyentes · no se pintan dos a la vez', () => {
    const marcas = ['Consultando el estado', 'Pendiente', 'Completada', 'No encontrada', 'No verificable'];
    for (const fase of ['cargando', 'pendiente', 'completada', 'no-encontrada', 'no-verificable'] as const) {
      const html = render({ fase } as EstadoBorrado);
      const presentes = marcas.filter((m) => html.includes(m));
      expect(presentes, `\`${fase}\` pintó ${presentes.length} estados: ${presentes.join(', ')}`)
        .toHaveLength(1);
    }
  });

  /**
   * 🔴 LA AFIRMACIÓN DE BORRADO ES ÚNICA Y EXCLUSIVA. Decirle a alguien que sus
   * datos se borraron cuando no se sabe es el peor error de esta pantalla, así
   * que la frase que lo afirma no puede aparecer en ningún otro estado —ni de
   * paso, ni dentro de una explicación—.
   */
  it('🔴 la frase que afirma el borrado sólo existe en `completada`', () => {
    const AFIRMACION = 'La eliminación de tus datos se completó';
    for (const fase of ['cargando', 'pendiente', 'no-encontrada', 'no-verificable'] as const) {
      expect(render({ fase } as EstadoBorrado)).not.toContain(AFIRMACION);
    }
    expect(render({ fase: 'completada' })).toContain(AFIRMACION);
  });
});

describe('🔴 el `confirmation_code` no llega al DOM', () => {
  it('la página con el código puesto no lo pinta en su render inicial', () => {
    const html = renderToStaticMarkup(<FacebookDataDeletionPage code={SENTINELA} />);
    expect(html, 'el código salió al DOM').not.toContain('SENTINELA');
    expect(html, 'con código válido arranca consultando').toContain('Consultando el estado');
  });

  it('sin código consultable arranca en NO ENCONTRADA, sin spinner', () => {
    const html = renderToStaticMarkup(<FacebookDataDeletionPage code={null} />);
    expect(html).toContain('No encontrada');
    expect(html, 'un «cargando» que no va a consultar nada es un spinner mintiendo')
      .not.toContain('Consultando el estado');
  });

  it('el shell completo tampoco lo pinta · ni en el título', () => {
    const html = renderToStaticMarkup(
      <PublicApp ruta={{ tipo: 'eliminacion', code: SENTINELA }} />,
    );
    expect(html).not.toContain('SENTINELA');
    // El título son dos constantes literales: no hay interpolación posible.
    expect(FUENTES['PublicApp.tsx']).toMatch(/privacidad: 'Aviso de privacidad · PayMe'/);
    expect(FUENTES['PublicApp.tsx']).toMatch(/eliminacion: 'Eliminación de datos · PayMe'/);
  });

  /**
   * 🔴 ESTRUCTURAL, y es lo que hace verdadera a la afirmación de arriba: la
   * vista **no recibe** el código, así que no hay camino por el que pueda
   * pintarlo. Un render sin el sentinela prueba un caso; esto prueba la clase.
   */
  it('🔴 la vista no tiene por dónde recibirlo · `EstadoBorrado` no lo transporta', () => {
    const fuente = FUENTES['FacebookDataDeletionPage.tsx']!;
    const union = fuente.slice(
      fuente.indexOf('export type EstadoBorrado'),
      fuente.indexOf('export function FacebookDataDeletionView'),
    );
    expect(union.length, 'no se recortó la unión: mediría en vacío').toBeGreaterThan(80);
    expect(union, 'una variante del estado transporta el código').not.toMatch(/\bcode\b/);
    // Y la vista no lo recibe por otra puerta: su única prop es el estado.
    const firma = fuente.slice(
      fuente.indexOf('export function FacebookDataDeletionView'),
      fuente.indexOf('): JSX.Element {'),
    );
    expect(firma, 'la vista abrió una prop para el código').not.toMatch(/\bcode\b/);
  });
});

describe('el shell público · landmarks, marca y regreso', () => {
  const html = renderToStaticMarkup(<PublicApp ruta={{ tipo: 'privacidad' }} />);

  it('✅ header/main/footer, un solo h1 y el link de regreso', () => {
    expect(html).toContain('<header');
    expect(html).toContain('<main');
    expect(html).toContain('<footer');
    expect(html.match(/<h1\b/g), 'un h1 y sólo uno').toHaveLength(1);
    expect(html).toContain('Volver a PayMe');
    expect(URL_APP).toBe('https://app.paymemx.com/');
    expect(html.match(new RegExp(`href="${URL_APP}"`, 'g')), 'marca y regreso')
      .toHaveLength(2);
  });

  it('✅ la zona que cambia es `aria-live` moderado', () => {
    expect(html).toContain('aria-live="polite"');
    expect(html, 'assertive interrumpe al lector: acá nada es urgente')
      .not.toContain('aria-live="assertive"');
  });

  it('🔴 no monta shell autenticado, i18n ni router hash', () => {
    const fuente = codigo(FUENTES['PublicApp.tsx']!);
    for (const prohibido of ['AuthProvider', 'IdiomaProvider', 'useHashRoute', "from '../App'"]) {
      expect(fuente, `el shell público importa ${prohibido}`).not.toContain(prohibido);
    }
  });
});

/**
 * 🔴 EL ORDEN DE `main.tsx`, AFIRMADO ACÁ Y MEDIDO EN NAVEGADOR.
 *
 * La prueba fuerte de que los bootstraps de sesión no corren en una ruta
 * pública es conductual y vive en `e2e/meta-public-pages.spec.ts`: se abre
 * `/privacy` con un fragmento de recovery puesto y se exige que nadie lo
 * capture. **Se escribió porque el mutante `if (true)` sobrevivió a los 26
 * tests de navegador que había antes.**
 *
 * Esto de acá es lo otro: la misma propiedad dicha en la estructura, que falla
 * en milisegundos y sin servidor. No reemplaza a la conductual —una guarda de
 * texto no prueba comportamiento— y por eso se declara cuál es cuál.
 */
describe('🔴 main.tsx · el grafo privado no se evalúa en una ruta pública', () => {
  const MAIN = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8');
  const CODIGO_MAIN = codigo(MAIN);

  /** Los módulos que arrastran sesión, storage o el shell autenticado. */
  const PRIVADOS = [
    './api/recoveryFlow',
    './api/facebookAuthFlow',
    './api/signupInvitation',
    './i18n/idioma',
    './App',
  ];

  /**
   * 🔴 LOS `import` ESTÁTICOS SON UN CENSO CERRADO, no una lista de prohibidos.
   *
   * Es la corrección que trajo la auditoría diferencial: un `import` estático
   * está izado, así que **evalúa el módulo aunque ninguna línea lo use**, y el
   * grafo privado llega a un `localStorage.getItem()` de inicialización. No
   * alcanza con no llamar a nada.
   *
   * Se declara lo que PUEDE entrar arriba —React, el cliente de DOM, los
   * módulos públicos, el splash y los estilos— y cualquier otra cosa cae, venga
   * con el nombre que venga. Una lista de módulos prohibidos fallaría abierta
   * ante el que alguien agregue mañana.
   */
  it('🔴 sólo React, estilos y módulos públicos se importan estáticamente', () => {
    const estaticos = [...CODIGO_MAIN.matchAll(/^import\s[\s\S]*?from '([^']+)';$/gm)]
      .map((m) => m[1]!)
      .concat([...CODIGO_MAIN.matchAll(/^import '([^']+)';$/gm)].map((m) => m[1]!));

    expect(estaticos.length, 'no se parsearon imports: mediría en vacío').toBeGreaterThan(3);
    expect(
      [...estaticos].sort(),
      'entró un import estático nuevo: si arrastra sesión, se evalúa en /privacy',
    ).toEqual([
      './public/PublicApp',
      './public/publicRoute',
      './splash',
      './styles/global.css',
      'react',
      'react-dom/client',
    ]);
  });

  it.each(PRIVADOS)('`%s` entra SÓLO por `import()` dinámico', (modulo) => {
    expect(CODIGO_MAIN, `${modulo} ya no aparece en main.tsx`).toContain(modulo);
    expect(
      CODIGO_MAIN,
      `${modulo} se importa estáticamente: su módulo se evalúa también en /privacy`,
    ).not.toMatch(new RegExp(`^import[\\s\\S]*?from '${modulo.replace('.', '\\.')}';$`, 'm'));
    expect(
      CODIGO_MAIN,
      `${modulo} no se carga con import() en ningún lado`,
    ).toContain(`import('${modulo}')`);
  });

  it('la ruta se resuelve ANTES de la bifurcación', () => {
    const decision = CODIGO_MAIN.indexOf('resolverRutaPublica(window.location.pathname)');
    const bifurca = CODIGO_MAIN.indexOf('if (!rutaPublica) {');
    expect(decision, 'nadie resuelve la ruta pública en main.tsx').toBeGreaterThan(-1);
    expect(bifurca, 'no hay bifurcación').toBeGreaterThan(-1);
    expect(decision).toBeLessThan(bifurca);
  });

  /**
   * 🔴 Y LOS `import()` VIVEN EN LA RAMA PRIVADA. Un `import()` suelto arriba
   * bajaría el chunk igual —tarde, pero lo bajaría— y volvería a evaluar el
   * grafo. Se recorta la función privada y se exige que los cinco estén ahí.
   */
  it('🔴 los cinco `import()` están dentro de la función privada', () => {
    const abre = CODIGO_MAIN.indexOf('async function arrancarPrivada');
    const cierra = CODIGO_MAIN.indexOf('\nfunction montarSuperficiePublica');
    expect(abre, 'no existe la función privada').toBeGreaterThan(-1);
    expect(cierra, 'no existe la función pública').toBeGreaterThan(abre);

    const privada = CODIGO_MAIN.slice(abre, cierra);
    expect(privada.length, 'el recorte salió vacío').toBeGreaterThan(200);
    expect(privada.length, 'el recorte abarca el archivo entero: no recorta nada')
      .toBeLessThan(CODIGO_MAIN.length - 200);
    for (const modulo of PRIVADOS) {
      expect(privada, `${modulo} se baja fuera de la rama privada`)
        .toContain(`import('${modulo}')`);
    }
    // Y los bootstraps corren antes de tomar la raíz privada.
    for (const llamada of [
      'bootstrapRecoveryTokenCapture();',
      'bootstrapFacebookCallbackCapture();',
      'bootstrapSignupInvitationCustody();',
    ]) {
      expect(privada, `${llamada} quedó fuera de la rama privada`).toContain(llamada);
      expect(
        privada.indexOf(llamada),
        `${llamada} corre después de montar el root privado`,
      ).toBeLessThan(privada.indexOf('createRoot(el).render('));
    }
  });

  /**
   * 🔴 LA RAMA PÚBLICA NO LLEVA `StrictMode`, y es lo que hace que sea UNA
   * request por carga y no dos. Si alguien lo agrega «por consistencia», los
   * conteos exactos del navegador caen — pero esto cae antes y dice por qué.
   */
  it('🔴 la superficie pública se monta sin `StrictMode`', () => {
    const abre = CODIGO_MAIN.indexOf('function montarSuperficiePublica');
    const publica = CODIGO_MAIN.slice(abre);
    expect(publica.length, 'el recorte salió vacío').toBeGreaterThan(100);
    expect(publica, 'volvió StrictMode a la rama pública: serían dos requests por carga')
      .not.toContain('StrictMode');
    expect(publica, 'la rama pública dejó de montar PublicApp').toContain('<PublicApp');
    // Control positivo del recorte: la rama privada SÍ lo conserva.
    expect(CODIGO_MAIN.slice(0, abre), 'la rama privada perdió StrictMode')
      .toContain('<StrictMode>');
  });
});

describe('🔴 la carpeta pública entera · sin HTML vivo y sin storage', () => {
  const STORAGE = /\b(localStorage|sessionStorage|document\.cookie)\b/;

  it.each(Object.keys(FUENTES))('`%s` no inyecta HTML ni toca sesión', (nombre) => {
    const fuente = codigo(FUENTES[nombre]!);
    expect(fuente).not.toContain('dangerouslySetInnerHTML');
    expect(fuente).not.toContain('innerHTML');
    expect(fuente, 'una ruta pública no puede leer ni escribir storage')
      .not.toMatch(STORAGE);
  });

  /**
   * 🔴 CONTROL POSITIVO DEL BARRIDO, en sus TRES formas de mentir: que no haya
   * leído nada, que el stripper se haya comido el código junto con la prosa, y
   * que los detectores no detecten.
   */
  it('🔴 el barrido leyó código de verdad, y sus detectores ven', () => {
    expect(Object.keys(FUENTES)).toHaveLength(4);
    for (const [nombre, fuente] of Object.entries(FUENTES)) {
      const limpio = codigo(fuente);
      expect(fuente.length, `${nombre} llegó vacío`).toBeGreaterThan(500);
      // Sin esto, un stripper que devolviera '' dejaría todo en verde.
      expect(limpio, `${nombre} quedó sin código tras sacar comentarios`)
        .toContain('export');
    }
    // El stripper saca la prosa que nombra lo prohibido…
    expect(codigo(FUENTES['PublicApp.tsx']!)).not.toContain('AuthProvider');
    expect(FUENTES['PublicApp.tsx'], 'la prosa que explica el porqué sigue en el archivo')
      .toContain('AuthProvider');
    // …y NO se come una URL con `//` a mitad de línea.
    expect(codigo(FUENTES['PublicApp.tsx']!)).toContain('https://app.paymemx.com/');
    // Y los detectores ven lo que dicen ver, sobre muestras plantadas.
    expect('const x = window.localStorage;').toMatch(STORAGE);
    expect(codigo('const y = 1; // localStorage\nconst z = localStorage;')).toMatch(STORAGE);
  });
});
