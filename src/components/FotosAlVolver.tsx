import { useEffect, useRef, useState } from 'react';
import { useIdioma } from '../i18n/idioma';
import { Icon } from './Icon';

/**
 * D547 · la pantalla de PayMe al volver de la cámara nativa.
 *
 * Mati: «cuando se saca la foto (…) que en automático la foto que se sacó se achique hacia abajo a la izquierda y que
 * permita sacar otra foto apareciendo un check abajo a la derecha. (…) Una vez se selecciona el check se pasa a la
 * edición de la foto para el recuadro». Eligió «Pantalla al volver (Recomendada)»: la cámara sigue siendo la nativa
 * del teléfono (D212/D536), que no admite nada encima, así que esto es lo que aparece cuando la cámara se cierra.
 *
 * - La foto recién sacada aparece grande y se achica hacia la fila de miniaturas, abajo a la izquierda. Con «reducir
 *   movimiento» no hay animación: la miniatura ya está.
 * - «Sacar otra» vuelve a abrir la cámara nativa. Lo pasa la pantalla (`onSacarOtra`) y se llama directo en el
 *   `onClick`: iOS sólo abre la cámara dentro del toque (`camaraEnElToque.test.ts`).
 * - El ✓ de abajo a la derecha pasa al recuadro de las fotos, en el orden en que se sacaron.
 * - D486 · con el tope (`max`, el del dueño, contando las partes que ya había), «Sacar otra» se deshabilita y una línea
 *   lo explica.
 * - Tocar una miniatura la muestra grande, con «Quitar esta foto».
 * - «Volver» con fotos pregunta antes de salir: se pierden.
 *
 * Las fotos son las originales de la cámara, sólo en memoria y sólo para mirarlas acá (un object URL que la pantalla
 * suelta). Lo que se sube sigue saliendo del recuadro, recodificado y sin EXIF; nada se guarda en el teléfono.
 */
export interface FotoAlVolver {
  readonly id: number;
  readonly url: string;
}

