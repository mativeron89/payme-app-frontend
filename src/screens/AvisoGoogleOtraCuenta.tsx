import { motorDe } from '../api/googlePopupDiagnostico';
import { useIdioma } from '../i18n/idioma';

/**
 * RM-182 · 5b · el aviso bajo el botón de Google para cambiar de cuenta en
 * Safari. Texto: decisión 11 de Mati («Aprobar el aviso»), pasado al tuteo de
 * la app (el original está en voseo y `registroMexicano.test.ts` lo rechaza;
 * mismo criterio que con los textos del diseño, 2026-09-19. Fuente:
 * `ops/bibliotecario-claude-20260917/DECISION_MATI_DECISIONES_7_A_14_20260923.md`,
 * sha256 `7d2066b0…862e`). Sólo en WebKit, que es donde se ve el problema (en
 * iOS todos los navegadores lo son); la detección es por `userAgent`, y un
 * `userAgent` vacío (sin navegador) no lo muestra.
 */
export function mostrarAvisoGoogleOtraCuenta(userAgent: string): boolean {
  return motorDe(userAgent) === 'webkit';
}

export function AvisoGoogleOtraCuenta() {
  const { t } = useIdioma();
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (!mostrarAvisoGoogleOtraCuenta(ua)) return null;
  return (
    <p className="ingreso-legal" data-aviso="google-otra-cuenta">
      {t('Si entraste con Google y quieres usar otra cuenta, cierra sesión de Google en Safari y vuelve a intentar.')}
    </p>
  );
}
