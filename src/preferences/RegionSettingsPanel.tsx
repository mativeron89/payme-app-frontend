import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../components/Icon';
import { useIdioma } from '../i18n/idioma';
import { useRegion } from './RegionProvider';
import { REGION_COUNTRIES, zoneLabel, type CountryCode } from './regionCatalog';
import { parseRegion, type RegionPreference, type RegionState } from './regionPreference';
import { groupTimeZones, timeZoneDisplay, utcOffsetLabel, zoneForGroup } from './timezoneDisplay';
import { personalZoneCaption } from '../utils/personalDates';
import './regionSettingsPanel.css';

export type RegionDraft = RegionPreference;

/** El click de teclado/tecnología asistiva no tiene contador de puntero. */
export function regionOpeningInput(detail: number): 'keyboard' | 'pointer' {
  return detail === 0 ? 'keyboard' : 'pointer';
}

/** Chevrón local: no cambia las flechas de navegación del resto de la app. */
export function RegionRowChevron() {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
    data-region-chevron="">
    <path d="m9 5 7 7-7 7" />
  </svg>;
}

/** Reseleccionar el mismo país no destruye la ciudad elegida. Un país NUEVO
 * multizona exige elegir explícitamente; nunca toma el primer IANA del grupo. */
export function draftForCountry(current: RegionDraft, code: CountryCode): RegionDraft {
  const country = REGION_COUNTRIES.find((c) => c.code === code)!;
  if (current.mode === 'automatic') return current.country === code ? current : { ...current, country: code };
  return current.country === code ? current
    : { country: code, timeZone: country.zones.length === 1 ? country.zones[0]! : '' };
}

type Translate = (text: string, ...args: unknown[]) => string;
export function regionNoticeText(region: RegionState, t: Translate): string {
  switch (region.notice) {
    case 'corrupt': return t('La preferencia guardada no es válida. Usamos la configuración inicial sin borrar el dato anterior.');
    case 'unsupported': return t('La zona guardada o inicial no es compatible con este navegador. Se aplica el fallback indicado.');
    case 'device-unavailable': return t('Zona del dispositivo no disponible; usamos la última zona válida o Ciudad de México.');
    case 'storage-unavailable': return t('No pudimos leer la preferencia local. Puedes elegir una zona temporal sin bloquear el ingreso.');
    case 'not-saved': return t('La selección se aplica temporalmente, pero no se pudo confirmar el guardado. Al recargar puede perderse o volver el valor anterior.');
    case 'not-reset': return t('Restablecimos esta vista, pero no pudimos confirmar el borrado de la preferencia. Al recargar puede volver el valor anterior.');
    default: return region.persistence === 'saved' ? t('Guardado sólo en este navegador.')
      : t('México es el país inicial; el huso horario sigue la zona del dispositivo.');
  }
}

/** La fila vive en Configuración REAL; el modal es nativo, no UIlib/demo.
 * Nada se guarda al abrir, elegir, volver, Escape, cerrar o tocar el velo. */
