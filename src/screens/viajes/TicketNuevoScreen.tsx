import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, newIdempotencyKey } from '../../api';
import type { OcrResponse } from '../../api/types';
import {
  TIPOS_LUGAR,
  errorDeViaje,
  type DetalleViaje,
  type FormaTicket,
  type MiembroViaje,
  type TicketDelViaje,
  type TipoLugar,
  type YaCargado,
} from '../../api/viajes';
import { useAuth } from '../../auth/AuthContext';
import { abrirCamaraNativa } from '../../camara/camaraNativa';
import { AppHeaderBack } from '../../components/AppHeader';
import { Icon } from '../../components/Icon';
import { useToast } from '../../components/ui';
import { useIdioma } from '../../i18n/idioma';
import { goBack, navigate, replaceRoute } from '../../router';
import { formatMXN } from '../../utils/format';
import { fullName } from '../../utils/identity';
import { olvidarTicketEscaneado, ticketEscaneadoDe } from './ticketEscaneado';
import {
  alternarPresente,
  candidatosDelViaje,
  fechaDelEscaneo,
  fechaYHoraLocal,
  idsPresentes,
  llaveParaPedido,
  pedidoDeCarga,
  subtituloDelTicket,
  totalDelEscaneo,
  type Candidato,
} from './ticketView';
import { etiquetaTipoLugar, iconoTipoLugar, nombreCompleto, nombreDelLugar, parametroDeTicket } from './viajesView';
import './viajes.css';
import './ticket.css';

/**
 * AF-VIAJES · D242 · «Ticket nuevo» (diseño 1h) con «¿Quiénes estuvieron?»
 * (la pantalla nueva de presentes) y el ticket que ya estaba en el viaje (1k).
 *
 * La cámara de siempre deja lo leído en memoria (`ticketEscaneado.ts`) y trae
 * acá. Antes de mostrar 1h se le pregunta al dueño si el recibo ya está en el
 * viaje (`POST …/tickets/check`): si está, 1k. Quien escanea primero pagó; el
 * front no reparte nada, sólo manda la forma, el tipo de lugar y lo leído.
 */

type Aviso = 'sin_escaneo' | 'recibo_usado' | 'recibo_invalido' | 'cerrado';

type Fase =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'error' }
  | { readonly tipo: 'no_disponible' }
  | { readonly tipo: 'aviso'; readonly aviso: Aviso }
  | { readonly tipo: 'duplicado'; readonly dup: YaCargado; readonly ticketId: string; readonly ticket: TicketDelViaje | null }
  | { readonly tipo: 'nuevo' };

const FORMAS: readonly FormaTicket[] = ['consumo', 'iguales', 'total'];

