import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import {
  LazyShortfallGate,
  loadShortfallDetailForSession,
  shortfallIdentifiedCount,
  type AvailableShortfallDetail,
  type ShortfallNotificationDisclosure,
} from '../api/shortfallDetail';
import { isCurrentSession, loadSession, type StoredSession } from '../api/storage';
import { useIdioma } from '../i18n/idioma';
import { formatMXN } from '../utils/format';
import { Icon } from './Icon';

interface ShortfallDisclosureProps {
  session: StoredSession;
  disclosure: ShortfallNotificationDisclosure;
}

type DisclosureState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'available'; detail: AvailableShortfallDetail; expanded: boolean };

export function ShortfallDisclosure({ session, disclosure }: ShortfallDisclosureProps) {
  const { t } = useIdioma();
  const [state, setState] = useState<DisclosureState>({ kind: 'idle' });
  const gate = useRef(new LazyShortfallGate());
  const familyId = session.family_id;
  const principalId = session.principal_id;
  const accessToken = session.access_token;
  const refreshToken = session.refresh_token;
  const mesaCode = disclosure.mesaCode;
  const shortfallCents = disclosure.shortfallCents;

  useEffect(() => {
    gate.current.reset();
    setState({ kind: 'idle' });
    return () => { gate.current.reset(); };
  }, [familyId, principalId, accessToken, refreshToken, mesaCode, shortfallCents]);

  const load = useCallback(async () => {
    if (state.kind === 'available') {
      setState((current) => current.kind === 'available'
        ? { ...current, expanded: !current.expanded }
        : current);
      return;
    }
    const generation = gate.current.start();
    if (generation === null) return;
    const origin = session;
    setState({ kind: 'loading' });
    const outcome = await loadShortfallDetailForSession(origin, mesaCode, shortfallCents, {
      request: (code, cents, expected) => api.getShortfallDetail(code, cents, expected),
      loadCurrent: loadSession,
      isCurrent: isCurrentSession,
    });
    if (!gate.current.isCurrent(generation) || outcome.kind === 'stale') return;
    if (outcome.kind === 'unavailable') {
      // 403/404, red, versión desconocida, snapshot ausente o DTO malformado
      // comparten el aviso agregado. Nunca se publica “Sin asignar” por null.
      setState({ kind: 'unavailable' });
      return;
    }
    setState({ kind: 'available', detail: outcome.detail, expanded: true });
  }, [mesaCode, session, shortfallCents, state.kind]);

  if (state.kind === 'unavailable') return null;

  const rows = state.kind === 'available' ? state.detail.rows : [];
  const unassigned = state.kind === 'available' ? state.detail.unassigned_cents : 0;
  const identifiedCount = state.kind === 'available' ? shortfallIdentifiedCount(state.detail) : 0;
  const expanded = state.kind === 'available' && state.expanded;

  return (
    <div className="shortfall-disclosure">
      <button
        type="button"
        className="shortfall-disclosure-toggle"
        onClick={() => void load()}
        disabled={state.kind === 'loading'}
        aria-expanded={expanded}
      >
        <span>
          {state.kind === 'loading' ? t('Consultando quién no pagó…') : t('Quién no pagó')}
          {state.kind === 'available' && identifiedCount > 0 && (
            <span
              className="shortfall-disclosure-count"
              aria-label={t('{0} identificados', identifiedCount)}
            >
              {identifiedCount}
            </span>
          )}
        </span>
        <Icon name="chevron-down" size={16} className={expanded ? 'shortfall-chevron-up' : ''} />
      </button>
      {expanded && state.kind === 'available' && (
        <div className="shortfall-disclosure-list">
          {rows.map((row, index) => (
            <div className="shortfall-person" key={`${index}:${row.display_name}`}>
              <span className="shortfall-person-avatar" aria-hidden="true">
                {[...row.display_name.trim()][0]?.toLocaleUpperCase() ?? '?'}
              </span>
              <strong>{row.display_name}</strong>
              <span>{formatMXN(row.due_cents)}</span>
            </div>
          ))}
          {unassigned > 0 && (
            <div className="shortfall-person">
              <span className="shortfall-person-avatar" aria-hidden="true">?</span>
              <strong>{t('Sin asignar')}</strong>
              <span>{formatMXN(unassigned)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