export function RegionSettingsPanel() {
  const { t } = useIdioma();
  const region = useRegion();
  const [open, setOpen] = useState<false | 'keyboard' | 'pointer'>(false);
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
      aria-haspopup="dialog" aria-expanded={Boolean(open)} onClick={(event) => {
        region.refreshDevice(); setConfirmation(0); setOpen(regionOpeningInput(event.detail));
      }}>
      <Icon name="pin" size={18} />
      <span className="region-settings-trigger-label">{t('Ubicación')}</span>
      <Icon name="arrow-right" size={16} />
    </button>
    {/* Las advertencias sobreviven al cierre: el fallo no se oculta detrás
        de una confirmación de éxito ni obliga a reabrir el panel. */}
    {region.notice !== null && <p className="region-settings-warning" role="status" aria-live="polite">
      {regionNoticeText(region, t)}
    </p>}
    {open && <RegionSheet openingInput={open} onClose={close} onApplied={(result) => {
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

function RegionSheet({ openingInput, onClose, onApplied }: {
  openingInput: 'keyboard' | 'pointer'; onClose: () => void; onApplied: (result: RegionState) => void;
}) {
  const { t, idioma } = useIdioma();
  const region = useRegion();
  const zoneCaption = personalZoneCaption(region.presentationZone, t);
  const [draft, setDraft] = useState<RegionDraft>(() => ({ ...region.preference }));
  const [view, setView] = useState<'main' | 'country' | 'zone'>('main');
  const [input, setInput] = useState(openingInput);
  const [instant, setInstant] = useState(() => new Date());
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const countryButton = useRef<HTMLButtonElement>(null);
  const id = useId();
  const country = REGION_COUNTRIES.find((c) => c.code === draft.country)!;
  const { groups, unavailable } = useMemo(() => groupTimeZones(country.zones, instant,
    (zone) => region.supportedZones.has(zone)), [country, instant, region.supportedZones]);
  // Literales traducibles, no claves de cuenta/backend ni dependencia nueva.
  const names: Record<CountryCode, string> = {
    MX: t('México'), CO: t('Colombia'), PE: t('Perú'), AR: t('Argentina'),
    CL: t('Chile'), ES: t('España'), US: t('Estados Unidos'),
  };
  const candidate = parseRegion(draft);
  const automatic = draft.mode === 'automatic';
  const automaticZone = region.deviceZone ?? region.presentationZone;
  const automaticDisplay = automaticZone ? timeZoneDisplay(automaticZone, instant) : null;
  const effectiveZone = automatic ? automaticZone : draft.timeZone;
  const canApply = candidate !== null && (automatic || region.supportedZones.has(draft.timeZone));
  const draftDisplay = effectiveZone ? timeZoneDisplay(effectiveZone, instant) : null;
  const dismiss = () => { dialog.current?.close(); onClose(); };
  useEffect(() => {
    let timer: number | undefined;
    const refresh = () => {
      window.clearTimeout(timer);
      setInstant(new Date());
      timer = window.setTimeout(refresh, 60000 - Date.now() % 60000 + 10);
    };
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
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
    {/* showModal/focus pueden heredar :focus-visible de un campo anterior.
        La modalidad se limita a este panel; no se quita ni mueve el foco. */}
    <section className="region-settings-sheet" data-region-view={view} data-region-input={input}
      onPointerDownCapture={() => setInput('pointer')} onKeyDownCapture={() => setInput('keyboard')}>
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
            <RegionRowChevron />
          </button>
          <button type="button" className="region-settings-field" onClick={() => setView('zone')}>
            <span>{t('Huso horario')}</span>
            <span className="region-settings-value">{automatic ? <>
              <strong className="region-settings-auto-value">{t('Automático')}{draftDisplay && <> · {utcOffsetLabel(draftDisplay.offsetMinutes)}</>}</strong>
              <small className="region-settings-auto-zone">{effectiveZone ?? t('No compatible con este navegador')}</small>
            </> : draftDisplay ? utcOffsetLabel(draftDisplay.offsetMinutes)
              : draft.timeZone ? t('No compatible con este navegador') : t('Elige un huso horario')}</span>
            <RegionRowChevron />
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
            </button>) : <>
              <button type="button" className="region-settings-option" aria-pressed={automatic}
                onClick={() => setDraft({ ...draft, timeZone: draft.timeZone || region.preference.timeZone, mode: 'automatic' })}>
                <span>{t('Automático: zona del dispositivo')}<small>{automaticZone ?? t('No compatible con este navegador')}
                  {automaticDisplay && <> · {utcOffsetLabel(automaticDisplay.offsetMinutes)}</>}</small></span>
                {automatic && <Icon name="check" size={18} />}
              </button>
              <button type="button" className="region-settings-option" aria-pressed={!automatic}
                onClick={() => setDraft({ country: draft.country,
                  timeZone: country.zones.includes(draft.timeZone) ? draft.timeZone : country.zones.length === 1 ? country.zones[0]! : '' })}>
                <span>{t('Manual')}</span>{!automatic && <Icon name="check" size={18} />}
              </button>
              {groups.map((group) => {
                const cities = group.zones.map((zone) => zoneLabel(zone, idioma));
                const selected = !automatic && group.zones.includes(draft.timeZone);
                return <button type="button" key={group.offsetMinutes}
                  className="region-settings-option region-settings-zone-option"
                  aria-pressed={selected} data-region-offset={group.offsetMinutes}
                  data-region-zones={group.zones.join(' ')}
                  onClick={() => setDraft({ country: draft.country, timeZone: zoneForGroup(group, draft.timeZone) })}>
                  <span className="region-settings-zone-copy">
                    <strong>{utcOffsetLabel(group.offsetMinutes)}</strong>
                    <small title={cities.join(', ')}><span>{cities.slice(0, 3).join(', ')}</span>
                      {cities.length > 3 && <span>{t('y {0} más', cities.length - 3)}</span>}
                    </small>
                  </span>
                  <time dateTime={instant.toISOString()}>{group.time}</time>
                  <span className="region-settings-zone-check" aria-hidden="true">{selected && <Icon name="check" size={16} />}</span>
                </button>;
              })}
              {unavailable.map((zone) => <button type="button" key={zone}
                className="region-settings-option" disabled data-region-zones={zone} aria-pressed={false}>
                <span>{zoneLabel(zone, idioma)}<small>{t('No compatible con este navegador')}</small></span>
              </button>)}
            </>}
          </div>
        </>}
        {!automatic && country.zones.length > 1 && !draft.timeZone && <p className="region-settings-sr-only" role="status">
          {t('Este país tiene varias zonas: elige una antes de aplicar.')}
        </p>}
        {region.notice !== null && <p className="region-settings-help" role="status" aria-live="polite" aria-atomic="true">
          {regionNoticeText(region, t)}
          {/* E173-1 · decisión 173: sin «Fechas mostradas en …». Sólo queda el
              aviso de navegador degradado (zona UTC o ninguna), que antes
              también salía acá. */}
          {zoneCaption && <> {zoneCaption}</>}
        </p>}
      </div>
      <footer className="region-settings-footer">
        <button type="button" className="region-settings-apply" disabled={!canApply} onClick={() => {
          if (candidate && canApply) {
            const result = region.apply(candidate);
            dialog.current?.close();
            onApplied(result);
          }
        }}>{t('Aplicar')}</button>
      </footer>
    </section>
  </dialog>, document.body);
}

/** Gestión explícita fuera del selector: conserva el reset de nuestra única clave. */
export function RegionLocalManagement() {
  const { t } = useIdioma();
  const region = useRegion();
  // E173-1 · decisión 173: sin la leyenda «Fechas mostradas en …»; sólo los
  // avisos de navegador degradado.
  const caption = personalZoneCaption(region.presentationZone, t);
  return <details className="region-settings-local-help region-settings-management">
    <summary>{t('Sólo en este navegador')}</summary>
    <p>{regionNoticeText(region, t)}</p>
    {caption && <p>{caption}</p>}
    <p>{t('Sólo en este navegador: no se sincroniza entre dispositivos ni cuentas. Si compartes el navegador, otra persona heredará esta selección.')}</p>
    <p>{t('El modo privado o borrar los datos locales puede perder la selección. No detectamos tu ubicación ni cambiamos moneda, idioma o disponibilidad comercial.')}</p>
    <p>{t('Automático usa la zona configurada del dispositivo; no obtiene tu ubicación física.')}</p>
    <p>{t('Primera entrega: 7 países y 62 zonas del catálogo. Los demás países no están disponibles; las zonas que tu navegador no admite aparecen deshabilitadas.')}</p>
    <button type="button" className="region-settings-reset" onClick={() => region.reset()}>{t('Restablecer país y zona')}</button>
  </details>;
}