export function FotosAlVolver({
  fotos,
  previas,
  max,
  recienLlegada,
  aviso,
  titulo,
  onSacarOtra,
  onListo,
  onQuitar,
  onSalir,
}: {
  /** Las fotos de esta tanda, en el orden en que se sacaron. */
  fotos: readonly FotoAlVolver[];
  /** Las partes del ticket que ya estaban antes de esta tanda: numeran a partir de ahí y cuentan para el tope. */
  previas: number;
  /** El tope de fotos por ticket del dueño (D486: 4). */
  max: number;
  /** La foto que acaba de llegar de la cámara: es la que se achica. */
  recienLlegada: number | null;
  /** Una foto de la tanda no se pudo usar en el recuadro (su número): se avisa acá. */
  aviso: number | null;
  /** El título de la pantalla de escaneo («Escanea el ticket» o el del viaje). */
  titulo: string;
  onSacarOtra: () => void;
  onListo: () => void;
  onQuitar: (id: number) => void;
  onSalir: () => void;
}) {
  const { t } = useIdioma();
  const total = previas + fotos.length;
  const lleno = total >= max;
  const [vista, setVista] = useState<number | null>(null);
  const [confirmandoSalida, setConfirmandoSalida] = useState(false);
  const tituloRef = useRef<HTMLHeadingElement | null>(null);
  const cerrarVistaRef = useRef<HTMLButtonElement | null>(null);
  const seguirRef = useRef<HTMLButtonElement | null>(null);

  // Al aparecer la pantalla el foco va al título: la cámara se cerró y quien usa lector sabe dónde está.
  useEffect(() => {
    tituloRef.current?.focus();
  }, []);

  const [animando, setAnimando] = useState<number | null>(null);
  const animadas = useRef(new Set<number>());
  useEffect(() => {
    if (recienLlegada === null || animadas.current.has(recienLlegada)) return undefined;
    animadas.current.add(recienLlegada);
    if (reducirMovimiento()) return undefined;
    setAnimando(recienLlegada);
    // Por las dudas, si `animationend` no llega (pestaña en segundo plano), la foto grande igual se va.
    const corte = setTimeout(() => setAnimando((a) => (a === recienLlegada ? null : a)), 1200);
    return () => clearTimeout(corte);
  }, [recienLlegada]);
  const fotoAnimada = animando === null ? undefined : fotos.find((f) => f.id === animando);

  const indiceEnVista = vista === null ? -1 : fotos.findIndex((f) => f.id === vista);
  const fotoEnVista = indiceEnVista < 0 ? undefined : fotos[indiceEnVista];
  useEffect(() => {
    if (fotoEnVista) cerrarVistaRef.current?.focus();
  }, [fotoEnVista]);
  useEffect(() => {
    if (confirmandoSalida) seguirRef.current?.focus();
  }, [confirmandoSalida]);
  useEffect(() => {
    if (!fotoEnVista && !confirmandoSalida) return undefined;
    const alTeclado = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setVista(null);
      setConfirmandoSalida(false);
    };
    document.addEventListener('keydown', alTeclado);
    return () => document.removeEventListener('keydown', alTeclado);
  }, [fotoEnVista, confirmandoSalida]);

  return (
    <div className="screen camara fotos-al-volver">
      <div className="camara-arriba">
        <button
          type="button"
          className="camara-volver"
          onClick={() => (fotos.length > 0 ? setConfirmandoSalida(true) : onSalir())}
        >
          <Icon name="arrow-left" size={20} />
          {t('Volver')}
        </button>
        <h1 className="camara-titulo" ref={tituloRef} tabIndex={-1}>{titulo}</h1>
        <div className="camara-sub" aria-live="polite" aria-atomic="true">
          {total === 1 ? t('Sacaste 1 foto.') : t('Sacaste {0} fotos.', total)}
          {' '}
          {lleno ? t('Toca ✓ para ajustar el recuadro.') : t('Si el ticket es largo, saca otra parte. Si no, toca ✓.')}
        </div>
      </div>

      <div className="fotos-al-volver-centro">
        <button
          type="button"
          className="fotos-al-volver-otra"
          onClick={onSacarOtra}
          disabled={lleno}
        >
          <Icon name="camera" size={28} />
          <span>{t('Sacar otra')}</span>
        </button>
        {lleno && (
          <p className="fotos-al-volver-tope">{t('Ya tienes {0} fotos, el máximo por ticket.', max)}</p>
        )}
        {aviso !== null && (
          <p className="fotos-al-volver-aviso" role="alert">
            <Icon name="warning" size={18} />
            <span>{t('No pudimos usar la foto {0}. Quítala y saca otra.', aviso)}</span>
          </p>
        )}
      </div>

      <div className="fotos-al-volver-abajo">
        <ol className="fotos-al-volver-fila" aria-label={t('Fotos del ticket')}>
          {fotos.map((f, i) => (
            <li key={f.id}>
              <button
                type="button"
                className="fotos-al-volver-mini"
                aria-label={t('Ver la foto {0}', previas + i + 1)}
                onClick={() => setVista(f.id)}
              >
                <img src={f.url} alt="" draggable={false} onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                <span className="fotos-al-volver-numero" aria-hidden="true">{previas + i + 1}</span>
              </button>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="fotos-al-volver-listo"
          onClick={onListo}
          disabled={fotos.length === 0}
          aria-label={t('Listo, ajustar el recuadro')}
        >
          <Icon name="check" size={30} />
        </button>
      </div>

      {fotoAnimada && (
        <img
          className="fotos-al-volver-recien"
          src={fotoAnimada.url}
          alt=""
          aria-hidden="true"
          draggable={false}
          onAnimationEnd={() => setAnimando(null)}
        />
      )}

      {fotoEnVista && (
        <div className="fotos-al-volver-capa" role="dialog" aria-modal="true" aria-label={t('Foto {0}', previas + indiceEnVista + 1)}>
          <img className="fotos-al-volver-grande" src={fotoEnVista.url} alt="" draggable={false} />
          <div className="fotos-al-volver-capa-acciones">
            <button
              type="button"
              className="camara-galeria"
              onClick={() => {
                setVista(null);
                onQuitar(fotoEnVista.id);
              }}
            >
              <Icon name="trash" size={20} />
              <span>{t('Quitar esta foto')}</span>
            </button>
            <button type="button" className="camara-usar" ref={cerrarVistaRef} onClick={() => setVista(null)}>
              {t('Cerrar')}
            </button>
          </div>
        </div>
      )}

      {confirmandoSalida && (
        <div
          className="fotos-al-volver-capa fotos-al-volver-capa--pregunta"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="fotos-al-volver-salir-titulo"
          aria-describedby="fotos-al-volver-salir-texto"
        >
          <div className="fotos-al-volver-pregunta">
            <h2 id="fotos-al-volver-salir-titulo">{t('¿Salir sin leer el ticket?')}</h2>
            <p id="fotos-al-volver-salir-texto">
              {fotos.length === 1 ? t('Se pierde la foto que sacaste.') : t('Se pierden las {0} fotos que sacaste.', fotos.length)}
            </p>
            <button type="button" className="btn btn-navy" ref={seguirRef} onClick={() => setConfirmandoSalida(false)}>
              {t('Seguir sacando')}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => { setConfirmandoSalida(false); onSalir(); }}>
              {t('Salir y perder las fotos')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function reducirMovimiento(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}
