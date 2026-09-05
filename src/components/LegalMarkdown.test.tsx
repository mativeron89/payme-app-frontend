import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LegalMarkdown } from './LegalMarkdown';

// Fixture público owner2.4.1, pin940cc49e5bb6f59138a6d0649e8143b5069d8fd0.
// services/legal.js separa front matter y trim(); nunca es fallback productivo.
const OWNER_BODY = `# Aviso de privacidad

PayMe sirve para que un grupo de personas registre lo que consumió en un
restaurante y reparta la cuenta. **En esta etapa no se hacen pagos desde la
app**: PayMe no cobra, no guarda tarjetas y no mueve dinero. Cuando eso cambie,
te lo diremos con un aviso nuevo antes de que sigas usando la app.

## Cómo entras

- **Con tu correo y una contraseña.** La contraseña se guarda como un resumen
  matemático del que no se puede volver atrás. Nadie —tampoco nosotros— puede
  leerla.
- **Con tu cuenta de Google.** Guardamos únicamente un identificador que Google
  nos da para reconocerte y con qué proveedor entraste. No guardamos tu foto ni
  tus contactos de Google.

## Qué guardamos

Solo lo que hace falta para que la app funcione:

- **Tu nombre y tu apellido**, para que tus amigos te reconozcan.
- **Tu identificador de PayMe**, que no se puede editar.
- **Tu correo**, para identificarte y para escribirte si hace falta.
- **Cómo te registraste** (correo o Google) y **cuándo**, y la fecha de tu última
  actividad.
- **Tu foto de perfil, si decides agregarla.** Es opcional, la procesamos para
  quitar metadatos y la guardamos de forma privada. Puedes reemplazarla o
  borrarla desde tu cuenta.
- **Con quién te conectaste en la app**: tu lista de amigos y las solicitudes
  que mandaste y recibiste.
- **Las mesas en las que participaste**: qué se pidió, quién eligió qué y qué
  parte te tocó. Es lo que la app necesita para repartir la cuenta.
- **Que este aviso estaba publicado cuando te registraste.** Sólo puedes
  registrarte mientras haya una versión publicada de este aviso, y la app te
  muestra cuál. Hoy PayMe no guarda un registro individual de que lo aceptaste.

No te pedimos teléfono ni domicilio. Podemos pedir tu fecha de nacimiento para
aplicar las protecciones de edad; no la usamos para publicidad.

## La foto del ticket

Para cargar una mesa puedes fotografiar el ticket del restaurante. **Esa foto se
envía a un servicio de reconocimiento de texto de Amazon (AWS Textract) para
leer los ítems y los importes, y PayMe no la guarda**: lo que queda en la app es
la lista de ítems y precios que se leyó, no la imagen. Un ticket puede traer
datos del restaurante (nombre comercial, RFC, últimos dígitos de un pago
anterior); eso viaja en la imagen al servicio de lectura. Cuando esta función
esté encendida, esta sección aplica; si la lectura automática está apagada, la
foto igual llega a PayMe, no se envía a Amazon y no se guarda.

## Quién ve qué

- **Tus amigos** ven tu nombre, tu apellido y tu identificador de PayMe. **No ven
  tu correo.**
- **Tu foto de perfil es privada:** sólo la sirve PayMe a tu propia sesión
  autenticada; no tiene una dirección pública.
- **Tú** ves tu propia actividad.
- **El equipo de PayMe** puede ver, en una consola interna de acceso restringido,
  **únicamente**: tu nombre, tu correo, cómo te registraste, cuándo te
  registraste y la fecha de tu última actividad. No ve tus mesas, tus consumos,
  tus amigos ni tu foto. Esa consola no permite exportar datos.
- **El restaurante no recibe tus datos personales.** No hay panel de restaurante
  en esta etapa.

**No vendemos tus datos ni se los damos a anunciantes.** No hay publicidad aquí.

## Cuánto tiempo guardamos tus datos

Conservamos tus datos **mientras tu cuenta exista**. Todavía no hay borrado
automático por tiempo: si dejas de usar la app, tus datos siguen guardados hasta
que pidas eliminarlos.

## Control y eliminación de tus datos

Puedes solicitar acceso, rectificación, cancelación o eliminación, y oposición
escribiéndonos al correo indicado abajo. La gestión es manual porque todavía no
hay un botón para hacerlo desde la app; te respondemos y ejecutamos el pedido
de forma manual.

Cuando eliminamos tu cuenta, se eliminan tu foto, tu correo y tus datos de
acceso. Hay una cosa que **se conserva**, y te lo decimos con claridad:

- **Las mesas que compartiste con otras personas** permanecen como registro de
  esas personas, pero sin tu nombre ni tus datos: tu lugar pasa a decir
  «Cuenta eliminada» sin cambiar lo que cada uno consumió.

## Si algo no te queda claro

Escríbenos a **matiasveron@paymemx.com** y te respondemos.

## Si esto cambia

Si cambiamos algo de lo de arriba, te lo decimos antes de que sigas usando la app.

*Versión 2.4.1 · septiembre de 2026 · texto provisorio pendiente de revisión
jurídica; describe lo que la app hace hoy y se reemplazará por una versión
revisada.*`;

