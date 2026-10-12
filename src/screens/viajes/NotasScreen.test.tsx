import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResumenDeNotas } from '../../api/viajes';
import type { Apartado, EntradaDeNotas, Pizarron } from '../../api/viajesNotas';
import { FilaDeNotas } from './FilaDeNotas';
import { ApartadoDeOtroVista, HojaDeLista, HojaDeNota, PizarronVista, type PizarronVistaProps } from './NotasScreen';
import { VistaDelViajeCerrado } from './ViajeCerradoScreen';
import { traducir } from '../../i18n/idioma';

// Las hojas van por portal a `body`; sin DOM (renderToStaticMarkup), se pintan en el lugar.
vi.mock('react-dom', async (original) => ({ ...(await original<typeof import('react-dom')>()), createPortal: (n: unknown) => n }));

/**
 * 🔴 D290 · el pizarrón de notas, pantalla por pantalla (PANTALLA-notas-del-viaje.md manda): quién ve y quién escribe, el
 * cerrado, la vista con muchas personas, la fila del viaje y las medidas. Y la privacidad: el texto no sale de la pantalla.
 */
const en = '2026-10-12T03:00:00.000Z';
const nota = (id: string, texto = 'Llevo la bocina'): EntradaDeNotas => ({ id, tipo: 'nota', texto, version: 1, creado_en: en, actualizado_en: en });
const lista = (id: string, items: Array<[string, boolean]>): EntradaDeNotas => ({ id, tipo: 'lista', titulo: 'Para llevar', version: 1,
  creado_en: en, actualizado_en: en, items: items.map(([texto, tildado], k) => ({ id: `${id}-${k}`, texto, tildado })) });
const ap = (id: string, nombre: string, apellido: string, entradas: EntradaDeNotas[] = [], yo = false): Apartado => ({
  miembro_id: id, first_name: nombre, last_name: apellido, username: null, eliminada: false, has_avatar: false, es_yo: yo,
  actualizado_en: entradas.length ? en : null, entradas,
});
const LIMITES = { entradas_por_miembro: 20, caracteres_nota: 500, items_por_lista: 30, caracteres_item: 80, caracteres_titulo: 80 };
const pizarron = (apartados: Apartado[], cambios: Partial<Pizarron> = {}): Pizarron => ({
  viaje_id: 'v', nombre: 'Cancún 2026', estado: 'abierto', cerrado_en: null, editable: true, total: apartados.length,
  escribieron: apartados.filter((a) => a.entradas.length).length, limites: LIMITES, apartados, ...cambios,
});
const CUATRO = [
  ap('m1', 'Ana', 'López', [nota('n1'), lista('n2', [['Protector solar', true], ['Gorra', false]])], true),
  ap('m2', 'Luis', 'Pérez', [nota('n3', 'Llegamos el domingo')]),
  ap('m3', 'Sofía', 'Ramírez', [lista('n4', [['Hielo', true]])]),
  ap('m4', 'Diego', 'Torres'),
];
const nada = () => undefined;
const PROPS: Omit<PizarronVistaProps, 'carga'> = {
  tildando: new Map(), fotoDe: () => null, onReintentar: nada, onVerViajes: nada, onNueva: nada, onMenu: nada, onTildar: nada,
  onAbrirApartado: nada,
};
const render = (p: Pizarron) => renderToStaticMarkup(<PizarronVista carga={{ tipo: 'listo', pizarron: p }} {...PROPS} />);
const texto = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
/** El HTML de un apartado, por su etiqueta. */
const seccion = (html: string, etiqueta: string) => {
  const i = html.indexOf(`aria-label="${etiqueta}"`);
  if (i < 0) return '';
  return html.slice(html.indexOf('>', i) + 1, html.indexOf('</section>', i));
};

