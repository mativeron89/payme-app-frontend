import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../components/Icon';
import { useIdioma } from '../i18n/idioma';
import { useRegion } from './RegionProvider';
import { REGION_COUNTRIES, zoneLabel, type CountryCode } from './regionCatalog';
import { DEFAULT_REGION, parseRegion, type RegionState } from './regionPreference';
import { personalZoneCaption } from '../utils/personalDates';
import './regionSettingsPanel.css';

export interface RegionDraft { readonly country: CountryCode; readonly timeZone: string }

/** Reseleccionar el mismo país no destruye la ciudad elegida. Un país NUEVO
 * multizona exige elegir explícitamente; nunca toma el primer IANA del grupo. */
export function draftForCountry(current: RegionDraft, code: CountryCode): RegionDraft {
  const country = REGION_COUNTRIES.find((c) => c.code === code)!;
  return current.country === code ? current
    : { country: code, timeZone: country.zones.length === 1 ? country.zones[0]! : '' };
}

type Translate = (text: string, ...args: unknown[]) => string;
export function regionNoticeText(region: RegionState, t: Translate): string {
  switch (region.notice) {
    case 'corrupt': return t('La preferencia guardada no es válida. Usamos la configuración inicial sin borrar el dato anterior.');
    case 'unsupported': return t('La zona guardada o inicial no es compatible con este navegador. Se aplica el fallback indicado.');
    case 'storage-unavailable': return t('No pudimos leer la preferencia local. Puedes elegir una zona temporal sin bloquear el ingreso.');
    case 'not-saved': return t('La selección se aplica temporalmente, pero no se pudo confirmar el guardado. Al recargar puede perderse o volver el valor anterior.');
    case 'not-reset': return t('Restablecimos esta vista, pero no pudimos confirmar el borrado de la preferencia. Al recargar puede volver el valor anterior.');
    default: return region.persistence === 'saved' ? t('Guardado sólo en este navegador.')
      : t('México y Ciudad de México son la configuración inicial.');
  }
}

/** La fila vive en Configuración REAL; el modal es nativo, no UIlib/demo.
 * Nada se guarda al abrir, elegir, volver, Escape, cerrar o tocar el velo. */
export function RegionSettingsPanel() {
  const { t } = useIdioma();
  const region = useRegion();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!confirmation) return;
    const timer = window.setTimeout(() => setConfirmation(0), 1600);
    return () => window.clearTimeout(timer);
  }, [confirmation]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  return <>
    <button ref={trigger} type="button" className="list-row region-settings-trigger"
      aria-haspopup="dialog" aria-expanded={open} onClick={() => { setConfirmation(0); setOpen(true); }}>
      <Icon name="pin" size={18} />
      <span className="region-settings-trigger-label">{t('Ubicación')}</span>
      <Icon name="arrow-right" size={16} />
    </button>
    {/* Las advertencias sobreviven al cierre: el fallo no se oculta detrás
        de una confirmación de éxito ni obliga a reabrir el panel. */}
    {region.notice !== null && <p className="region-settings-warning" role="status" aria-live="polite">
      {regionNoticeText(region, t)}
    </p>}
    {open && <RegionSheet onClose={close} onApplied={(result) => {
      close();
      if (result.persistence === 'saved' && result.notice === null) setConfirmation((n) => n + 1);
    }} />}
    {confirmation > 0 && <div className="region-settings-confirmation" role="status" aria-live="polite"
      aria-label={t('Guardado sólo en este navegador.')}>
      <Icon name="check" size={32} />
      <span className="region-settings-sr-only">{t('Guardado sólo en este navegador.')}</span>
    </div>}
  </>;
}

