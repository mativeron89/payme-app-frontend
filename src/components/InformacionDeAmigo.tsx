import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Friend } from '../api/types';
import { useIdioma } from '../i18n/idioma';
import { ArrobaDebajo } from './ArrobaDebajo';
import { FilaDeslizable } from './FilaDeslizable';
import { Icon } from './Icon';
import { useHojaModal } from './useHojaModal';

type Persona = Pick<Friend, 'full_name' | 'username'>;

export function InformacionDeAmigo({ amigo, onCerrar, onBloquear, onTransferir }: {
  amigo: Persona; onCerrar: () => void; onBloquear?: () => void; onTransferir?: () => void;
}) {
  const { t } = useIdioma();
  const hoja = useRef<HTMLDivElement>(null);
  const cerrar = useRef<HTMLButtonElement>(null);
  useHojaModal(hoja, cerrar, onCerrar);
  return createPortal(<div className="sheet-overlay" onClick={onCerrar}>
    <div ref={hoja} className="sheet social-confirmacion" role="dialog" aria-modal="true"
      aria-label={t('Información de {0}', amigo.full_name)} onClick={e => e.stopPropagation()}>
      <strong>{amigo.full_name}</strong>
      <ArrobaDebajo username={amigo.username} />
      {onBloquear && <button type="button" className="btn btn-ghost" onClick={onBloquear}>{t('Bloquear')}</button>}
      {onTransferir && <button type="button" className="btn btn-ghost" onClick={onTransferir}
        aria-label={`Transferir a ${amigo.full_name}`}>
        <Icon name="arrow-up-right" size={16} />
      </button>}
      <button type="button" className="btn btn-navy" ref={cerrar} onClick={onCerrar}>{t('Cerrar')}</button>
    </div>
  </div>, document.body);
}

export function FilaConInformacion({ persona, children }: { persona: Persona; children: ReactNode }) {
  const [abierta, setAbierta] = useState(false);
  const [disparador, setDisparador] = useState<HTMLButtonElement | null>(null);

  function cerrarInformacion() {
    setDisparador(null);
    requestAnimationFrame(() => disparador?.focus({ preventScroll: true }));
  }

  return <>
    <FilaDeslizable className="persona-deslizable" nombre={persona.full_name} abierta={abierta}
      onAbrir={() => setAbierta(true)} onCerrar={() => setAbierta(false)} onInformacion={setDisparador}>
      {children}
    </FilaDeslizable>
    {disparador && <InformacionDeAmigo amigo={persona} onCerrar={cerrarInformacion} />}
  </>;
}
