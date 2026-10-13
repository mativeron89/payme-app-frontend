import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../components/Icon';
import { CuadroDeTarjeta } from '../components/TarjetaDeTitulo';
import { useIdioma } from '../i18n/idioma';
import { useIconSize } from './IconSizeProvider';
import { ICON_SIZES, type IconSize } from './iconPreference';
import './iconSettingsPanel.css';

export function IconSettingsPanel() {
  const { t } = useIdioma();
  const preference = useIconSize();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const labels = { grandes: t('Grandes'), medianos: t('Medianos'), chicos: t('Chicos') };
  const close = () => { setOpen(false); trigger.current?.focus(); };
  return <>
    <button type="button" ref={trigger} className="list-row icon-settings-trigger"
      aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      <Icon name="grid-dots" size={18} scale="config" />
      <span className="icon-settings-label">{t('Íconos')}</span>
      <span className="icon-settings-value">{labels[preference.size]}</span>
      <Icon name="arrow-right" size={16} />
    </button>
    {preference.notice && <p className="icon-settings-notice" role="status">
      {preference.notice === 'corrupt' ? t('El tamaño guardado no es válido. Usamos Medianos sin borrar la preferencia anterior.')
        : preference.notice === 'not-saved' ? t('El tamaño se aplica temporalmente. No pudimos guardarlo; al recargar puede volver el anterior.')
          : t('No pudimos leer la preferencia local. Puedes elegir un tamaño temporal.')}
    </p>}
    {open && <IconSheet applied={preference.size} onClose={close} onApply={(size) => { preference.apply(size); close(); }} />}
  </>;
}

function IconSheet({ applied, onClose, onApply }: { applied: IconSize; onClose: () => void; onApply: (size: IconSize) => void }) {
  const { t } = useIdioma();
  const [draft, setDraft] = useState(applied);
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const labels = { grandes: t('Grandes'), medianos: t('Medianos'), chicos: t('Chicos') };
  const subtitles = { grandes: t('Más fáciles de ver'), medianos: t('Como hoy'), chicos: t('Más lugar para el contenido') };
  const dismiss = () => { dialog.current?.close(); onClose(); };
  useEffect(() => {
    const modal = dialog.current!;
    const overflow = document.body.style.overflow;
    modal.showModal();
    document.body.style.overflow = 'hidden';
    modal.querySelector<HTMLInputElement>('input:checked')?.focus();
    return () => { modal.close(); document.body.style.overflow = overflow; };
  }, []);
  return createPortal(<dialog ref={dialog} className="icon-settings-dialog" aria-modal="true"
    aria-labelledby={id + '-title'} aria-describedby={id + '-description'}
    onCancel={(event) => { event.preventDefault(); dismiss(); }}
    onClick={(event) => { if (event.target === event.currentTarget) dismiss(); }}>
    <section className="icon-settings-sheet">
      <header className="icon-settings-header">
        <span className="icon-settings-handle" aria-hidden="true" />
        <div className="icon-settings-heading">
          <div><h2 id={id + '-title'}>{t('Íconos')}</h2>
            <p id={id + '-description'}>{t('El texto y las áreas de toque quedan iguales.')}</p></div>
          <button type="button" className="icon-settings-close" aria-label={t('Cerrar íconos')} onClick={dismiss}>×</button>
        </div>
      </header>
      <div className="icon-settings-content">
        <div className="icon-preview" data-iconos={draft} aria-label={t('Vista previa de íconos')}>
          <div className="icon-preview-title"><CuadroDeTarjeta icono="engranaje" /><strong>{t('Configuración')}</strong></div>
          <div className="icon-preview-row"><span className="icon-preview-list-box icon-list-box"><Icon name="receipt" scale="list" /></span><span>{t('Ver pagos')}</span><Icon name="chevron-right" size={18} /></div>
          <div className="icon-preview-footer" aria-hidden="true">
            <Icon name="home" size={24} scale="footer" /><Icon name="receipt" size={24} scale="footer" />
            <span className="icon-preview-camera"><Icon name="camera" size={24} scale="footer" /></span>
            <Icon name="users" size={24} scale="footer" /><Icon name="grid-dots" size={24} scale="footer" />
          </div>
        </div>
        <fieldset className="icon-settings-options"><legend>{t('Tamaño de íconos')}</legend>
          {ICON_SIZES.map((size) => <label key={size} className="icon-settings-option" data-selected={draft === size}>
            <input type="radio" name={id + '-size'} value={size} checked={draft === size} onChange={() => setDraft(size)} />
            <span><strong>{labels[size]}</strong><small>{subtitles[size]}</small></span>
          </label>)}
        </fieldset>
        <p className="icon-settings-help">{t('La elección se guarda sólo en este navegador al tocar Aplicar.')}</p>
      </div>
      <footer className="icon-settings-footer"><button type="button" className="icon-settings-apply" onClick={() => { dialog.current?.close(); onApply(draft); }}>{t('Aplicar')}</button></footer>
    </section>
  </dialog>, document.body);
}
