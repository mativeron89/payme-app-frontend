import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from 'react';
import { EN } from './en';

/**
 * IDIOMA DE LA APP · `D-IDIOMA-1` / `D-IDIOMA-2` (Mati, 2026-08-10).
 *
 * Español por defecto, inglés opcional, **por dispositivo y sin backend**.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 LA CLAVE ES EL STRING EN ESPAÑOL. El porqué está en `en.ts`; acá va la
 * consecuencia operativa: **`t()` es la identidad cuando el idioma es `es`**,
 * así que en español no hay lookup, no hay costo y **no hay forma de que una
 * clave faltante rompa la pantalla**.
 *
 * 🔴 Y EN INGLÉS, UNA CLAVE FALTANTE CAE AL ESPAÑOL. Eso NO se arregla acá: se
 * arregla en `traduccion.test.ts`, que extrae los strings del código y exige
 * entrada. **Fallar en pantalla sería peor que fallar en CI** — el usuario
 * vería media pantalla en cada idioma y nadie se enteraría.
 * ─────────────────────────────────────────────────────────────────────────
 */
export type Idioma = 'es' | 'en';

/** Por dispositivo: `D-IDIOMA-2` dice explícitamente que no hay backend. */
const CLAVE = 'payme.app.idioma.v1';

/**
 * 🔴 El prefijo `payme.app.` NO es decorativo. `src/api/storage.ts:10-13`
 * documenta que la demo mock y el build real compartieron `localStorage` por
 * vivir en el mismo origen, y una sesión mock se habría filtrado al backend
 * real. Se mitigó namespaceando; esta clave nace namespaceada.
 */
export function idiomaGuardado(): Idioma {
  try {
    return localStorage.getItem(CLAVE) === 'en' ? 'en' : 'es';
  } catch {
    // `localStorage` puede fallar (modo privado, cuota llena). El idioma no es
    // dato crítico: se cae al español y la app sigue.
    return 'es';
  }
}

/**
 * Traduce, y **sustituye los placeholders posicionales `{0}`, `{1}`…**
 *
 * 68 frases se arman interpolando. La frase ya interpolada no puede ser la
 * clave —«Propina (al mesero): $123.00» no matchea nada—, así que la clave es
 * la plantilla y los valores entran por posición:
 *
 *     t('Propina (al mesero): {0}', formatMXN(result.tip))
 */
export function traducir(texto: string, idioma: Idioma, ...args: unknown[]): string {
  /**
   * 🔴 DEFENSA CONTRA UN VALOR QUE NO ES STRING, y no es paranoia de tipos.
   *
   * Varios `t()` reciben campos que vienen del BACKEND — códigos de mesa,
   * rótulos de estado, nombres de restaurante, textos de invitación —.
   * TypeScript los declara `string` porque así los declara el contrato, pero
   * **el backend desplegado puede ir atrás del repo y no mandar el campo**. Ahí
   * el valor es `undefined` en runtime aunque el tipo diga otra cosa.
   *
   * Sin esta línea, `texto.replace()` tira `TypeError` y la pantalla se cae —
   * **sólo en inglés**, porque el camino español retorna antes de tocar el
   * valor. Un fallo que aparece únicamente en el idioma nuevo y únicamente
   * contra un backend viejo es exactamente el que no se ve en desarrollo.
   *
   * 🔴 **A Dashboard Frontend casi le rompe producción con tres campos. Esta
   * app consume mesas, pagos, invitaciones y notificaciones: tiene MÁS
   * superficie de esto, no menos.** Por eso nace blindado, no parcheado.
   *
   * Medido, no supuesto: `traduccion.test.ts` ejecuta `traducir(undefined)` y
   * exige que no lance, **con caso de control** — sin el control, un
   * `return texto` al tope pasaría el test y rompería la traducción entera.
   */
  if (typeof texto !== 'string') return texto;

  const plantilla = idioma === 'es' ? texto : EN[texto] ?? texto;
  if (args.length === 0) return plantilla;
  return plantilla.replace(/\{(\d+)\}/g, (crudo, n: string) => {
    const v = args[Number(n)];
    // Un índice que no llegó deja el placeholder crudo a propósito: es visible
    // y se arregla. Poner '' lo escondería, que es la forma de que sobreviva.
    return v === undefined ? crudo : String(v);
  });
}

type Ctx = {
  idioma: Idioma;
  setIdioma: (i: Idioma) => void;
  t: (s: string, ...args: unknown[]) => string;
  /**
   * 🔴 El locale de `Intl`, derivado del idioma. Existe porque las fechas son
   * parte de la traducción: **«agosto de 2026» dentro de una app en inglés es
   * la misma media pantalla que una frase sin traducir**, y lo encontró el
   * barrido de la pantalla, no la guarda de cobertura —que sólo mira `t()`—.
   */
  locale: string;
};

const LOCALE: Record<Idioma, string> = { es: 'es-MX', en: 'en-US' };

const IdiomaCtx = createContext<Ctx | null>(null);

export function IdiomaProvider({ children }: { children: ReactNode }) {
  const [idioma, setIdiomaState] = useState<Idioma>(idiomaGuardado);

  // El `lang` del documento acompaña al idioma: lo usan lectores de pantalla y
  // la corrección ortográfica. Una app en inglés con `lang="es"` se lee mal
  // literalmente.
  useEffect(() => {
    document.documentElement.lang = idioma;
  }, [idioma]);

  const setIdioma = useCallback((i: Idioma) => {
    setIdiomaState(i);
    try { localStorage.setItem(CLAVE, i); } catch { /* ver idiomaGuardado */ }
  }, []);

  const valor = useMemo<Ctx>(
    () => ({ idioma, setIdioma, locale: LOCALE[idioma], t: (s, ...a) => traducir(s, idioma, ...a) }),
    [idioma, setIdioma],
  );
  return <IdiomaCtx.Provider value={valor}>{children}</IdiomaCtx.Provider>;
}

/**
 * 🔴 SIN PROVEEDOR NO LANZA: cae al español y sigue.
 *
 * La tentación era `throw new Error('useIdioma debe usarse dentro de…')`, que
 * es lo que hace `AuthContext` en este repo —y ahí está bien, porque sin sesión
 * no hay pantalla que mostrar—. **Acá no: el idioma no es un dato crítico, y un
 * componente que se cae por su propia traducción es peor que uno que se muestra
 * en el idioma equivocado.**
 *
 * Consecuencia útil: los tests que montan un árbol parcial no necesitan
 * envolverse. Si lanzara, cada test de render tendría que conocer el proveedor
 * para probar algo que no tiene que ver con el idioma.
 *
 * ⚠️ Lo que esto NO puede hacer es tapar que el proveedor falte en producción.
 * Eso lo cubre `traduccion.test.ts`, que verifica que `App.tsx` lo monta.
 */
const SIN_PROVEEDOR: Ctx = {
  idioma: 'es',
  locale: LOCALE.es,
  setIdioma: () => undefined,
  t: (s: string, ...args: unknown[]) => traducir(s, 'es', ...args),
};

export function useIdioma(): Ctx {
  return useContext(IdiomaCtx) ?? SIN_PROVEEDOR;
}
