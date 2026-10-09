import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { useCapacidadLinkDeInvitacion, type LinkDeInvitacion } from '../api/linkDeInvitacion';
import { Icon } from '../components/Icon';
import { useToast } from '../components/ui';
import { useHojaModal } from '../components/useHojaModal';
import { useIdioma } from '../i18n/idioma';
import { writeClipboardText } from '../utils/clipboard';
import './invitarConLink.css';

/**
 * AF-LINK-DE-INVITACION · D252 · en Amigos, la tarjeta para invitar a alguien
 * que no tiene PayMe: «Compartir mi link» (la hoja de compartir del teléfono o,
 * si no hay, copiar) y, discreto, «Cambiar mi link», con confirmación. Nada de
 * puntos ni premios: D252 los deja para cuando haya pagos.
 *
 * Sin la capacidad, no hay tarjeta.
 */
export type CargaDelLink =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'error' }
  | { readonly tipo: 'listo'; readonly link: LinkDeInvitacion };

/** El mensaje que acompaña al link al compartirlo o copiarlo. */
export function mensajeDeInvitacion(link: LinkDeInvitacion, t: (s: string, ...a: unknown[]) => string): string {
  return `${t('Te invito a PayMe para dividir la cuenta en el restaurante. Regístrate con mi link:')} ${link.url}`;
}

/** El link sin el esquema, para mostrarlo («app.paymemx.com/invitacion/…»). */
export function linkVisible(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

export function TarjetaInvitarConLink() {
  const { t } = useIdioma();
  const toast = useToast();
  const capacidad = useCapacidadLinkDeInvitacion();
  const [carga, setCarga] = useState<CargaDelLink>({ tipo: 'cargando' });
  const [hoja, setHoja] = useState(false);
  const [cambiando, setCambiando] = useState(false);
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    return () => { vivo.current = false; };
  }, []);

  const cargar = useCallback(() => {
    setCarga({ tipo: 'cargando' });
    api.getLinkDeInvitacion()
      .then((link) => { if (vivo.current) setCarga({ tipo: 'listo', link }); })
      .catch(() => { if (vivo.current) setCarga({ tipo: 'error' }); });
  }, []);

  useEffect(() => {
    if (capacidad === 'encendida') cargar();
  }, [capacidad, cargar]);

  if (capacidad !== 'encendida') return null;

  async function compartir(link: LinkDeInvitacion) {
    const texto = t('Te invito a PayMe para dividir la cuenta en el restaurante. Regístrate con mi link:');
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'PayMe', text: texto, url: link.url });
        return;
      } catch (err) {
        // La persona cerró la hoja: no se copia nada a sus espaldas.
        if (err instanceof Error && err.name === 'AbortError') return;
      }
    }
    const copiado = await writeClipboardText(mensajeDeInvitacion(link, t));
    toast(copiado ? t('Copiamos tu link.') : t('No se pudo copiar: tu navegador no habilitó el portapapeles'));
  }

  async function confirmarCambio() {
    if (cambiando) return;
    setCambiando(true);
    try {
      const link = await api.cambiarLinkDeInvitacion();
      if (!vivo.current) return;
      setCarga({ tipo: 'listo', link });
      setHoja(false);
      toast(t('Listo: tu link es nuevo. El anterior ya no funciona.'));
    } catch {
      if (vivo.current) toast(t('No pudimos cambiar tu link. Prueba de nuevo.'));
    } finally {
      if (vivo.current) setCambiando(false);
    }
  }

  return (
    <>
      <TarjetaInvitarVista
        carga={carga}
        onCompartir={(link) => void compartir(link)}
        onCambiar={() => setHoja(true)}
        onReintentar={cargar}
      />
      {hoja && (
        <HojaCambiarLink enviando={cambiando} onConfirmar={() => void confirmarCambio()} onCancelar={() => setHoja(false)} />
      )}
    </>
  );
}

export function TarjetaInvitarVista({ carga, onCompartir, onCambiar, onReintentar }: {
  carga: CargaDelLink;
  onCompartir: (link: LinkDeInvitacion) => void;
  onCambiar: () => void;
  onReintentar: () => void;
}) {
  const { t } = useIdioma();
  return (
    <section className="card card-p invitar-link" aria-labelledby="invitar-link-titulo">
      <div className="invitar-link-cabeza">
        <span className="invitar-link-icono" aria-hidden="true">
          <Icon name="link" size={20} />
        </span>
        <div>
          <h2 id="invitar-link-titulo" className="invitar-link-titulo">{t('Invita a alguien a PayMe')}</h2>
          <p className="invitar-link-texto">{t('Comparte tu link. Quien se registre con él queda como tu amigo.')}</p>
        </div>
      </div>
      {carga.tipo === 'listo' && (
        <>
          <p className="invitar-link-url">{linkVisible(carga.link.url)}</p>
          <button type="button" className="btn btn-navy" onClick={() => onCompartir(carga.link)}>
            <Icon name="share" size={18} className="ico-inline" /> {t('Compartir mi link')}
          </button>
          <button type="button" className="invitar-link-cambiar" onClick={onCambiar}>
            {t('Cambiar mi link')}
          </button>
        </>
      )}
      {carga.tipo === 'cargando' && <span className="sk-line w70" aria-hidden="true" />}
      {carga.tipo === 'error' && (
        <div className="invitar-link-error">
          <span>{t('No pudimos cargar tu link.')}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onReintentar}>{t('Reintentar')}</button>
        </div>
      )}
    </section>
  );
}

/** «¿Cambiar tu link?»: el foco entra en «Cancelar», la que no cambia nada. */
export function HojaCambiarLink({ enviando, onConfirmar, onCancelar }: {
  enviando: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  const { t } = useIdioma();
  const hoja = useRef<HTMLDivElement | null>(null);
  const cancelar = useRef<HTMLButtonElement | null>(null);
  useHojaModal(hoja, cancelar, onCancelar);
  return createPortal(
    <div className="sheet-overlay" onClick={onCancelar}>
      <div ref={hoja} className="sheet" role="dialog" aria-modal="true" aria-label={t('¿Cambiar tu link?')}
        onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <span className="sheet-title">{t('¿Cambiar tu link?')}</span>
          <button type="button" className="sheet-close" aria-label={t('Cerrar')} onClick={onCancelar}>✕</button>
        </div>
        <p className="invitar-link-hoja-texto">
          {t('Tu link actual deja de funcionar. Quien ya se registró con él sigue siendo tu amigo.')}
        </p>
        <div className="invitar-link-hoja-acciones">
          <button type="button" className="btn btn-navy" disabled={enviando} onClick={onConfirmar}>{t('Cambiar mi link')}</button>
          <button ref={cancelar} type="button" className="btn btn-ghost" disabled={enviando} onClick={onCancelar}>{t('Cancelar')}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