function RegionSheet({ onClose, onApplied }: {
  onClose: () => void; onApplied: (result: RegionState) => void;
}) {
  const { t, idioma } = useIdioma();
  const region = useRegion();
  const [draft, setDraft] = useState<RegionDraft>(() => ({ ...region.preference }));
  const [view, setView] = useState<'main' | 'country' | 'zone'>('main');
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const countryButton = useRef<HTMLButtonElement>(null);
  const id = useId();
  const country = REGION_COUNTRIES.find((c) => c.code === draft.country)!;
  // Literales traducibles, no claves de cuenta/backend ni dependencia nueva.
  const names: Record<CountryCode, string> = {
    MX: t('México'), CO: t('Colombia'), PE: t('Perú'), AR: t('Argentina'),
    CL: t('Chile'), ES: t('España'), US: t('Estados Unidos'),
  };
  const candidate = parseRegion(draft);
  const canApply = candidate !== null && region.supportedZones.has(draft.timeZone);
  const caption = region.presentationZone === null || region.presentationZone === 'UTC'
    ? personalZoneCaption(region.presentationZone, t)
    : t('Fechas mostradas en {0}; no indican la zona original.', zoneLabel(region.presentationZone, idioma));
  const dismiss = () => { dialog.current?.close(); onClose(); };
  useEffect(() => {
    const modal = dialog.current!;
    const overflow = document.body.style.overflow;
    modal.showModal(); // Navegador: top layer/foco modal/inert del fondo.
    document.body.style.overflow = 'hidden';
    return () => { modal.close(); document.body.style.overflow = overflow; };
  }, []);
  useEffect(() => {
    if (content.current) content.current.scrollTop = 0;
    (view === 'main' ? countryButton.current : back.current)?.focus();
  }, [view]);
  const selectCountry = (code: CountryCode) => {
    const next = draftForCountry(draft, code);
    setDraft(next);
    setView(next.timeZone ? 'main' : 'zone');
  };
  return createPortal(<dialog ref={dialog} className="region-settings-dialog" aria-modal="true"
    aria-labelledby={id + '-title'} aria-describedby={id + '-description'}
    onCancel={(event) => { event.preventDefault(); dismiss(); }}
    onClick={(event) => { if (event.target === event.currentTarget) dismiss(); }}>
    <section className="region-settings-sheet">
      <header className="region-settings-header">
        <span className="region-settings-handle" aria-hidden="true" />
        <div className="region-settings-heading">
          <div>
            <h2 id={id + '-title'}>{t('Ubicación')}</h2>
            <p id={id + '-description'}>{t('Cambia sólo cómo ves fechas y horas.')}</p>
          </div>
          <button type="button" className="region-settings-close" aria-label={t('Cerrar Ubicación')} onClick={dismiss}>
            <span aria-hidden="true">×</span>
          </button>
        </div>
      </header>
      <div ref={content} className="region-settings-content">
        {view === 'main' ? <div className="region-settings-fields">
          <button ref={countryButton} type="button" className="region-settings-field" onClick={() => setView('country')}>
            <span>{t('País')}</span><span className="region-settings-value">{names[draft.country]}</span>
            <Icon name="arrow-right" size={18} />
          </button>
          <button type="button" className="region-settings-field" onClick={() => setView('zone')}>
            <span>{t('Huso horario')}</span>
            <span className="region-settings-value">{draft.timeZone ? zoneLabel(draft.timeZone, idioma) : t('Elige una ciudad / zona horaria')}</span>
            <Icon name="arrow-right" size={18} />
          </button>
        </div> : <>
          <button ref={back} type="button" className="region-settings-back" onClick={() => setView('main')}
            aria-label={t('Volver a Ubicación')}>
            <span aria-hidden="true">‹</span>
            {view === 'country' ? t('País') : t('Huso horario · {0}', names[draft.country])}
          </button>
          <div className="region-settings-options" role="group" aria-label={view === 'country' ? t('País') : t('Huso horario')}>
            {view === 'country' ? REGION_COUNTRIES.map((c) => <button type="button" key={c.code}
              className="region-settings-option" aria-pressed={draft.country === c.code}
              onClick={() => selectCountry(c.code)}>
              <span>{names[c.code]}</span>{draft.country === c.code && <Icon name="check" size={18} />}
            </button>) : country.zones.map((zone) => {
              const supported = region.supportedZones.has(zone);
              return <button type="button" key={zone} className="region-settings-option"
                disabled={!supported} aria-pressed={draft.timeZone === zone} data-region-zone={zone}
                onClick={() => { setDraft({ country: draft.country, timeZone: zone }); setView('main'); }}>
                <span>{zoneLabel(zone, idioma)}{!supported && <small>{t('No compatible con este navegador')}</small>}</span>
                {draft.timeZone === zone && <Icon name="check" size={18} />}
              </button>;
            })}
          </div>
        </>}
        {country.zones.length > 1 && !draft.timeZone && <p className="region-settings-help" role="status">
          {t('Este país tiene varias zonas: elige una antes de aplicar.')}
        </p>}
        <p className="region-settings-help" role="status" aria-live="polite" aria-atomic="true">{regionNoticeText(region, t)}</p>
        <p className="region-settings-help">{caption}</p>
        <details className="region-settings-local-help">
          <summary>{t('Sólo en este navegador')}</summary>
          <p>{t('Sólo en este navegador: no se sincroniza entre dispositivos ni cuentas. Si compartes el navegador, otra persona heredará esta selección.')}</p>
          <p>{t('El modo privado o borrar los datos locales puede perder la selección. No detectamos tu ubicación ni cambiamos moneda, idioma o disponibilidad comercial.')}</p>
          <p>{t('Primera entrega: 7 países y 62 zonas del catálogo. Los demás países no están disponibles; las zonas que tu navegador no admite aparecen deshabilitadas.')}</p>
        </details>
      </div>
      <footer className="region-settings-footer">
        <button type="button" className="region-settings-apply" disabled={!canApply} onClick={() => {
          if (candidate && canApply) {
            const result = region.apply(candidate);
            dialog.current?.close();
            onApplied(result);
          }
        }}>{t('Aplicar')}</button>
        <button type="button" className="region-settings-reset" onClick={() => {
          region.reset(); setDraft({ ...DEFAULT_REGION }); setView('main');
        }}>{t('Restablecer país y zona')}</button>
      </footer>
    </section>
  </dialog>, document.body);
}