export function TicketNuevoScreen({ viajeId }: { viajeId: string }) {
  const { t } = useIdioma();
  const toast = useToast();
  const { session } = useAuth();
  // Lo escaneado se lee una vez: una recarga lo pierde a propósito.
  const [ocr] = useState<OcrResponse | null>(() => ticketEscaneadoDe(viajeId));
  const [viaje, setViaje] = useState<DetalleViaje | null>(null);
  const [fase, setFase] = useState<Fase>({ tipo: 'cargando' });
  const [tipo, setTipo] = useState<TipoLugar>('restaurante');
  const [forma, setForma] = useState<FormaTicket>('consumo');
  const [ausentes, setAusentes] = useState<Set<string>>(() => new Set());
  const [enviando, setEnviando] = useState(false);
  const llave = useRef<{ json: string; key: string } | null>(null);
  const vivo = useRef(true);

  useEffect(() => {
    vivo.current = true;
    return () => { vivo.current = false; };
  }, []);

  /** 1k: el ticket que ya estaba; el resumen llega después, si se puede leer. */
  const mostrarDuplicado = useCallback((dup: YaCargado, ticketId: string, ticket: TicketDelViaje | null) => {
    setFase({ tipo: 'duplicado', dup, ticketId, ticket });
    if (ticket) return;
    api.getTicketDeViaje(viajeId, ticketId).then((tk) => {
      if (!vivo.current) return;
      setFase((f) => (f.tipo === 'duplicado' && f.ticketId === ticketId ? { ...f, ticket: tk } : f));
    }, () => undefined);
  }, [viajeId]);

  const cargar = useCallback(() => {
    setFase({ tipo: 'cargando' });
    const leerViaje = api.getViaje(viajeId);
    if (!ocr || !ocr.receipt) {
      leerViaje.then((v) => { if (vivo.current) setViaje(v); }, () => undefined);
      setFase({ tipo: 'aviso', aviso: ocr ? 'recibo_invalido' : 'sin_escaneo' });
      return;
    }
    Promise.all([leerViaje, api.revisarTicketDeViaje(viajeId, ocr.receipt)]).then(([v, dup]) => {
      if (!vivo.current) return;
      setViaje(v);
      if (v.estado !== 'abierto') setFase({ tipo: 'aviso', aviso: 'cerrado' });
      else if (dup) mostrarDuplicado(dup, dup.ticket_id, null);
      else setFase({ tipo: 'nuevo' });
    }, (err: unknown) => {
      if (!vivo.current) return;
      const e = errorDeViaje(err);
      if (e.tipo === 'no_disponible') setFase({ tipo: 'no_disponible' });
      else if (e.tipo === 'no_abierto') setFase({ tipo: 'aviso', aviso: 'cerrado' });
      else if (e.tipo === 'recibo_usado' || e.tipo === 'recibo_invalido') setFase({ tipo: 'aviso', aviso: e.tipo });
      else setFase({ tipo: 'error' });
    });
  }, [viajeId, ocr, mostrarDuplicado]);

  useEffect(() => { cargar(); }, [cargar]);

  const candidatos = useMemo(() => (viaje ? candidatosDelViaje(viaje.miembros, t) : []), [viaje, t]);

  const escanearOtro = () => {
    abrirCamaraNativa();
    navigate('scan', viajeId);
  };
  const volverAlViaje = () => goBack('viaje', viajeId);

  async function compartir() {
    if (!ocr || enviando) return;
    const pedido = pedidoDeCarga(ocr, forma, tipo);
    llave.current = llaveParaPedido(llave.current, pedido, newIdempotencyKey);
    setEnviando(true);
    try {
      const r = await api.cargarTicketDeViaje(viajeId, { ...pedido, idempotency_key: llave.current.key });
      if (r.ya_cargado) {
        if (vivo.current) mostrarDuplicado(r.ya_cargado, r.ticket.id, r.ticket);
        return;
      }
      if (forma === 'iguales') {
        // Las personas del ticket son las del viaje al cargarlo; se marcan las
        // que quedaron marcadas acá. Sin nadie desmarcado, no hay nada que mandar.
        const marcados = new Set(idsPresentes(candidatos, ausentes));
        const delTicket = r.ticket.personas.flatMap((p) => (p.miembro_id ? [p.miembro_id] : []));
        const presentes = delTicket.filter((id) => marcados.has(id));
        if (presentes.length > 0 && presentes.length < delTicket.length) {
          await api.marcarPresentesEnTicket(viajeId, r.ticket.id, presentes);
        }
      }
      olvidarTicketEscaneado();
      if (forma === 'consumo') {
        replaceRoute('viaje-ticket', parametroDeTicket(viajeId, r.ticket.id));
      } else {
        replaceRoute('viaje', viajeId);
        toast(t('Compartiste el ticket con el viaje.'), { sobreLaBarra: true });
      }
    } catch (err) {
      if (!vivo.current) return;
      const e = errorDeViaje(err);
      if (e.tipo === 'recibo_usado' || e.tipo === 'recibo_invalido') setFase({ tipo: 'aviso', aviso: e.tipo });
      // «Este viaje ya se cerró.» con la salida al viaje, en vez de un botón que vuelve a fallar.
      else if (e.tipo === 'no_abierto') setFase({ tipo: 'aviso', aviso: 'cerrado' });
      else if (e.tipo === 'no_disponible') setFase({ tipo: 'no_disponible' });
      else if (e.tipo === 'limite_tickets') toast(t('Este viaje ya tiene el máximo de tickets.'), { sobreLaBarra: true });
      else toast(t('No pudimos guardarlo. Prueba de nuevo.'), { sobreLaBarra: true });
    } finally {
      if (vivo.current) setEnviando(false);
    }
  }

  const conPie = fase.tipo === 'nuevo' && ocr !== null;

  return (
    <div className={conPie ? 'screen vj-con-pie' : 'screen'}>
      <AppHeaderBack userName={fullName(session) ?? undefined} onBack={volverAlViaje} />
      {fase.tipo === 'nuevo' && ocr && viaje ? (
        <TicketNuevoVista
          viajeNombre={viaje.nombre}
          ocr={ocr}
          tipo={tipo}
          forma={forma}
          candidatos={candidatos}
          ausentes={ausentes}
          enviando={enviando}
          onTipo={setTipo}
          onForma={setForma}
          onPresente={(id) => setAusentes((a) => alternarPresente(a, id, candidatos))}
          onCompartir={() => void compartir()}
        />
      ) : fase.tipo === 'duplicado' && viaje ? (
        <DuplicadoVista
          viajeNombre={viaje.nombre}
          miMiembroId={viaje.mi_miembro_id}
          miembros={viaje.miembros}
          dup={fase.dup}
          ticket={fase.ticket}
          onElegir={() => replaceRoute('viaje-ticket', parametroDeTicket(viajeId, fase.ticketId))}
          onEscanearOtro={escanearOtro}
        />
      ) : fase.tipo === 'aviso' ? (
        <AvisoDeEscaneoVista
          viajeNombre={viaje?.nombre ?? null}
          aviso={fase.aviso}
          onEscanear={escanearOtro}
          onVolver={volverAlViaje}
        />
      ) : (
        <EstadoDeCargaVista
          estado={fase.tipo === 'no_disponible' ? 'no_disponible' : fase.tipo === 'error' ? 'error' : 'cargando'}
          viajeNombre={viaje?.nombre ?? null}
          onReintentar={cargar}
        />
      )}
    </div>
  );
}