const render = (body: string) => renderToStaticMarkup(<LegalMarkdown body={body} />);
const normal = (text: string) => text.replace(/\s+/g, ' ').trim();
const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'" };
const textOf = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|#x27);/g,
  (_match, name: string) => ENTITIES[name]!);

// Oráculo explícito revisado contra el documento owner, sin ejecutar el parser
// para fabricar expectativas. Conserva cada bloque, palabra y orden; sólo los
// espacios de maquetación del HTML se normalizan al comparar.
const ORACLE = [
  ['h2', 'Aviso de privacidad'],
  ['p', 'PayMe sirve para que un grupo de personas registre lo que consumió en un restaurante y reparta la cuenta. En esta etapa no se hacen pagos desde la app: PayMe no cobra, no guarda tarjetas y no mueve dinero. Cuando eso cambie, te lo diremos con un aviso nuevo antes de que sigas usando la app.'],
  ['h3', 'Cómo entras'],
  ['li', 'Con tu correo y una contraseña. La contraseña se guarda como un resumen matemático del que no se puede volver atrás. Nadie —tampoco nosotros— puede leerla.'],
  ['li', 'Con tu cuenta de Google. Guardamos únicamente un identificador que Google nos da para reconocerte y con qué proveedor entraste. No guardamos tu foto ni tus contactos de Google.'],
  ['h3', 'Qué guardamos'],
  ['p', 'Solo lo que hace falta para que la app funcione:'],
  ['li', 'Tu nombre y tu apellido, para que tus amigos te reconozcan.'],
  ['li', 'Tu identificador de PayMe, que no se puede editar.'],
  ['li', 'Tu correo, para identificarte y para escribirte si hace falta.'],
  ['li', 'Cómo te registraste (correo o Google) y cuándo, y la fecha de tu última actividad.'],
  ['li', 'Tu foto de perfil, si decides agregarla. Es opcional, la procesamos para quitar metadatos y la guardamos de forma privada. Puedes reemplazarla o borrarla desde tu cuenta.'],
  ['li', 'Con quién te conectaste en la app: tu lista de amigos y las solicitudes que mandaste y recibiste.'],
  ['li', 'Las mesas en las que participaste: qué se pidió, quién eligió qué y qué parte te tocó. Es lo que la app necesita para repartir la cuenta.'],
  ['li', 'Que este aviso estaba publicado cuando te registraste. Sólo puedes registrarte mientras haya una versión publicada de este aviso, y la app te muestra cuál. Hoy PayMe no guarda un registro individual de que lo aceptaste.'],
  ['p', 'No te pedimos teléfono ni domicilio. Podemos pedir tu fecha de nacimiento para aplicar las protecciones de edad; no la usamos para publicidad.'],
  ['h3', 'La foto del ticket'],
  ['p', 'Para cargar una mesa puedes fotografiar el ticket del restaurante. Esa foto se envía a un servicio de reconocimiento de texto de Amazon (AWS Textract) para leer los ítems y los importes, y PayMe no la guarda: lo que queda en la app es la lista de ítems y precios que se leyó, no la imagen. Un ticket puede traer datos del restaurante (nombre comercial, RFC, últimos dígitos de un pago anterior); eso viaja en la imagen al servicio de lectura. Cuando esta función esté encendida, esta sección aplica; si la lectura automática está apagada, la foto igual llega a PayMe, no se envía a Amazon y no se guarda.'],
  ['h3', 'Quién ve qué'],
  ['li', 'Tus amigos ven tu nombre, tu apellido y tu identificador de PayMe. No ven tu correo.'],
  ['li', 'Tu foto de perfil es privada: sólo la sirve PayMe a tu propia sesión autenticada; no tiene una dirección pública.'],
  ['li', 'Tú ves tu propia actividad.'],
  ['li', 'El equipo de PayMe puede ver, en una consola interna de acceso restringido, únicamente: tu nombre, tu correo, cómo te registraste, cuándo te registraste y la fecha de tu última actividad. No ve tus mesas, tus consumos, tus amigos ni tu foto. Esa consola no permite exportar datos.'],
  ['li', 'El restaurante no recibe tus datos personales. No hay panel de restaurante en esta etapa.'],
  ['p', 'No vendemos tus datos ni se los damos a anunciantes. No hay publicidad aquí.'],
  ['h3', 'Cuánto tiempo guardamos tus datos'],
  ['p', 'Conservamos tus datos mientras tu cuenta exista. Todavía no hay borrado automático por tiempo: si dejas de usar la app, tus datos siguen guardados hasta que pidas eliminarlos.'],
  ['h3', 'Control y eliminación de tus datos'],
  ['p', 'Puedes solicitar acceso, rectificación, cancelación o eliminación, y oposición escribiéndonos al correo indicado abajo. La gestión es manual porque todavía no hay un botón para hacerlo desde la app; te respondemos y ejecutamos el pedido de forma manual.'],
  ['p', 'Cuando eliminamos tu cuenta, se eliminan tu foto, tu correo y tus datos de acceso. Hay una cosa que se conserva, y te lo decimos con claridad:'],
  ['li', 'Las mesas que compartiste con otras personas permanecen como registro de esas personas, pero sin tu nombre ni tus datos: tu lugar pasa a decir «Cuenta eliminada» sin cambiar lo que cada uno consumió.'],
  ['h3', 'Si algo no te queda claro'],
  ['p', 'Escríbenos a matiasveron@paymemx.com y te respondemos.'],
  ['h3', 'Si esto cambia'],
  ['p', 'Si cambiamos algo de lo de arriba, te lo decimos antes de que sigas usando la app.'],
  ['p', 'Versión 2.4.1 · septiembre de 2026 · texto provisorio pendiente de revisión jurídica; describe lo que la app hace hoy y se reemplazará por una versión revisada.'],
] as const;

