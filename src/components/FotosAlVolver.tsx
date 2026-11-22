import { useEffect, useRef, useState } from 'react';
import { useIdioma } from '../i18n/idioma';
import { contenerTab } from './useHojaModal';
import { Icon } from './Icon';

/** D935 · Copias recodificadas en memoria. El original sólo se usa al ajustar el recuadro. */
export interface FotoAlVolver {
  readonly id: number;
  /** La de la fila, chica (`LADO_MINIATURA_DE_PARTE`). */
  readonly miniatura: string | null;
  /** La de la foto grande (`LADO_VISTA_DE_LA_TANDA`). */
  readonly vista: string | null;
}

export function FotosAlVolver({
  fotos,
  previas,
  max,
  aviso,
  topeAlcanzado = false,
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
  /** Una foto de la tanda no se pudo usar en el recuadro (su número): se avisa acá. */
  aviso: number | null;
  topeAlcanzado?: boolean;
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

  const capaRef = useRef<HTMLDivElement>(null);
  const volverRef = useRef<HTMLButtonElement>(null);
  const listoRef = useRef<HTMLButtonElement>(null);
  const miniaturas = useRef(new Map<number, HTMLButtonElement>());

  function seguirSacando(): void {
    setConfirmandoSalida(false);
    volverRef.current?.focus();
  }

  // Al aparecer la pantalla el foco va al título: la cámara se cerró y quien usa lector sabe dónde está.
  useEffect(() => {
    tituloRef.current?.focus();
  }, []);

  const ultima = fotos[fotos.length - 1];
  const imagen = ultima?.vista ?? ultima?.miniatura;

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
      if (e.key === 'Escape') {
        if (fotoEnVista) {
          setVista(null);
          miniaturas.current.get(fotoEnVista.id)?.focus();
        } else seguirSacando();
      } else if (capaRef.current) contenerTab(e, capaRef.current);
    };
    document.addEventListener('keydown', alTeclado);
    return () => document.removeEventListener('keydown', alTeclado);
  }, [fotoEnVista, confirmandoSalida]);

  return (
    <div className="screen camara fotos-al-volver">
      <div className="camara-arriba">
        <button
          type="button"
          ref={volverRef}
          className="camara-volver"
          onClick={() => (fotos.length > 0 ? setConfirmandoSalida(true) : onSalir())}
        >
          <Icon name="arrow-left" size={20} />
          {t('Volver')}
        </button>
        <h1 className="camara-titulo" ref={tituloRef} tabIndex={-1}>{titulo}</h1>
        <div className="visor-ticket-oculto" aria-live="polite" aria-atomic="true">
          {total === 1 ? t('Sacaste 1 foto.') : t('Sacaste {0} fotos.', total)}
        </div>
      </div>

      <div className="fotos-al-volver-centro">
        {imagen
          ? <img className="fotos-al-volver-principal" src={imagen} alt={t('Foto {0}', total)} draggable={false} />
          : <Icon name="receipt" size={48} />}
        {lleno && !topeAlcanzado && (
          <p className="fotos-al-volver-tope">{t('Ya tienes {0} fotos, el máximo por ticket.', max)}</p>
        )}
        {topeAlcanzado && (
          <p className="fotos-al-volver-aviso" role="alert">{t('Ya tienes {0} fotos; esa no se agregó.', max)}</p>
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
                ref={(boton) => {
                  if (boton) miniaturas.current.set(f.id, boton);
                  else miniaturas.current.delete(f.id);
                }}
                className="fotos-al-volver-mini"
                aria-label={t('Ver la foto {0}', previas + i + 1)}
                onClick={() => setVista(f.id)}
              >
                {f.miniatura
                  ? <img src={f.miniatura} alt="" draggable={false} onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                  : <span className="fotos-al-volver-sin-mini" aria-hidden="true"><Icon name="receipt" size={20} /></span>}
                <span className="fotos-al-volver-numero" aria-hidden="true">{previas + i + 1}</span>
              </button>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="fotos-al-volver-otra"
          onClick={onSacarOtra}
          disabled={lleno}
          aria-label={t('Sacar otra foto')}
        >
          <Icon name="plus" size={30} />
        </button>
        <button
          type="button"
          ref={listoRef}
          className="fotos-al-volver-listo"
          onClick={onListo}
          disabled={fotos.length === 0}
          aria-label={t('Listo, ajustar el recuadro')}
        >
          <Icon name="check" size={30} />
        </button>
      </div>

      {fotoEnVista && (
        <div ref={capaRef} className="fotos-al-volver-capa" role="dialog" aria-modal="true" aria-label={t('Foto {0}', previas + indiceEnVista + 1)}>
          {fotoEnVista.vista ?? fotoEnVista.miniatura
            ? <img className="fotos-al-volver-grande" src={(fotoEnVista.vista ?? fotoEnVista.miniatura)!} alt="" draggable={false} />
            : <Icon name="receipt" size={48} />}
          <div className="fotos-al-volver-capa-acciones">
            <button
              type="button"
              className="camara-galeria"
              onClick={() => {
                setVista(null);
                const siguiente = fotos[indiceEnVista + 1];
                (siguiente ? miniaturas.current.get(siguiente.id) : listoRef.current)?.focus();
                onQuitar(fotoEnVista.id);
              }}
            >
              <Icon name="trash" size={20} />
              <span>{t('Quitar esta foto')}</span>
            </button>
            <button type="button" className="camara-usar" ref={cerrarVistaRef} onClick={() => {
              setVista(null);
              miniaturas.current.get(fotoEnVista.id)?.focus();
            }}>
              {t('Cerrar')}
            </button>
          </div>
        </div>
      )}

      {confirmandoSalida && (
        <div
          ref={capaRef}
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
            <button type="button" className="btn btn-navy" ref={seguirRef} onClick={seguirSacando}>
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
