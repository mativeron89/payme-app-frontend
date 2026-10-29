import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { montoDePresupuestoValido, type PresupuestoDelMes as Presupuesto } from '../api/agente';
import { useIdioma } from '../i18n/idioma';
import { formatMXN } from '../utils/format';
import { centsToString, stringToCents } from '../utils/money';
import { useAgente } from './useAgente';
import './agente.css';

/** El monto escrito («4,200», «$4200.50») en centavos, o `null` si no es un monto que el dueño acepte. */
export function centavosDelPresupuesto(texto: string): number | null {
  const limpio = texto.replace(/[\s,]/g, '');
  if (!limpio) return null;
  try {
    const cents = stringToCents(limpio);
    return montoDePresupuestoValido(cents) ? cents : null;
  } catch {
    return null;
  }
}

/** El porcentaje de la barra, entero y entre 0 y 100. Sin monto, `null`: no hay barra. */
export function avanceDelPresupuesto(p: Presupuesto): number | null {
  if (p.montoCents === null || p.montoCents <= 0) return null;
  return Math.min(100, Math.floor((p.gastadoCents * 100) / p.montoCents));
}

/**
 * D553 (funcionalidad 3) · D554 (R-13 a) · el presupuesto del mes, en Estadísticas: lo gastado este mes contra tu
 * promedio de los últimos 3 meses (automático) o el monto que pusiste. Se puede editar y volver al promedio.
 *
 * Va acá y no en una pantalla nueva: es lo del mes en curso, la misma cuenta de `consumption_month` que la burbuja de
 * arriba. Vista propia (D-05 rev. 4): no pide el permiso de recomendaciones, pero sí la función encendida en el dueño
 * (`RECOMENDACIONES_CERCA_ENABLED`). Apagada (404), con un error o con otra forma, no se muestra nada.
 */
export function PresupuestoDelMes() {
  const { t } = useIdioma();
  const { estado, session } = useAgente();
  const [presupuesto, setPresupuesto] = useState<Presupuesto | null>(null);
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<'monto' | 'no_se_guardo' | null>(null);
  const encendida = estado?.recomendaciones === true && session !== null;
  const cuenta = session ? `${session.family_id}:${session.principal_id}` : null;
  const sesionRef = useRef(session);
  sesionRef.current = session;
  const epoca = useRef(0);
  const campo = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const marca = ++epoca.current;
    setPresupuesto(null);
    setEditando(false);
    setError(null);
    const s = sesionRef.current;
    if (!encendida || !s) return;
    api.getPresupuesto(s).then((p) => { if (marca === epoca.current) setPresupuesto(p); }, () => undefined);
  }, [encendida, cuenta]);

  useEffect(() => { if (editando) campo.current?.focus(); }, [editando]);

  if (!encendida || presupuesto === null) return null;
  const actual = presupuesto;

  async function guardar(accion: 'poner' | 'volver') {
    const s = sesionRef.current;
    if (!s || ocupado) return;
    const monto = accion === 'poner' ? centavosDelPresupuesto(texto) : null;
    if (accion === 'poner' && monto === null) { setError('monto'); return; }
    const marca = epoca.current;
    setOcupado(true);
    setError(null);
    try {
      const nuevo = accion === 'poner' ? await api.putPresupuesto(monto!, s) : await api.deletePresupuesto(s);
      if (marca !== epoca.current) return;
      setPresupuesto(nuevo);
      setEditando(false);
    } catch {
      if (marca === epoca.current) setError('no_se_guardo');
    } finally {
      if (marca === epoca.current) setOcupado(false);
    }
  }

  const avance = avanceDelPresupuesto(actual);
  const origen = actual.origen === 'editado' ? t('Lo pusiste tú.')
    : actual.origen === 'automatico' ? t('Es tu promedio de los últimos 3 meses.')
      : t('Todavía no tenemos tu promedio. Puedes ponerte uno.');
  return (
    <section className="est-panel agente-presupuesto" aria-labelledby="agente-presupuesto-titulo" aria-busy={ocupado}>
      <h2 id="agente-presupuesto-titulo">{t('Tu presupuesto del mes')}</h2>
      <div className="agente-presupuesto-cifra">
        {actual.montoCents === null
          ? <>{t('Llevas')} <b>{formatMXN(actual.gastadoCents)}</b> {t('este mes')}</>
          : <>{t('Llevas')} <b>{formatMXN(actual.gastadoCents)}</b> {t('de')} <b>{formatMXN(actual.montoCents)}</b></>}
      </div>
      {avance !== null && (
        <div
          className="mesa-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={avance}
          aria-label={t('Llevas el {0}% de tu presupuesto', avance)}
        >
          <span style={{ width: `${avance}%` }} />
        </div>
      )}
      <p className="agente-presupuesto-origen">{origen}</p>
      {editando ? (
        <form className="agente-presupuesto-form" onSubmit={(e) => { e.preventDefault(); void guardar('poner'); }}>
          <input
            ref={campo}
            className="agente-presupuesto-input"
            inputMode="decimal"
            aria-label={t('Presupuesto del mes, en pesos')}
            value={texto}
            disabled={ocupado}
            onChange={(e) => { setTexto(e.target.value.replace(/[^0-9.,$\s]/g, '')); setError(null); }}
          />
          <button type="submit" className="btn btn-navy btn-sm btn-fit" disabled={ocupado}>{t('Guardar')}</button>
          <button type="button" className="btn btn-ghost btn-sm btn-fit" disabled={ocupado} onClick={() => { setEditando(false); setError(null); }}>
            {t('Cancelar')}
          </button>
          {error && (
            <p className="agente-presupuesto-error" role="alert">
              {error === 'monto' ? t('Escribe un monto de $1 en adelante.') : t('No se pudo guardar. Prueba de nuevo.')}
            </p>
          )}
        </form>
      ) : (
        <div className="agente-presupuesto-acciones">
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-fit"
            disabled={ocupado}
            onClick={() => { setTexto(actual.montoCents === null ? '' : centsToString(actual.montoCents)); setEditando(true); }}
          >
            {actual.montoCents === null ? t('Poner un presupuesto') : t('Cambiar')}
          </button>
          {actual.origen === 'editado' && actual.promedioCents !== null && (
            <button type="button" className="btn btn-ghost btn-sm btn-fit" disabled={ocupado} onClick={() => void guardar('volver')}>
              {t('Volver a mi promedio')}
            </button>
          )}
          {error === 'no_se_guardo' && <p className="agente-presupuesto-error" role="alert">{t('No se pudo guardar. Prueba de nuevo.')}</p>}
        </div>
      )}
    </section>
  );
}
