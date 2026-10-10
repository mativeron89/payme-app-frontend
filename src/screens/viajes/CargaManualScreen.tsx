import { useEffect, useMemo, useRef, useState } from 'react';
import { api, newIdempotencyKey } from '../../api';
import { errorDeViaje, MAX_DESCRIPCION_GASTO, MAX_GASTO_MANUAL_CENTS, type DetalleViaje, type GastoManualPedido } from '../../api/viajes';
import { useAuth } from '../../auth/AuthContext';
import { AppHeaderBack } from '../../components/AppHeader';
import { useToast } from '../../components/ui';
import { useIdioma } from '../../i18n/idioma';
import { goBack, navigate } from '../../router';
import { stringToCents } from '../../utils/money';
import { formatMXN } from '../../utils/format';
import { fullName } from '../../utils/identity';
import {
  avisoDeQuienPago,
  conQuienPago,
  opcionesDeQuienPago,
  QUIEN_PAGO_INICIAL,
  repartoDeQuienPago,
  SelectorDeQuienPago,
  type QuienPagoElegido,
} from './QuienPago';
import { ListaDePresentes } from './TicketNuevoScreen';
import { alternarPresente, candidatosDelViaje, idsPresentes, llaveParaPedido } from './ticketView';
import { EstadoSinViaje, useDetalleViaje } from './ViajeScreen';
import './viajes.css';
import './viaje.css';

/**
 * D244 · D245 · la carga manual de un gasto del viaje (`/viaje-gasto/<id>`).
 * Mati: «muy sencillo: Descripción, monto, selección de personas a distribuir
 * y listo». Se reparte en partes iguales entre los marcados, con todos marcados
 * y se desmarca a quien no va. Sin tipo de lugar, fecha ni renglones.
 * D255-6 · D263 · «¿Quién pagó?»: tú por defecto, otro o varios (en partes iguales o con «Ajustar montos»).
 *
 * «Listo» manda `POST /api/viajes/:id/gastos` (App Backend 2.172.0) con una
 * llave de idempotencia estable mientras el pedido no cambie (un reintento es
 * el mismo gasto, nunca otro), y vuelve al viaje con «Cargaste el gasto.».
 */
export function CargaManualScreen({ viajeId }: { viajeId: string }) {
  const { t } = useIdioma();
  const { session } = useAuth();
  const toast = useToast();
  const { carga, cargar, refrescar, noDisponible } = useDetalleViaje(viajeId);
  const [enviando, setEnviando] = useState(false);
  const llave = useRef<{ json: string; key: string } | null>(null);
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  async function guardar(pedido: Omit<GastoManualPedido, 'idempotency_key'>) {
    if (enviando) return;
    llave.current = llaveParaPedido(llave.current, pedido, newIdempotencyKey);
    setEnviando(true);
    try {
      await api.cargarGastoDeViaje(viajeId, { ...pedido, idempotency_key: llave.current.key });
      goBack('viaje', viajeId);
      toast(t('Cargaste el gasto.'), { sobreLaBarra: true });
    } catch (err) {
      if (!vivo.current) return;
      const e = errorDeViaje(err);
      if (e.tipo === 'no_disponible') noDisponible();
      else if (e.tipo === 'no_abierto') toast(t('Este viaje ya se cerró.'), { sobreLaBarra: true });
      else if (e.tipo === 'limite_tickets') toast(t('Este viaje ya tiene el máximo de tickets.'), { sobreLaBarra: true });
      else if (e.tipo === 'pagadores_no_suman') toast(t('Los montos no suman el total. Revísalos.'), { sobreLaBarra: true });
      else if (e.tipo === 'pagador_desconocido') {
        // Alguien que pagó salió del viaje mientras tanto: se vuelve a pedir el viaje y el selector queda con los que
        // siguen (sin ninguno, tú).
        toast(t('Quien pagó ya no está en el viaje. Elige de nuevo.'), { sobreLaBarra: true });
        void refrescar();
      } else if (e.tipo === 'persona_desconocida') {
        // Alguien de la lista salió del viaje mientras tanto: se vuelve a pedir el viaje sin borrar lo
        // escrito, y la lista queda con los que siguen.
        toast(t('Alguien ya no está en el viaje. Revisa entre quiénes.'), { sobreLaBarra: true });
        void refrescar();
      } else toast(t('No pudimos guardarlo. Prueba de nuevo.'), { sobreLaBarra: true });
    } finally {
      if (vivo.current) setEnviando(false);
    }
  }

  return (
    <div className="screen vj-con-pie">
      <AppHeaderBack userName={fullName(session) ?? undefined} onBack={() => goBack('viaje', viajeId)} />
      {carga.tipo === 'listo' ? (
        <CargaManualVista viaje={carga.viaje} enviando={enviando} onListo={(pedido) => void guardar(pedido)} />
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
    return Number.isSafeInteger(c) && c > 0 && c <= MAX_GASTO_MANUAL_CENTS ? c : null;
  } catch {
    return null;
  }
}

export function CargaManualVista({ viaje, enviando = false, onListo }: {
  viaje: DetalleViaje;
  enviando?: boolean;
  onListo?: (pedido: Omit<GastoManualPedido, 'idempotency_key'>) => void;
}) {
  const { t } = useIdioma();
  const [descripcion, setDescripcion] = useState('');
  const [monto, setMonto] = useState('');
  const [ausentes, setAusentes] = useState<ReadonlySet<string>>(new Set());
  const [quienPago, setQuienPago] = useState<QuienPagoElegido>(QUIEN_PAGO_INICIAL);
  const candidatos = useMemo(() => candidatosDelViaje(viaje.miembros, t), [viaje.miembros, t]);
  const opciones = useMemo(() => opcionesDeQuienPago(viaje.miembros, t), [viaje.miembros, t]);
  const cents = montoTipeado(monto);
  const reparto = repartoDeQuienPago(quienPago, opciones, cents);
  // D263 · con montos ajustados que no suman el total, «Listo» espera (el aviso lo dice arriba).
  const listo = descripcion.trim().length > 0 && cents !== null && reparto.valido;
  const aviso = avisoDeQuienPago(reparto, cents, t);
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
              maxLength={MAX_DESCRIPCION_GASTO}
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
          <SelectorDeQuienPago opciones={opciones} elegido={quienPago} total={cents} onCambio={setQuienPago} deshabilitado={enviando} />
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
        {aviso && <p className="vjq-aviso vjq-aviso--pie" role="status">{aviso}</p>}
        <button
          type="button"
          className="btn btn-navy"
          disabled={!listo || enviando}
          onClick={() => {
            if (cents === null || !reparto.valido) return;
            onListo?.(conQuienPago(
              { descripcion: descripcion.trim(), monto_cents: cents, presentes: idsPresentes(candidatos, ausentes) },
              reparto,
            ));
          }}
        >
          {t('Listo')}
        </button>
      </div>
    </>
  );
}
