import { useMemo, useState } from 'react';
import type { DetalleViaje } from '../../api/viajes';
import { useAuth } from '../../auth/AuthContext';
import { AppHeaderBack } from '../../components/AppHeader';
import { Icon } from '../../components/Icon';
import { useIdioma } from '../../i18n/idioma';
import { goBack, navigate } from '../../router';
import { stringToCents } from '../../utils/money';
import { formatMXN } from '../../utils/format';
import { fullName } from '../../utils/identity';
import { ListaDePresentes } from './TicketNuevoScreen';
import { alternarPresente, candidatosDelViaje } from './ticketView';
import { EstadoSinViaje, useDetalleViaje } from './ViajeScreen';
import './viajes.css';
import './viaje.css';

/**
 * D244 · D245 · la carga manual de un gasto del viaje (`/viaje-gasto/<id>`).
 * Mati: «muy sencillo: Descripción, monto, selección de personas a distribuir
 * y listo». Quien lo carga queda como quien pagó (la regla del escaneo); se
 * reparte en partes iguales entre los marcados, con todos marcados y se
 * desmarca a quien no va. Sin tipo de lugar, fecha ni renglones.
 */
export function CargaManualScreen({ viajeId }: { viajeId: string }) {
  const { t } = useIdioma();
  const { session } = useAuth();
  const { carga, cargar } = useDetalleViaje(viajeId);
  return (
    <div className="screen vj-con-pie">
      <AppHeaderBack userName={fullName(session) ?? undefined} onBack={() => goBack('viaje', viajeId)} />
      {carga.tipo === 'listo' ? (
        <CargaManualVista viaje={carga.viaje} />
      ) : (
        <>
          <div className="title-card">
            <h1 className="title-card-title">{t('Carga manual')}</h1>
          </div>
          <div className="scroll vj-scroll">
            <EstadoSinViaje carga={carga} onReintentar={cargar} onVerViajes={() => navigate('viajes', 'abiertos')} />
          </div>
        </>
      )}
    </div>
  );
}

/** El monto tipeado, en centavos enteros, o `null` si no es un monto válido mayor que cero. */
export function montoTipeado(texto: string): number | null {
  const limpio = texto.trim().replace(/[$,\s]/g, '');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(limpio)) return null;
  try {
    const c = stringToCents(limpio);
    return Number.isSafeInteger(c) && c > 0 ? c : null;
  } catch {
    return null;
  }
}

export function CargaManualVista({ viaje }: { viaje: DetalleViaje }) {
  const { t } = useIdioma();
  const [descripcion, setDescripcion] = useState('');
  const [monto, setMonto] = useState('');
  const [ausentes, setAusentes] = useState<ReadonlySet<string>>(new Set());
  const candidatos = useMemo(() => candidatosDelViaje(viaje.miembros, t), [viaje.miembros, t]);
  const cents = montoTipeado(monto);
  const listo = descripcion.trim().length > 0 && cents !== null;
  return (
    <>
      <div className="title-card">
        {/* Respuesta D del plan: un solo título, como el viaje y Balance. */}
        <h1 className="title-card-title">{t('Carga manual')}</h1>
      </div>
      <div className="scroll vj-scroll">
        <section className="vj-card vjm-campos">
          <label className="vjm-campo">
            <span className="vjm-rotulo">{t('Descripción')}</span>
            <input
              className="vjm-input"
              value={descripcion}
              maxLength={120}
              placeholder={t('Por ejemplo: gasolina')}
              onChange={(e) => setDescripcion(e.target.value)}
            />
          </label>
          <label className="vjm-campo">
            <span className="vjm-rotulo">{t('Monto')}</span>
            <input
              className="vjm-input vjm-monto"
              inputMode="decimal"
              value={monto}
              placeholder="$0"
              onChange={(e) => setMonto(e.target.value.replace(/[^0-9.,$]/g, ''))}
            />
          </label>
          <p className="vjm-pago">
            <Icon name="check" size={16} />
            {t('Lo pagaste tú')}
          </p>
        </section>
        <section className="vj-card">
          <h2 className="vjm-titulo">{t('¿Entre quiénes?')}</h2>
          <p className="vjm-ayuda">{t('Se divide entre los marcados. Desmarca a quien no va.')}</p>
          <ListaDePresentes
            candidatos={candidatos}
            ausentes={ausentes}
            onAlternar={(id) => setAusentes((a) => alternarPresente(a, id, candidatos))}
          />
        </section>
      </div>
      <div className="vj-pie">
        {cents !== null && <p className="vjm-resumen">{t('Total {0}', formatMXN(cents))}</p>}
        <button type="button" className="btn btn-navy" disabled={!listo}>
          {t('Listo')}
        </button>
      </div>
    </>
  );
}