// ─── Las vistas (puras: sin red ni efectos) ───────────────────────────────

function TituloTicketNuevo({ escanear, viajeNombre }: { escanear: boolean; viajeNombre: string | null }) {
  const { t } = useIdioma();
  return (
    <div className="title-card">
      <h1 className="title-card-title">{escanear ? t('Escanear ticket') : t('Ticket nuevo')}</h1>
      {viajeNombre && <div className="title-card-sub">{viajeNombre}</div>}
    </div>
  );
}

/** Cargando, el 404 y la falla de red. */
export function EstadoDeCargaVista({ estado, viajeNombre, onReintentar }: {
  estado: 'cargando' | 'no_disponible' | 'error';
  viajeNombre: string | null;
  onReintentar: () => void;
}) {
  const { t } = useIdioma();
  return (
    <>
      <TituloTicketNuevo escanear={false} viajeNombre={viajeNombre} />
      <div className="scroll vj-scroll">
        {estado === 'cargando' ? (
          <div className="vj-card" aria-busy="true" aria-label={t('Cargando…')}>
            <span className="sk-line w70" />
            <span className="sk-line w40" />
            <span className="sk-line w100" />
          </div>
        ) : estado === 'no_disponible' ? (
          <div className="vj-card vjt-aviso">
            <p className="vjt-aviso-titulo">{t('Este viaje ya no está disponible.')}</p>
            <button type="button" className="btn btn-navy" onClick={() => navigate('viajes', 'abiertos')}>
              {t('Ver tus viajes')}
            </button>
          </div>
        ) : (
          <div className="state-error">
            <div className="state-error-row">
              <Icon name="x-circle" size={22} />
              <div className="vjt-crece">
                <div className="state-error-title">{t('No pudimos cargar el viaje')}</div>
                <p className="state-error-body">{t('Revisa la conexión y prueba de nuevo.')}</p>
              </div>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onReintentar}>
              {t('Reintentar')}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

/** Lo que no deja cargar el ticket: sin escaneo, recibo usado o inválido, viaje cerrado. */
export function AvisoDeEscaneoVista({ viajeNombre, aviso, onEscanear, onVolver }: {
  viajeNombre: string | null;
  aviso: Aviso;
  onEscanear: () => void;
  onVolver: () => void;
}) {
  const { t } = useIdioma();
  return (
    <>
      <TituloTicketNuevo escanear viajeNombre={viajeNombre} />
      <div className="scroll vj-scroll">
        <div className="vj-card vjt-aviso" role="status">
          <span className="vjt-aviso-icono" aria-hidden="true"><Icon name="info" size={20} /></span>
          <p className="vjt-aviso-titulo">
            {aviso === 'sin_escaneo'
              ? t('No encontramos el ticket escaneado.')
              : aviso === 'recibo_usado'
                ? t('Este ticket ya se cargó en otro viaje.')
                : aviso === 'recibo_invalido'
                  ? t('No pudimos validar el ticket. Escanéalo de nuevo.')
                  : t('Este viaje ya se cerró.')}
          </p>
          {aviso !== 'cerrado' && (
            <button type="button" className="btn btn-navy" onClick={onEscanear}>
              {aviso === 'sin_escaneo' ? t('Escanear ticket') : t('Escanear otro ticket')}
            </button>
          )}
          <button type="button" className={aviso === 'cerrado' ? 'btn btn-navy' : 'btn btn-ghost'} onClick={onVolver}>
            {t('Volver al viaje')}
          </button>
        </div>
      </div>
    </>
  );
}

/** 1k · el ticket ya estaba en el viaje: quién lo cargó (y pagó) y el atajo para elegir. */
export function DuplicadoVista({ viajeNombre, miMiembroId, miembros, dup, ticket, onElegir, onEscanearOtro }: {
  viajeNombre: string;
  miMiembroId: string;
  miembros: readonly MiembroViaje[];
  dup: YaCargado;
  ticket: TicketDelViaje | null;
  onElegir: () => void;
  onEscanearOtro: () => void;
}) {
  const { t, idioma } = useIdioma();
  const cuando = fechaYHoraLocal(dup.en, idioma);
  const fuiYo = dup.por !== null && dup.por === miMiembroId;
  return (
    <>
      <TituloTicketNuevo escanear viajeNombre={viajeNombre} />
      <div className="scroll vj-scroll">
        <section className="vj-card vjt-aviso" aria-labelledby="vjt-duplicado-titulo">
          <span className="vjt-aviso-icono" aria-hidden="true"><Icon name="info" size={20} /></span>
          <h2 id="vjt-duplicado-titulo" className="vjt-aviso-titulo">{t('Este ticket ya está en el viaje')}</h2>
          {cuando && (
            <p className="vjt-aviso-texto">
              {fuiYo
                ? t('Ya cargaste este ticket el {0} a las {1}. No se carga dos veces.', cuando.fecha, cuando.hora)
                : t('{0} lo cargó el {1} a las {2} y quedó como quien lo pagó. No se carga dos veces.',
                  nombreCompleto(dup, t), cuando.fecha, cuando.hora)}
            </p>
          )}
          {ticket && (
            <div className="vjt-resumen">
              <span className="vjt-icono" aria-hidden="true"><Icon name={iconoTipoLugar(ticket.tipo_lugar)} size={18} /></span>
              <span className="vjt-crece">
                <span className="vjt-lugar">{nombreDelLugar(ticket.lugar, ticket.tipo_lugar, t)}</span>
                <span className="vjt-sub">{subtituloDelTicket(ticket, miembros, idioma, t, false)}</span>
              </span>
              <span className="vjt-monto">{formatMXN(ticket.monto_cents)}</span>
            </div>
          )}
          <button type="button" className="btn btn-navy" onClick={onElegir}>{t('Elegir lo que consumí')}</button>
          <button type="button" className="btn btn-ghost" onClick={onEscanearOtro}>{t('Escanear otro ticket')}</button>
        </section>
      </div>
    </>
  );
}

/**
 * «¿Quiénes estuvieron?» · la pantalla nueva de presentes, con el estilo de las
 * filas de 1h. Todos marcados de entrada; el último marcado no se desmarca.
 * Semántica de casilla (`checkbox`): se marca a varios.
 */
export function ListaDePresentes({ candidatos, ausentes, onAlternar, deshabilitada = false }: {
  candidatos: readonly Candidato[];
  ausentes: ReadonlySet<string>;
  onAlternar: (id: string) => void;
  deshabilitada?: boolean;
}) {
  const { t } = useIdioma();
  const marcados = candidatos.filter((c) => !ausentes.has(c.id)).length;
  return (
    <div className="vjt-opciones" role="group" aria-label={t('¿Quiénes estuvieron?')}>
      {candidatos.map((c) => {
        const marcado = !ausentes.has(c.id);
        const ultimo = marcado && marcados <= 1;
        return (
          <button
            key={c.id}
            type="button"
            role="checkbox"
            aria-checked={marcado}
            aria-disabled={ultimo || undefined}
            disabled={deshabilitada}
            className="vjt-opcion"
            onClick={() => { if (!ultimo) onAlternar(c.id); }}
          >
            <span className="vjt-radio" aria-hidden="true" />
            <span className="vjt-crece">
              <span className="vjt-opcion-titulo">{c.nombre}</span>
              {c.arroba && <span className="vjt-opcion-sub">@{c.arroba}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** 1h · el ticket recién escaneado, cómo se divide y (en partes iguales) quiénes estuvieron. */
export function TicketNuevoVista({
  viajeNombre, ocr, tipo, forma, candidatos, ausentes, enviando, onTipo, onForma, onPresente, onCompartir,
}: {
  viajeNombre: string;
  ocr: OcrResponse;
  tipo: TipoLugar;
  forma: FormaTicket;
  candidatos: readonly Candidato[];
  ausentes: ReadonlySet<string>;
  enviando: boolean;
  onTipo: (tipo: TipoLugar) => void;
  onForma: (forma: FormaTicket) => void;
  onPresente: (id: string) => void;
  onCompartir: () => void;
}) {
  const { t, idioma } = useIdioma();
  const fecha = fechaDelEscaneo(ocr.ticket_datetime, idioma);
  return (
    <>
      <TituloTicketNuevo escanear={false} viajeNombre={viajeNombre} />
      <div className="scroll vj-scroll">
        <section className="vj-card">
          <div className="vjt-cabeza">
            <span className="vjt-icono" aria-hidden="true"><Icon name={iconoTipoLugar(tipo)} size={18} /></span>
            <span className="vjt-crece">
              <span className="vjt-lugar">{ocr.merchant?.name ?? etiquetaTipoLugar(tipo, t)}</span>
              {fecha && <span className="vjt-sub">{fecha}</span>}
            </span>
            <span className="vjt-monto vjt-monto--grande">{formatMXN(totalDelEscaneo(ocr.items))}</span>
          </div>
          <hr className="vjt-div" />
          <span className="vjt-pagaste"><Icon name="check" size={14} />{t('Lo pagaste tú')}</span>
          <p className="vjt-texto">{t('Como lo escaneaste primero, queda a tu nombre el pago completo.')}</p>
          <h2 id="vjt-tipo-lugar" className="vjt-rotulo">{t('Tipo de lugar')}</h2>
          <div className="vjt-chips" role="radiogroup" aria-labelledby="vjt-tipo-lugar">
            {TIPOS_LUGAR.map((x) => (
              <button
                key={x}
                type="button"
                role="radio"
                aria-checked={x === tipo}
                className="vjt-chip"
                onClick={() => onTipo(x)}
              >
                {etiquetaTipoLugar(x, t)}
              </button>
            ))}
          </div>
        </section>

        <section className="vj-card" aria-labelledby="vjt-como">
          <h2 id="vjt-como" className="vjt-card-titulo">{t('¿Cómo lo dividen?')}</h2>
          <div className="vjt-opciones" role="radiogroup" aria-labelledby="vjt-como">
            {FORMAS.map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={f === forma}
                className="vjt-opcion"
                onClick={() => onForma(f)}
              >
                <span className="vjt-radio" aria-hidden="true" />
                <span className="vjt-crece">
                  {f === 'consumo' ? (
                    <>
                      <span className="vjt-opcion-titulo">{t('Por lo que pidió cada uno')}</span>
                      <span className="vjt-opcion-sub">{t('Cada uno elige lo suyo')}</span>
                    </>
                  ) : f === 'iguales' ? (
                    <>
                      <span className="vjt-opcion-titulo">{t('En partes iguales')}</span>
                      <span className="vjt-opcion-sub">{t('Entre los que estuvieron')}</span>
                    </>
                  ) : (
                    <>
                      <span className="vjt-opcion-titulo">{t('Pagar el total')}</span>
                      <span className="vjt-opcion-sub">{t('Invitas tú, nadie te debe')}</span>
                    </>
                  )}
                </span>
              </button>
            ))}
          </div>
        </section>

        {forma === 'iguales' && candidatos.length > 0 && (
          <section className="vj-card" aria-labelledby="vjt-quienes">
            <h2 id="vjt-quienes" className="vjt-card-titulo">{t('¿Quiénes estuvieron?')}</h2>
            <p className="vjt-texto vjt-texto--ayuda">{t('Se divide entre los marcados. Desmarca a quien no estuvo.')}</p>
            <ListaDePresentes candidatos={candidatos} ausentes={ausentes} onAlternar={onPresente} deshabilitada={enviando} />
          </section>
        )}
      </div>
      <div className="vj-pie">
        <button
          type="button"
          className="btn btn-navy"
          disabled={enviando}
          aria-busy={enviando || undefined}
          onClick={onCompartir}
        >
          {t('Compartir con el viaje')}
        </button>
      </div>
    </>
  );
}
