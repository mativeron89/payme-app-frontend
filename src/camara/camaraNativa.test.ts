import { describe, expect, it } from 'vitest';
import { crearCamaraNativa, type DocumentoParaCamara } from './camaraNativa';

/** Un `<input>` y un `document` falsos: vitest corre sin DOM. */
class EntradaFalsa {
  type = '';
  accept = '';
  hidden = false;
  tabIndex = 0;
  value = 'C:\\fakepath\\foto.jpg';
  files: File[] | null = null;
  isConnected = false;
  clics = 0;
  readonly atributos = new Map<string, string>();
  private oyente: (() => void) | null = null;
  setAttribute(nombre: string, valor: string) { this.atributos.set(nombre, valor); }
  removeAttribute(nombre: string) { this.atributos.delete(nombre); }
  addEventListener(evento: string, oyente: () => void) { if (evento === 'change') this.oyente = oyente; }
  click() { this.clics += 1; }
  /** Lo que hace el navegador cuando la persona toca «Usar foto». */
  elegir(foto: File | null) {
    this.files = foto ? [foto] : [];
    this.value = foto ? 'C:\\fakepath\\foto.jpg' : '';
    this.oyente?.();
  }
}

function documentoFalso() {
  const creadas: EntradaFalsa[] = [];
  const doc = {
    createElement: () => {
      const e = new EntradaFalsa();
      creadas.push(e);
      return e;
    },
    body: {
      append: (e: EntradaFalsa) => { e.isConnected = true; },
    },
  } as unknown as DocumentoParaCamara;
  return { doc, creadas };
}

const foto = () => new File([new Uint8Array(10)], 'image.jpg', { type: 'image/jpeg' });

describe('D212 · la cámara nativa', () => {
  it('🔴 abre la cámara trasera directo: accept image/*, capture environment, oculta', () => {
    const { doc, creadas } = documentoFalso();
    crearCamaraNativa(doc).abrir();
    expect(creadas).toHaveLength(1);
    const e = creadas[0]!;
    expect(e.type).toBe('file');
    expect(e.accept).toBe('image/*');
    expect(e.atributos.get('capture')).toBe('environment');
    expect(e.hidden).toBe(true);
    expect(e.isConnected).toBe(true);
    expect(e.clics).toBe(1);
  });

  it('una sola entrada para toda la app: abrir otra vez reusa la misma', () => {
    const { doc, creadas } = documentoFalso();
    const camara = crearCamaraNativa(doc);
    camara.abrir();
    camara.abrir();
    expect(creadas).toHaveLength(1);
    expect(creadas[0]!.clics).toBe(2);
  });

  it('si la sacaron del documento, la vuelve a crear', () => {
    const { doc, creadas } = documentoFalso();
    const camara = crearCamaraNativa(doc);
    camara.abrir();
    creadas[0]!.isConnected = false;
    camara.abrir();
    expect(creadas).toHaveLength(2);
  });

  it('🔴 la foto llega a quien escucha, y la entrada se limpia para la próxima', () => {
    const { doc, creadas } = documentoFalso();
    const camara = crearCamaraNativa(doc);
    const recibidas: File[] = [];
    camara.alRecibirFoto((f) => recibidas.push(f));
    camara.abrir();
    const f = foto();
    creadas[0]!.elegir(f);
    expect(recibidas).toEqual([f]);
    expect(creadas[0]!.value).toBe('');
  });

  it('🔴 una foto que llega sin nadie escuchando se descarta: no aparece después', () => {
    const { doc, creadas } = documentoFalso();
    const camara = crearCamaraNativa(doc);
    const recibidas: File[] = [];
    const dejar = camara.alRecibirFoto((f) => recibidas.push(f));
    camara.abrir();
    dejar();
    creadas[0]!.elegir(foto());
    camara.alRecibirFoto((f) => recibidas.push(f));
    expect(recibidas).toEqual([]);
    expect(creadas[0]!.value).toBe('');
  });

  it('dejar de escuchar no le saca la foto a un receptor más nuevo', () => {
    const { doc, creadas } = documentoFalso();
    const camara = crearCamaraNativa(doc);
    const viejo: File[] = [];
    const nuevo: File[] = [];
    const dejarViejo = camara.alRecibirFoto((f) => viejo.push(f));
    camara.alRecibirFoto((f) => nuevo.push(f));
    dejarViejo();
    camara.abrir();
    creadas[0]!.elegir(foto());
    expect(viejo).toEqual([]);
    expect(nuevo).toHaveLength(1);
  });

  it('cancelar (sin archivo) no entrega nada', () => {
    const { doc, creadas } = documentoFalso();
    const camara = crearCamaraNativa(doc);
    const recibidas: File[] = [];
    camara.alRecibirFoto((f) => recibidas.push(f));
    camara.abrir();
    creadas[0]!.elegir(null);
    expect(recibidas).toEqual([]);
  });
});

describe('D368 · el menú del teléfono desde el «Escanear» de la barra', () => {
  /** El respaldo estricto del `accept` (antes de que cargue la configuración del OCR). */
  const ACCEPT_RESPALDO_ESTRICTO = 'image/jpeg,image/jpg,image/png';

  it('🔴 abre la misma entrada SIN capture y con el accept que recibe (acá, el respaldo estricto)', () => {
    const { doc, creadas } = documentoFalso();
    crearCamaraNativa(doc).abrirMenu(ACCEPT_RESPALDO_ESTRICTO);
    expect(creadas).toHaveLength(1);
    const e = creadas[0]!;
    expect(e.atributos.has('capture')).toBe(false);
    expect(e.accept).toBe(ACCEPT_RESPALDO_ESTRICTO);
    expect(e.atributos.get('data-camara')).toBe('nativa');
    expect(e.clics).toBe(1);
  });

  it('🔴 después del menú, abrir() vuelve a poner capture y image/* (y al revés)', () => {
    const { doc, creadas } = documentoFalso();
    const camara = crearCamaraNativa(doc);
    camara.abrirMenu(ACCEPT_RESPALDO_ESTRICTO);
    camara.abrir();
    const e = creadas[0]!;
    expect(creadas).toHaveLength(1);
    expect(e.atributos.get('capture')).toBe('environment');
    expect(e.accept).toBe('image/*');
    camara.abrirMenu(ACCEPT_RESPALDO_ESTRICTO);
    expect(e.atributos.has('capture')).toBe(false);
    expect(e.accept).toBe(ACCEPT_RESPALDO_ESTRICTO);
  });

  it('🔴 la foto llega con cómo se abrió: «menu» o «camara»', () => {
    const { doc, creadas } = documentoFalso();
    const camara = crearCamaraNativa(doc);
    const origenes: string[] = [];
    camara.alRecibirFoto((_f, origen) => origenes.push(origen));
    camara.abrirMenu(ACCEPT_RESPALDO_ESTRICTO);
    creadas[0]!.elegir(foto());
    camara.abrir();
    creadas[0]!.elegir(foto());
    expect(origenes).toEqual(['menu', 'camara']);
  });
});
