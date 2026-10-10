import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useCapacidadLinkDeInvitacion, type LinkDeInvitacion } from '../api/linkDeInvitacion';
import { Icon } from '../components/Icon';
import { useToast } from '../components/ui';
import { useIdioma } from '../i18n/idioma';
import { writeClipboardText } from '../utils/clipboard';
import './invitarConLink.css';

/**
 * AF-LINK-DE-INVITACION · D252 · en Amigos, invitar a alguien que no tiene
 * PayMe con el link propio. Nada de puntos ni premios: D252 los deja para
 * cuando haya pagos.
 *
 * D255-4 · Mati (0.233.0): «dejar solo una burbuja de "Invita a alguien a
 * Payme" con el símbolo y que sea cliqueable, que al cliquearla se copie el
 * link directamente, quita todo el resto del texto». Una sola burbuja con su
 * ícono; tocarla copia el link y avisa «Link copiado». Se van el texto, el link
 * a la vista, «Compartir mi link» y «Cambiar mi link» (la fachada de cambiar
 * queda, sin pantalla).
 *
 * El link se pide al entrar, así el toque copia en el acto: Safari sólo deja
 * escribir el portapapeles durante el toque, no después de esperar la red.
 *
 * Sin la capacidad, no hay burbuja.
 */
export type CargaDelLink =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'error' }
  | { readonly tipo: 'listo'; readonly link: LinkDeInvitacion };

export function TarjetaInvitarConLink() {
  const { t } = useIdioma();
  const toast = useToast();
  const capacidad = useCapacidadLinkDeInvitacion();
  const [carga, setCarga] = useState<CargaDelLink>({ tipo: 'cargando' });
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

  async function tocar() {
    if (carga.tipo === 'cargando') return;
    if (carga.tipo === 'error') {
      toast(t('No pudimos cargar tu link. Prueba de nuevo.'));
      cargar();
      return;
    }
    const copiado = await writeClipboardText(carga.link.url);
    toast(copiado ? t('Link copiado') : t('No se pudo copiar: tu navegador no habilitó el portapapeles'));
  }

  return <BurbujaInvitar carga={carga} onTocar={() => void tocar()} />;
}

export function BurbujaInvitar({ carga, onTocar }: { carga: CargaDelLink; onTocar: () => void }) {
  const { t } = useIdioma();
  return (
    <button
      type="button"
      className="card invitar-link"
      aria-busy={carga.tipo === 'cargando' || undefined}
      onClick={onTocar}
    >
      <span className="invitar-link-icono" aria-hidden="true">
        <Icon name="link" size={20} />
      </span>
      <span className="invitar-link-titulo">{t('Invita a alguien a PayMe')}</span>
      <Icon name="copy" size={20} className="invitar-link-copiar" />
    </button>
  );
}