describe('🔴 D290 · quién ve y quién escribe', () => {
  const html = render(pizarron(CUATRO));

  it('todos leen todo: los cuatro apartados, el mío primero con su cabecera celeste y «Tú»', () => {
    expect([...html.matchAll(/<section[^>]*aria-label="([^"]+)"/g)].map((m) => m[1]))
      .toEqual(['Tu apartado', 'Apartado de Luis Pérez', 'Apartado de Sofía Ramírez', 'Apartado de Diego Torres']);
    expect(seccion(html, 'Tu apartado')).toContain('class="nts-mio-cabecera"');
    expect(texto(seccion(html, 'Tu apartado'))).toMatch(/^AL Tú Tu apartado · 1 nota, 1 lista /);
    expect(texto(html)).toContain('Llegamos el domingo');
    expect(texto(seccion(html, 'Apartado de Diego Torres'))).toContain('Todavía no anotó nada');
  });

  it('🔴 en lo mío, el menú ⋯ de cada entrada, el renglón que tilda y + Nota / + Lista; en lo de otro, ningún control', () => {
    const mio = seccion(html, 'Tu apartado');
    expect(mio).toContain('aria-label="Editar o borrar la nota"');
    expect(mio).toContain('aria-label="Editar o borrar la lista"');
    expect([...mio.matchAll(/role="checkbox" aria-checked="(true|false)"/g)].map((m) => m[1])).toEqual(['true', 'false']);
    expect(mio).toContain('aria-label="Nota nueva"');
    expect(mio).toContain('aria-label="Lista nueva"');
    for (const otro of ['Apartado de Luis Pérez', 'Apartado de Sofía Ramírez', 'Apartado de Diego Torres']) {
      const s = seccion(html, otro);
      expect(s, otro).not.toMatch(/role="checkbox"|Editar o borrar|Nota nueva|Lista nueva|Escribir nota|Armar lista/);
    }
    // Lo tildado de otro se ve (la casilla llena y el texto tachado), y se dice.
    const sofia = seccion(html, 'Apartado de Sofía Ramírez');
    expect(sofia).toContain('nts-casilla nts-casilla-tildada');
    expect(texto(sofia)).toContain('Hielo tildado');
  });

  it('la nota de otro se recorta en el pizarrón; la mía, no', () => {
    expect(seccion(html, 'Apartado de Luis Pérez')).toContain('nts-nota-texto nts-nota-recortada');
    expect(seccion(html, 'Tu apartado')).not.toContain('nts-nota-recortada');
  });

  it('mi apartado vacío: el lápiz, «Todavía no anotaste nada», la ayuda y los dos botones', () => {
    const vacio = render(pizarron([ap('m1', 'Ana', 'López', [], true), CUATRO[1]!]));
    expect(texto(seccion(vacio, 'Tu apartado'))).toBe(
      'AL Tú Tu apartado Todavía no anotaste nada Anota un plan o arma una lista. Todos los del viaje lo ven; sólo tú lo editas. Escribir nota Armar lista');
  });

  it('🔴 en el tope de 20, + Nota y + Lista se apagan con el aviso', () => {
    const veinte = Array.from({ length: 20 }, (_, k) => nota(`t${k}`));
    const h = seccion(render(pizarron([ap('m1', 'Ana', 'López', veinte, true)])), 'Tu apartado');
    expect(h).toMatch(/<button type="button" class="nts-mas" disabled="" aria-label="Nota nueva"/);
    expect(h).toMatch(/<button type="button" class="nts-mas" disabled="" aria-label="Lista nueva"/);
    expect(texto(h)).toContain('Llegaste al tope de 20 notas y listas. Borra una para sumar otra.');
  });
});

describe('🔴 D290 · cerrado y esperando pagos: todo para leer (PANTALLA §5)', () => {
  const cerrado = render(pizarron(CUATRO, { estado: 'cerrado', editable: false, cerrado_en: '2026-03-20T18:00:00.000Z' }));

  it('la tarjeta con candado y la fecha en hora de México', () => {
    expect(texto(cerrado)).toContain('El viaje se cerró el 20 mar. Las notas quedan para leer; ya nadie puede editarlas.');
    expect(cerrado).toMatch(/<p class="nts-candado" role="note">/);
  });

  it('ningún control en ningún apartado, tampoco en el mío; las tildes como estaban', () => {
    expect(cerrado).not.toMatch(/role="checkbox"|Editar o borrar|Nota nueva|Lista nueva|Escribir nota|Armar lista/);
    expect((seccion(cerrado, 'Tu apartado').match(/nts-casilla-tildada/g) ?? []).length).toBe(1);
  });

  it('2h · cerrado, los que no escribieron van juntos en una línea', () => {
    expect(texto(cerrado)).toContain('Diego no dejó notas');
    expect(cerrado).not.toContain('aria-label="Apartado de Diego Torres"');
  });

  it('esperando pagos también: el candado (con el día en que se cerró)', () => {
    const esperando = render(pizarron(CUATRO, { estado: 'esperando_pagos', editable: false, cerrado_en: '2026-09-22T15:00:00.000Z' }));
    expect(texto(esperando)).toContain('El viaje se cerró el 22 sep.');
    expect(esperando).not.toContain('role="checkbox"');
  });

  it('abierto sin poder escribir (la cuenta suspendida): lo dice, y sin controles', () => {
    const suspendida = render(pizarron(CUATRO, { editable: false }));
    expect(texto(suspendida)).toContain('Tu cuenta está suspendida. Puedes leer las notas, pero no escribir.');
    expect(suspendida).not.toMatch(/role="checkbox"|Editar o borrar|Nota nueva/);
  });
});

describe('D290 · con 6 o más personas (PANTALLA §4)', () => {
  const siete = [
    ...CUATRO,
    ap('m5', 'Marta', 'Gil', [nota('n5')]), ap('m6', 'Pablo', 'Núñez'), ap('m7', 'Rosa', 'Díaz'),
  ];
  const html = render(pizarron(siete));

  it('la tira de fotos (el mío primero, «Tú»), «Con notas · n» en filas y «Sin notas todavía · n» en una línea', () => {
    expect(html).toContain('<nav class="nts-tira" aria-label="Personas del viaje">');
    expect([...html.matchAll(/class="nts-tira-nombre">([^<]+)</g)].map((m) => m[1])).toEqual(['Tú', 'Luis', 'Sofía', 'Diego', 'Marta', 'Pablo', 'Rosa']);
    expect(texto(html)).toContain('Con notas · 3');
    expect([...html.matchAll(/class="nts-fila-persona"/g)]).toHaveLength(3);
    // Los avatares superpuestos (sus iniciales, ocultas al lector) y los nombres en una línea.
    expect(texto(html)).toContain('Sin notas todavía · 3 DT PN RD Diego, Pablo y Rosa');
    // Los apartados de los demás no se abren en el pizarrón: se abren por su fila.
    expect(html).not.toContain('aria-label="Apartado de Luis Pérez"');
  });

  it('con 5, no', () => {
    expect(render(pizarron(siete.slice(0, 5)))).not.toContain('nts-tira');
  });
});

describe('D290 · el apartado de otro', () => {
  it('su nombre, «Notas · {viaje}», todo el texto, «Sólo {nombre} puede escribir…», anterior y siguiente', () => {
    const p = pizarron(CUATRO);
    const html = renderToStaticMarkup(<ApartadoDeOtroVista pizarron={p} apartado={CUATRO[1]!} foto={null} onIr={nada} />);
    expect(texto(html)).toMatch(/^LP Luis Pérez Notas · Cancún 2026 Llegamos el domingo Sólo Luis puede escribir en su apartado\. Tú Sofía$/);
    expect(html).not.toContain('nts-nota-recortada');
    expect(html).not.toMatch(/role="checkbox"|Editar o borrar/);
    // El último: sólo anterior.
    const ultimo = renderToStaticMarkup(<ApartadoDeOtroVista pizarron={p} apartado={CUATRO[3]!} foto={null} onIr={nada} />);
    expect(texto(ultimo)).toMatch(/Sólo Diego puede escribir en su apartado\. Sofía$/);
  });
});

describe('D290 · la fila «Notas» (PANTALLA §1)', () => {
  const fila = (r: ResumenDeNotas | null) => renderToStaticMarkup(<FilaDeNotas resumen={r} onAbrir={nada} />);

  it('«{n} de {total} escribieron» y el punto naranja sólo con algo nuevo', () => {
    const con = fila({ escribieron: 3, total: 4, nuevo: true });
    expect(texto(con)).toBe('Notas 3 de 4 escribieron');
    expect(con).toContain('<span class="nts-punto" role="img" aria-label="Hay notas nuevas"></span>');
    expect(fila({ escribieron: 3, total: 4, nuevo: false })).not.toContain('nts-punto');
  });

  it('sin el resumen (el detalle no llegó): la fila sin número ni punto, nunca «nada nuevo» inventado', () => {
    const sin = fila(null);
    expect(texto(sin)).toBe('Notas');
    expect(sin).not.toContain('nts-punto');
  });

  it('la traducción EN', () => {
    expect(traducir('{0} de {1} escribieron', 'en', 3, 4)).toBe('3 of 4 wrote');
    expect(traducir('Hay notas nuevas', 'en')).toBe('There are new notes');
  });

  it('🔴 dónde va: abierto, debajo de «Ver balance del viaje» (D297: «Configuración» pasó a la tarjeta); esperando pagos, antes de «Salir»; cerrado, debajo de «Lugares visitados»', () => {
    const viaje = readFileSync(new URL('./ViajeScreen.tsx', import.meta.url), 'utf8');
    const abierto = viaje.slice(viaje.indexOf('function ViajeAbierto'), viaje.indexOf('export function MontoDeBalance'));
    const i = (s: string) => abierto.indexOf(s);
    expect(i("t('Ver balance del viaje')")).toBeGreaterThan(0);
    expect(i('<FilaDeNotas')).toBeGreaterThan(i("t('Ver balance del viaje')"));
    // D297 · después de «Notas» ya no va la fila «Configuración»: sigue el aviso de la cámara.
    expect(abierto).not.toContain("t('Configuración')");
    expect(i('className="vjv-aviso-cargar"')).toBeGreaterThan(i('<FilaDeNotas'));
    const esperando = viaje.slice(viaje.indexOf('function EsperandoPagos'), viaje.indexOf('export function BotonSalir'));
    expect(esperando.match(/<FilaDeNotas resumen=\{v\.notas\} onAbrir=\{onNotas\} \/>\s*<BotonSalir/g)).toHaveLength(2);
    // El cerrado, pintado: la fila va enseguida de la lista de lugares.
    const r = { viaje_id: 'v', nombre: 'Oaxaca', fecha_desde: null, fecha_hasta: null, personas: 5, consumiste_cents: 0,
      pagaste_en_tickets_cents: 0, te_transfirieron_cents: 0, transferiste_cents: 0, por_tipo_de_lugar: [],
      lugares: [{ ticket_id: 't', lugar: 'La Olla', tipo_lugar: 'restaurante' as const, fecha_ticket: null, forma: 'iguales' as const,
        pagaste_tu: false, mi_monto_cents: 100, asignado_al_cierre_cents: 0, items: [] }] };
    const cerrado = renderToStaticMarkup(
      <VistaDelViajeCerrado carga={{ estado: 'listo', resumen: r }} t={(x, ...a) => traducir(x, 'es', ...a)} idioma="es"
        abiertos={new Set()} onAlternar={nada} onReintentar={nada} onVerViajes={nada} onSalir={nada}
        notas={{ escribieron: 2, total: 5, nuevo: true }} onNotas={nada} />,
    );
    expect(cerrado).toMatch(/<\/ul><button type="button" class="nts-fila">[^]*?2 de 5 escribieron[^]*?<\/button><button type="button" class="vjv-salir">/);
  });
});

describe('D290 · las hojas de escribir (PANTALLA §3)', () => {
  // El portal nombra `document.body` (con el mock de arriba, la hoja se pinta en el lugar).
  beforeEach(() => { vi.stubGlobal('document', { body: {} }); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('la nota: «Nota nueva», «Escribe un plan, un horario, un dato…», el tope de 500 en el campo y «0 / 500»', () => {
    const html = renderToStaticMarkup(<HojaDeNota entrada={null} tope={500} onCancelar={nada} onGuardar={async () => ({ cerrar: true })} />);
    expect(html).toContain('maxLength="500"');
    expect(html).toContain('placeholder="Escribe un plan, un horario, un dato…"');
    expect(texto(html)).toBe('Cancelar Nota nueva Guardar La ven todos los del viaje. 0 / 500');
    // Sin texto no se guarda.
    expect(html).toMatch(/<button type="button" class="nts-hoja-guardar" disabled=""/);
  });

  it('la lista: título de 80, ítems de 80 y «0 / 30 ítems»; editando, con lo que había', () => {
    const html = renderToStaticMarkup(<HojaDeLista entrada={null} limites={LIMITES} onCancelar={nada} onGuardar={async () => ({ cerrar: true })} />);
    expect([...html.matchAll(/maxLength="(\d+)"/g)].map((m) => m[1])).toEqual(['80', '80']);
    expect(texto(html)).toBe('Cancelar Lista nueva Guardar Agregar Las tildas después, en tu apartado. 0 / 30 ítems');
    const editar = renderToStaticMarkup(<HojaDeLista entrada={CUATRO[0]!.entradas[1] as Extract<EntradaDeNotas, { tipo: 'lista' }>}
      limites={LIMITES} onCancelar={nada} onGuardar={async () => ({ cerrar: true })} />);
    expect(editar).toContain('value="Para llevar"');
    expect([...editar.matchAll(/aria-label="Ítem (\d+)"[^>]*value="([^"]+)"|value="([^"]+)"[^>]*aria-label="Ítem (\d+)"/g)]).toHaveLength(2);
    expect(texto(editar)).toContain('2 / 30 ítems');
  });
});

describe('🔴 D290 · las medidas de la especificación', () => {
  const css = readFileSync(new URL('./notas.css', import.meta.url), 'utf8');
  const regla = (sel: string) => {
    const i = css.indexOf(`\n${sel} {`);
    return i < 0 ? '' : css.slice(i, css.indexOf('}', i));
  };

  it('§1 · la fila: 56 de alto, padding 0 16, el radio de sus vecinas (D293), la sombra, gap 10, cian oscuro 16/700; el punto de 8 naranja', () => {
    // D293 · Mati: «Igualarla a las vecinas»: el radio de «Ver balance del viaje» y «Configuración» (`.vj-card`).
    expect(readFileSync(new URL('./viajes.css', import.meta.url), 'utf8')).toMatch(/\.vj-card \{[^}]*border-radius: var\(--r-lg\);/);
    for (const d of ['min-height: 56px;', 'padding: 0 16px;', 'border-radius: var(--r-lg);', 'box-shadow: 0 2px 8px rgba(16, 30, 59, 0.06);',
      'gap: 10px;', 'font-size: 16px;', 'font-weight: 700;', 'color: var(--link);']) expect(regla('.nts-fila'), d).toContain(d);
    for (const d of ['width: 8px;', 'height: 8px;', 'background: var(--brand);']) expect(regla('.nts-punto'), d).toContain(d);
    expect(regla('.nts-fila-resumen')).toContain('font-size: 14px;');
    expect(css).toContain('.nts-fila-chev path { stroke-width: 2.2; }');
    expect(css).toContain('.nts-fila-icono path { stroke-width: 2; }');
  });

  it('§2 · el apartado: radio 22, padding 16; el mío con la cabecera celeste 12 16 y el cuerpo 14 16 16; el avatar de 40', () => {
    expect(regla('.nts-apartado')).toMatch(/padding: 16px;[^]*border-radius: var\(--r-lg\);/);
    expect(regla('.nts-mio-cabecera')).toMatch(/padding: 12px 16px;[^]*background: var\(--teal-l\);/);
    expect(regla('.nts-mio-cuerpo')).toContain('padding: 14px 16px 16px;');
    expect(regla('.nts-avatar')).toMatch(/width: 40px;[^]*height: 40px;[^]*font-size: 14px;[^]*font-weight: 800;/);
    expect(regla('.nts-avatar-mio')).toBe('\n.nts-avatar-mio { background: var(--action); color: var(--on-dark); ');
  });

  it('§2 · la nota: fondo de página, radio 14, padding 12 14, 16/1.5; recortada a 4 líneas', () => {
    expect(regla('.nts-nota')).toMatch(/padding: 12px 14px;[^]*background: var\(--bg\);[^]*border-radius: 14px;/);
    expect(regla('.nts-nota-texto')).toMatch(/font-size: 16px;[^]*line-height: 1\.5;/);
    expect(regla('.nts-nota-recortada')).toContain('-webkit-line-clamp: 4;');
  });

  it('§2 · la casilla 22 × 22, radio 7; vacía con borde 2 gris; tildada cian oscuro con el check de trazo 3; el texto tachado', () => {
    expect(regla('.nts-casilla')).toMatch(/width: 22px;[^]*height: 22px;[^]*border-radius: 7px;[^]*border: 2px solid var\(--text-muted\);/);
    expect(regla('.nts-casilla-tildada')).toContain('background: var(--teal-txt);');
    expect(css).toContain('.nts-casilla-tildada path { stroke-width: 3; }');
    expect(regla('.nts-item-tildado')).toBe('\n.nts-item-tildado { color: var(--text-muted); text-decoration: line-through; ');
    expect(regla('.nts-items-mios .nts-item')).toContain('min-height: 44px;');
    expect(regla('.nts-item')).toContain('min-height: 40px;');
  });

  it('§3 · la hoja: radio 24 24 0 0, padding 8 16 28; la agarradera 36 × 4; Guardar de 44 y radio 12; el campo de 200', () => {
    expect(regla('.sheet.nts-hoja')).toMatch(/padding: 8px 16px 28px;[^]*border-radius: 24px 24px 0 0;/);
    expect(regla('.nts-hoja-agarradera')).toMatch(/width: 36px;[^]*height: 4px;/);
    expect(regla('.nts-hoja-guardar')).toMatch(/height: 44px;[^]*border-radius: 12px;[^]*background: var\(--action\);/);
    expect(regla('.nts-campo-nota')).toMatch(/height: 200px;[^]*border: 1\.5px solid var\(--teal-txt\);[^]*border-radius: 16px;/);
    expect(regla('.nts-contador-cerca')).toMatch(/background: var\(--warning-tint\);[^]*color: var\(--warning\);[^]*font-weight: 700;/);
    expect(regla('.nts-contador')).toContain('font-size: 13.5px;');
  });

  it('§4 · la tira fija arriba, con avatares de 44 y el nombre en 12.5', () => {
    expect(regla('.nts-tira')).toMatch(/position: sticky;[^]*top: 0;/);
    expect(regla('.nts-avatar-tira.nts-avatar-mio')).toContain('var(--teal-txt)');
    expect(css).toContain('.nts-avatar-tira { width: 44px; height: 44px; font-size: 13px; }');
    expect(regla('.nts-tira-nombre')).toContain('font-size: 12.5px;');
    expect(regla('.nts-fila-persona')).toContain('min-height: 64px;');
  });
});

describe('🔴 D290 · privacidad: las notas sólo viven en el estado de la pantalla', () => {
  const fuente = readFileSync(new URL('./NotasScreen.tsx', import.meta.url), 'utf8');
  const codigo = fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('ni almacenamiento del navegador, ni lo último visto, ni la consola', () => {
    expect(codigo).not.toMatch(/localStorage|sessionStorage|indexedDB|ultimoVisto\.(leer|guardar)|console\.|MemoriaDeCuenta|sendBeacon/);
  });

  it('cada pedido saca su turno ANTES de pedir, y cada respuesta (o error) se aplica sólo si la cuenta sigue siendo la misma', () => {
    const turnos = codigo.match(/const turno = ultimoVisto\.turno\(\);/g) ?? [];
    const pedidos = codigo.match(/await api\.\w+/g) ?? [];
    expect(pedidos.length).toBeGreaterThan(0);
    // getNotas, editar o crear (nota y lista: una por función), borrar y tildar.
    expect(turnos).toHaveLength(5);
    expect((codigo.match(/!ultimoVisto\.esDeAhora\(turno\)/g) ?? []).length).toBe(2 * turnos.length);
  });

  it('al cambiar de cuenta, la pantalla se vacía y vuelve a pedir (`alVaciarse`)', () => {
    expect(codigo).toMatch(/useEffect\(\(\) => ultimoVisto\.alVaciarse\(\(\) => \{\s*setHoja\(null\);\s*setTildando\(new Map\(\)\);\s*enVuelo\.current\.clear\(\);\s*cargar\(\);/);
  });
});
