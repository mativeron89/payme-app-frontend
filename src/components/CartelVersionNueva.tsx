import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useIdioma } from '../i18n/idioma';
import { useVersionNuevaPublicada, type RevisionDeVersion } from '../api/versionPublicada';

/**
 * AF-CARTEL-VERSION-NUEVA · decisión 125 de Mati: «Cartel para actualizar
 * (Recomendada)». Con la sesión iniciada, una pestaña vieja muestra «Hay una
 * versión nueva · Actualizar» y recarga SÓLO si la persona toca. Nunca sola: lo
 * que esté escribiendo no se pierde por una publicación. El ingreso sigue
 * recargando solo (`useRecargaPorVersionNueva` en `LoginScreen`).
 *
 * - Revisa igual que el ingreso: al montar, al volver a la pestaña y desde el
 *   bfcache (`useVersionNuevaPublicada`).
 * - Va ARRIBA y en el flujo, primer hijo de `.app` (`App.tsx`): empuja la
 *   pantalla y no tapa nada. Abajo lo taparían `.fab` y `.cta-float`, que son
 *   fijos.
 * - La × lo cierra hasta la próxima revisión: si sigue habiendo una versión más
 *   nueva, vuelve.
 * - Sin respuesta, con una respuesta rara o con la misma versión: nada.
 */

/** ¿Se ve? Con versión más nueva, salvo que se haya cerrado en ESTA revisión. */
export function cartelVisible(revision: RevisionDeVersion, cerradoEn: number | null): boolean {
  return revision.nueva !== null && cerradoEn !== revision.n;
}

export function VistaCartelVersionNueva({
  onActualizar,
  onCerrar,
}: {
  readonly onActualizar: () => void;
  readonly onCerrar: () => void;
}) {
  const { t } = useIdioma();
  return (
    <div className="cartel-version" role="status" aria-live="polite">
      <span className="cartel-version-texto">{t('Hay una versión nueva')}</span>
      <button type="button" className="cartel-version-actualizar" onClick={onActualizar}>
        {t('Actualizar')}
      </button>
      <button type="button" className="cartel-version-cerrar" aria-label={t('Cerrar')} onClick={onCerrar}>
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

function CartelConSesion() {
  const revision = useVersionNuevaPublicada(true);
  const [cerradoEn, setCerradoEn] = useState<number | null>(null);
  if (!cartelVisible(revision, cerradoEn)) return null;
  return (
    <VistaCartelVersionNueva
      onActualizar={() => window.location.reload()}
      onCerrar={() => setCerradoEn(revision.n)}
    />
  );
}

/**
 * Sólo con sesión, uno por cuenta: sin sesión no se monta ni revisa (el ingreso
 * tiene lo suyo), y al cambiar de cuenta arranca de cero.
 */
export function CartelVersionNueva() {
  const { session } = useAuth();
  return session ? <CartelConSesion key={session.principal_id} /> : null;
}