describe('LegalMarkdown · corpus y seguridad', () => {
  it('conserva íntegros los 36 segmentos ordenados contra un oráculo independiente', () => {
    const observed = [...render(OWNER_BODY).matchAll(/<(h2|h3|li|p)>([\s\S]*?)<\/\1>/g)]
      .map((match) => [match[1], normal(textOf(match[2]!))]);
    expect(ORACLE).toHaveLength(36);
    expect(observed).toEqual(ORACLE);
  });
  it('fija los bytes del corpus owner 2.4.1 sin normalizar el body', () => {
    expect(Buffer.byteLength(OWNER_BODY, 'utf8')).toBe(4536);
    expect(createHash('sha256').update(OWNER_BODY).digest('hex')).toBe('48425f2baabb23857c8bacbf643a08bf28410a85cff930fa0f74ba11b79ef35f');
    const html = render(OWNER_BODY);
    expect(html.match(/<h2>/g)).toHaveLength(1);
    expect(html.match(/<h3>/g)).toHaveLength(8);
    expect(html.match(/<ul>/g)).toHaveLength(4);
    expect(html.match(/<li>/g)).toHaveLength(16);
    expect(html.match(/<p>/g)).toHaveLength(11);
    expect(html.match(/<strong>/g)).toHaveLength(25);
    expect(html.match(/<em>/g)).toHaveLength(1);
  });

  it('acumula continuaciones de lista ANTES del énfasis y conserva cada palabra', () => {
    const html = render('# Documento\n\n## Datos\n\n- **Una negrita\n  en dos líneas** seguida de texto.\n- Otro ítem\n  completo.\n\n*Una cursiva\nque termina aquí.*');
    expect(html).toContain('<h2>Documento</h2>');
    expect(html).toContain('<h3>Datos</h3>');
    expect(html).toContain('<li><strong>Una negrita\nen dos líneas</strong> seguida de texto.</li>');
    expect(html).toContain('<li>Otro ítem\ncompleto.</li>');
    expect(html).toContain('<em>Una cursiva\nque termina aquí.</em>');
    expect(html.match(/<li>/g)).toHaveLength(2);
    expect(render('**Tu foto de perfil es privada:** sólo tu sesión.'))
      .toContain('<strong>Tu foto de perfil es privada:</strong> sólo tu sesión.');
  });

  it.each([
    '<script>alert("x")</script>',
    '<img src="x" onerror="alert(1)">',
    '<svg onload="alert(1)"><a href="data:x">x</a></svg>',
    '[Abrir](javascript:alert(1))',
    '![Foto](data:image/png;base64,AAAA)',
    'https://example.invalid/**ruta**',
    'ftp://example.invalid/**ruta**',
    'custom://x/*ruta*',
    'urn:payme:**literal**',
    'mailto:prueba@example.invalid?body=*literal*',
    'Texto <iframe src="https://example.invalid"></iframe> **literal**',
    '`**código**`',
    '**incompleta', '*incompleta', '**cierre distinto*', '***no soportado***',
    '**sin cerrar *cursiva*', '**exterior *interior* exterior**',
    '### Tercer nivel no soportado', '##', '1. Lista no soportada',
    '\\*escape no soportado*', '[incompleto', '~~tachado no soportado~~',
  ])('conserva sintaxis desconocida/hostil como texto: %s', (body) => {
    const html = render(body);
    expect(normal(textOf(html))).toBe(normal(body));
    expect(html).not.toMatch(/<(?:script|img|svg|iframe|a|style)\b/i);
    expect(html).not.toMatch(/<[a-z][^>]*\s(?:href|src|on\w+)\s*=/i);
  });

  it.each([
    '```\n# Título\n- dato\n```',
    'Antes\r```\r# Título\r- dato\r```',
    '```\n\n# Título\n\n- dato\n```',
    '# Antes\n\n~~~texto\n# No es título\n- dato\n~~~\n\n## Después',
    '```sin cierre\n\n# Título\n- dato',
    '<script>\n# texto\n- dato\n</script>',
    '<div>\n\n# texto\n\n- dato\n</div>',
    '# Antes\n\n<section>\n# desconocido\n- sin cierre',
  ])('contenedores no soportados son opacos antes del split: %s', (body) => {
    const html = render(body);
    expect(textOf(html)).toBe(body);
    expect(html).not.toMatch(/<(?:h[1-6]|ul|li|script|section)\b/);
    expect(html.match(/<p>/g)).toHaveLength(1);
  });

  it('texto largo, acentos y metacaracteres permanecen íntegros', () => {
    const body = `Árbol, México & «sí» ${'palabralarga'.repeat(3000)} <fin>`;
    expect(textOf(render(body))).toBe(body);
  });

  it('sólo emite el vocabulario seguro y no agrega otro h1', () => {
    const html = render(OWNER_BODY);
    const tags = new Set([...html.matchAll(/<\/?([a-z][a-z0-9]*)\b/g)].map((m) => m[1]));
    expect([...tags].sort()).toEqual(['div', 'em', 'h2', 'h3', 'li', 'p', 'strong', 'ul']);
    expect(html).toContain('class="legal-markdown" lang="es"');
  });

  it('helper puro, sin imports de datos/efectos ni mecanismos de HTML recibido', () => {
    const source = readFileSync(new URL('./LegalMarkdown.tsx', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect([...source.matchAll(/from '([^']+)'/g)].map((m) => m[1])).toEqual(['react']);
    expect(source).not.toMatch(/dangerouslySetInnerHTML|innerHTML|useEffect|fetch\(|localStorage|sessionStorage|document\.cookie|\bhref=|\bsrc=/);
  });
});
