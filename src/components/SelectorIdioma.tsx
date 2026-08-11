import { useIdioma } from '../i18n/idioma';

/**
 * Selector de idioma ES/EN · `D-IDIOMA-1` / `D-IDIOMA-2`.
 *
 * 🔴 VIVE EN `Más`, POR PEDIDO DE MATI (2026-08-10):
 *
 * > *«Y en la app? está la versión en inglés? necesita el mismo toggle en
 * > "Más"»*
 *
 * Coincide con el spec de Diseño («Idioma — NUEVA 2026-08-10»): fila directa con
 * segmentado inline. **La app no tiene pantalla de Configuración, así que `Más`
 * ES el equivalente** del `ConfigPage` del panel.
 *
 * ── Por qué dos botones y no un `<select>` ──
 * Son dos valores y el cambio es instantáneo; un desplegable agrega un toque sin
 * agregar información. `aria-pressed` dice cuál está activo sin depender del
 * color, que es lo único que un `<select>` daría gratis.
 *
 * ⚠️ **EL RIESGO DE LAYOUT, dicho antes de medirlo.** En el panel, meter este
 * mismo control en una fila que ya estaba llena montó la píldora sobre el nombre
 * —y **la revisión de desbordes de TEXTO lo dio por bueno, porque no era texto
 * que crecía: era un elemento nuevo en una fila llena**—. Acá ocupa el lugar de
 * la flecha `→` de las otras filas, que es más angosto que esto. Se verifica con
 * CAPTURA a 375 px, no con el DOM.
 */
export function SelectorIdioma() {
  const { idioma, setIdioma, t } = useIdioma();
  return (
    <div className="lang-switch" role="group" aria-label={t('Idioma')}>
      {(['es', 'en'] as const).map((code) => (
        <button
          key={code}
          type="button"
          className={`lang-btn${idioma === code ? ' lang-btn-on' : ''}`}
          aria-pressed={idioma === code}
          onClick={() => setIdioma(code)}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
