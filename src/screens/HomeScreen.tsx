import { useCallback, useEffect, useState } from 'react';
import { useIdioma } from '../i18n/idioma';
import { api } from '../api';
import type { BalanceResponse, OpenMesasResponse, WalletTransaction } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { navigate } from '../router';
import { readUnconfirmed, scopeForActor, useMoneyActor } from '../api/idempotency';
import { useWalletRail } from '../api/walletRail';
import { accountRailView, corteDePagosView } from '../api/releaseGates';
import { useMoneyRail } from '../api/moneyRail';
import { countdownLong, formatMXN } from '../utils/format';
import { fullName } from '../utils/identity';
import {
  asignadoDeMesaAbierta,
  estadoPersonalDeMesa,
  mesaStatusLabel,
  pagadoPropioCentavos,
  personasEnMesa,
  walletTxIcon,
  walletTxLabel,
} from '../utils/labels';
import type { OpenMesa } from '../api/types';
import { ordenarPorUrgencia } from './homeMesasView';
import { Icon } from '../components/Icon';
import { AppBottomBar } from '../components/AppBottomBar';
import {
  AppHeader, BubbleTabs, Launcher, MountedCard, type BubbleTab,
} from '../components/AppHeader';
import { FriendAvatarNotice } from '../components/FriendAvatarNotice';
import { InvitacionEnInicio } from './InvitacionEnInicio';
import { AvisoAgregarAInicio } from '../instalar/GuiaAgregarAInicio';
import { ultimoVisto, useEsperaVisible } from '../api/ultimoVisto';
import { useSinLeer } from '../components/useSinLeer';
import { useViajesHabilitado } from '../api/viajes';
import { inicioPideViajes, olvidarInicioEnViajes } from './viajes/inicioEnViajes';
import { FilaCrearViaje, ListaDeInicio, PanelViajes, useConteoDeViajes } from './viajes/PestanaViajes';

/**
 * §1.1 · Inicio — y §1.11, que **es la misma pantalla**: las tres pestañas SON
 * Inicio. Ratificadas con Mati el 2026-08-03 mirando pantallas.
 *
 * El problema que resolvía: con el riel de saldo durmiente esta pantalla queda
 * literalmente vacía en el build real —la tarjeta de saldo era el único objeto
 * con peso visual y ya no está—. Ahora la estructura es la de §5 bis: banda
 * navy de borde curvo, pestañas en burbuja enganchadas a la tarjeta montada, la
 * mesa **debajo** de los accesos (decisión de Mati: ahí pega más que
 * encabezando), y la barra de cinco posiciones.
 *
 * Dato de producto CADUCO, corregido el 2026-08-05 (§1.1 del spec, variante
 * B): "nunca hay más de UNA mesa abierta" era cierto cuando lo confirmó Mati
 * (2026-08-03) y lo invalidó G-28 — `/mesas/open` ahora trae también las
 * mesas donde sos PARTICIPANTE, sin límite. La burbuja protagonista se queda
 * (jerarquía aprobada pantalla por pantalla); cuando hay más de una, una
 * tercera fila "+N mesas abiertas más" abre la hoja con las demás — porque
 * desde §1.10 "Mesas" es historial de CERRADAS y una abierta que no entra acá
 * no existe en ninguna otra superficie. El criterio de cuál es la
 * protagonista vive en `homeMesasView.ts`.
 *
 * 🔴 **La invitación pendiente VUELVE a Inicio (decisión 109 de Mati,
 * 2026-09-28)**, y supersede la del 2026-08-05 (§5 del spec) que la había
 * mandado sólo a Avisos con «No se duplica: se saca». Literal: «la invitación
 * a la mesa tiene que aparecer con una burbuja en el Inicio, no únicamente en
 * notificaciones, tiene que ser más sencillo y ahí ahorramos un click». Ahora
 * se ve en Inicio Y en Avisos: una burbuja arriba de la mesa, con «Sumarme»
 * directo, y «+N invitaciones más» que lleva a Avisos. La lógica y el pedido
 * viven en `InvitacionEnInicio.tsx`; aceptar es la misma función que Avisos.
 */

/**
 * Las tres de §1.11. `asociadas` existe y no tiene interior: ver abajo.
 * AF-VIAJES · D242 · con la capacidad de Viajes, la tercera es «Viajes» en
 * lugar de «Asociadas» (1a); sin ella, Inicio queda exactamente como antes.
 */
type TabId = 'cuenta' | 'estadisticas' | 'asociadas' | 'viajes';

/** Español a propósito: constante de módulo, se traduce al renderizar
 *  (ver el `.map` que las pasa a `BubbleTabs`). Sin `t` en este ámbito. */
const TABS: BubbleTab[] = [
  { id: 'cuenta', label: 'Cuenta' },
  { id: 'estadisticas', label: 'Estadísticas' },
  { id: 'asociadas', label: 'Asociadas' },
];

function txDate(iso: string, locale: string, t: (s: string, ...a: unknown[]) => string): string {
  const d = new Date(iso);
  const diffDays = Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60_000));
  if (diffDays === 0) return t('Hoy');
  if (diffDays === 1) return t('Ayer');
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

/**
 * AF-18 · «Mesa PA-2847 · 4 personas» (G-27). Sin `participants_count` válido
 * la línea va sin el conteo, como hasta 0.168.0: un número inventado en la
 * pantalla principal es peor que un dato de menos.
 */
function lineaDeMesa(m: OpenMesa, t: (s: string, ...a: unknown[]) => string): string {
  const personas = personasEnMesa(m);
  const base = `${t('Mesa')} ${m.code}`;
  if (personas === null) return base;
  return `${base} · ${personas === 1 ? t('1 persona') : t('{0} personas', personas)}`;
}

/**
 * AF-18 · G-34 · la etiqueta PERSONAL, o `null` si no corresponde. Los textos
 * van con `t('…')` literal; la DECISIÓN vive en `utils/labels.ts`
 * (`estadoPersonalDeMesa`), la misma para la burbuja y la hoja de «+N mesas».
 */
function etiquetaPersonal(m: OpenMesa, t: (s: string, ...a: unknown[]) => string): string | null {
  const estado = estadoPersonalDeMesa(m);
  if (estado === 'paid') return t('Ya pagaste, faltan otros');
  if (estado === 'pending') return t('Te falta pagar');
  return null;
}

/**
 * Decisión 76 · qué avance muestra una mesa abierta en el Inicio: lo ELEGIDO si
 * el dueño lo publica (`asignadoDeMesaAbierta`), si no lo pagado, como antes.
 */
function avanceDeMesa(m: OpenMesa): { readonly cents: number; readonly percent: number } {
  const asignado = asignadoDeMesaAbierta(m);
  if (asignado) return { cents: asignado.assignedCents, percent: asignado.percent };
  return { cents: m.paid_amount_cents, percent: Math.min(100, Math.max(0, m.pct_paid)) };
}

export function HomeScreen() {
  const { t, locale } = useIdioma();
  const { session } = useAuth();
  /**
   * 🔴 ORDEN A · «SEGUÍ CON TU AUTORIZACIÓN» (acta
   * `[PAYME]_ACTA_2026-08-19_3DS_ABANDONADO_RETOMAR_Y_BARRER.md`).
   *
   * **Lo medido antes de escribir esto, porque la orden se ejecuta sobre lo
   * medido y no sobre lo que el acta asume:**
   *  - la referencia de retome **YA se guarda durable** — el journal vive en
   *    `localStorage` (`payme_money_journal_v5_*`), no en memoria;
   *  - y **YA existe** la salida que retoma esa garantía sin abrir otra.
   *
   * ⚠️ **El hueco real era OTRO: la salida sólo se veía DENTRO del flujo de
   * crear mesa.** Quien abandonaba el 3DS y volvía a abrir la app aterrizaba
   * en Inicio, donde nada se lo decía: para enterarse tenía que entrar a
   * «Nueva», que es justo la puerta equivocada — no quiere abrir otra mesa,
   * quiere terminar la que dejó. **Es la misma clase que ya nos mordió: la
   * salida existía y era inalcanzable desde donde la persona vuelve.**
   *
   * El área de `create_mesa` es **independiente del restaurante** por diseño
   * del journal (*«una sola intención viva por principal»*,
   * `idempotency.ts:104-107`), así que Inicio puede preguntar sin conocerlo.
   * Esto **sólo LEE**: no reenvía, no libera y no abre nada.
   */
  const { actor } = useMoneyActor();
  const [aperturaPendiente, setAperturaPendiente] = useState(false);
  useEffect(() => {
    if (!actor) return;
    let alive = true;
    void readUnconfirmed(scopeForActor(actor, 'mesa:pendiente'), 'create_mesa')
      .then((attempt) => { if (alive) setAperturaPendiente(!!attempt); })
      // Un journal ilegible NO se anuncia como «tenés algo pendiente»: se
      // calla. Afirmarlo sin poder leerlo sería inventar una deuda.
      .catch(() => { if (alive) setAperturaPendiente(false); });
    return () => { alive = false; };
  }, [actor]);
  // OLA 5D · saldo y movimientos son riel saldo: los habilita el BACKEND.
  // Arranca apagado, así que ni siquiera se PIDEN mientras la capability viaja.
  const { walletRailEnabled, accountActivity } = useWalletRail();
  // Los accesos de la pestaña Cuenta leen DOS gates distintos: el riel saldo NO
  // apaga tarjetas (`showCards` de `accountRailView`, cableado acá por primera
  // vez) y el corte del viernes SÍ (`corteDePagosView`). Ver `releaseGates.ts`.
  const rail = accountRailView(walletRailEnabled, accountActivity);
  const corte = corteDePagosView(useMoneyRail());
  // H02 · después de salir de un viaje, Inicio abre en la pestaña Viajes (una vez).
  const [tabElegida, setTab] = useState<TabId>(() => (inicioPideViajes() ? 'viajes' : 'cuenta'));
  useEffect(() => { olvidarInicioEnViajes(); }, []);
  // AF-VIAJES · la tercera pestaña depende de la capacidad, que llega después
  // del primer cuadro: la elegida se traduce a la que existe.
  const conViajes = useViajesHabilitado();
  const tab: TabId = tabElegida === 'asociadas' && conViajes ? 'viajes'
    : tabElegida === 'viajes' && !conViajes ? 'asociadas' : tabElegida;
  const pestanas = conViajes ? TABS.filter((x) => x.id !== 'asociadas') : TABS;
  const { conteo: conteoViajes, elegida: listaDeViajes, elegir: elegirListaDeViajes, reintentar: reintentarViajes } =
    useConteoDeViajes(tab === 'viajes');
  const [balance, setBalance] = useState<BalanceResponse | null>(null);
  const [showBalance, setShowBalance] = useState(false);
  // D237 · lo último visto de esta cuenta, si hay: al volver a Inicio la mesa
  // está desde el primer cuadro y se actualiza por detrás.
  const [openMesas, setOpenMesas] = useState<OpenMesasResponse | null>(
    () => ultimoVisto.leer<OpenMesasResponse>('inicio.mesasAbiertas') ?? null,
  );
  const [mesasFallaron, setMesasFallaron] = useState(false);
  const [txs, setTxs] = useState<WalletTransaction[] | null>(null);
  const unread = useSinLeer();
  // D237 · la primera carga muestra su esqueleto sólo si tarda más de 300 ms.
  const esperaMesaVisible = useEsperaVisible(openMesas === null && !mesasFallaron);

  /**
   * La mesa se pide aparte del resto porque es lo único que puede fallar
   * VISIBLEMENTE: §1.1 pide que un error de red pinte el estado de error con
   * **Reintentar** dentro de la burbuja, y que las pestañas sigan funcionando.
   * Tragarse el error como hacía el `.catch(() => undefined)` anterior dejaba
   * la pantalla diciendo "No tenés mesas abiertas" cuando lo cierto era que no
   * habíamos podido preguntar — vacío real y falla de red son cosas distintas.
   */
  const cargarMesas = useCallback((desdeCero: boolean) => {
    setMesasFallaron(false);
    // D237 · con lo último visto en pantalla se pide por detrás, sin volver a
    // la carga; «Reintentar» sí empieza de cero.
    if (desdeCero) setOpenMesas(null);
    // T-01 · la cuenta se toma AL PEDIR: una respuesta tardía de otra cuenta ni se guarda ni se muestra.
    const turno = ultimoVisto.turno();
    return api
      .getOpenMesas()
      .then((r) => {
        const g = ultimoVisto.guardar(turno, 'inicio.mesasAbiertas', r);
        if (g) setOpenMesas(g.valor);
      })
      .catch(() => {
        if (!ultimoVisto.esDeAhora(turno)) return;
        // Lo guardado ya no se puede confirmar: no se lo muestra como cierto.
        ultimoVisto.olvidar('inicio.mesasAbiertas');
        setOpenMesas(null);
        setMesasFallaron(true);
      });
  }, []);

  // Card-only: no depende del riel y se pide una sola vez (y siempre, aunque
  // haya algo guardado: lo guardado sólo decide el primer cuadro).
  useEffect(() => {
    void cargarMesas(false);
  }, [cargarMesas]);

  /**
   * ⚠️ EL RIEL VA EN SU PROPIO EFECTO, Y LA DEPENDENCIA NO ES OPCIONAL.
   *
   * `walletRailEnabled` no es una constante: llega DESPUÉS del primer render.
   * Con estas llamadas dentro del efecto card-only —que corre una sola vez,
   * cuando la capability todavía vale `false` por fail-closed— nunca se
   * pedirían: si el backend encendiera el riel, la tarjeta de saldo quedaría en
   * "…" para siempre y los movimientos no aparecerían nunca.
   *
   * Es el gemelo del bug de la pestaña de Cuenta: **un valor que pasó de
   * constante a asíncrono rompe todo lo que lo leyó una sola vez.**
   */
  useEffect(() => {
    if (!walletRailEnabled) return;
    let alive = true;
    api.getBalance().then((b) => alive && setBalance(b)).catch(() => undefined);
    api
      .getWalletTransactions()
      .then((r) => alive && setTxs(r.transactions.slice(0, 4)))
      .catch(() => alive && setTxs([]));
    return () => {
      alive = false;
    };
  }, [walletRailEnabled]);

  // §1.1 (2026-08-05): primero la de vencimiento MÁS PRÓXIMO, no la primera del
  // payload. D181 · una tarjeta por mesa, en ese orden (sin «+N más» ni hoja).
  const porUrgencia = openMesas ? ordenarPorUrgencia(openMesas.mesas) : [];
  const masked = '$ ••••';

  return (
    <div className="screen has-appbar">
      <AppHeader
        userName={fullName(session) ?? undefined}
        alignChrome
        unread={unread}
        onBell={() => navigate('avisos')}
        tabs={<BubbleTabs
          tabs={[
            ...pestanas.map((x) => ({ ...x, label: t(x.label) })),
            ...(conViajes ? [{ id: 'viajes', label: t('Viajes') }] : []),
          ]}
          active={tab}
          onSelect={(id) => setTab(id as TabId)}
        />}
      />

      <div className="scroll">
        {aperturaPendiente && (
          <button type="button" className="note note-orange aviso-retome" onClick={() => navigate('scan')}>
            <b>{t('Dejaste una autorización sin confirmar.')}</b>{' '}
            {t('Sigue con esa garantía: no abras otra mesa.')}
          </button>
        )}
        {/* La tarjeta cuadra la esquina que coincide con una pestaña extrema;
            la pestaña central conserva ambos radios (§5 bis · B). */}
        <MountedCard seam={tab === TABS[0]!.id ? 'left' : tab === (conViajes ? 'viajes' : TABS.at(-1)!.id) ? 'right' : undefined}>
          {/* Decisiones 98 y 99 de Mati: la pestaña «Cuenta» ofrece dos accesos
              lado a lado, del mismo tamaño y composición que el de «Estadísticas»:
              - «Ver pagos» lleva a Mesas mientras los pagos estén apagados (la ruta
                'pagos' sigue existiendo);
              - «Ver perfil» lleva a Configuración, la misma pantalla que «Más»
                (`AppBottomBar` → 'mas' → `MasScreen`).
              «Ver tarjetas» conserva su condición. */}
          {tab === 'cuenta' && (
            <div className="launch-pair home-tab-panel">
              {rail.showCards && corte.showCards && (
                <Launcher icon="card" label={t('Ver tarjetas')} onClick={() => navigate('tarjetas')} />
              )}
              <Launcher icon="receipt" label={t('Ver pagos')} onClick={() => navigate('mesas')} />
              <Launcher icon="settings" label={t('Ver perfil')} onClick={() => navigate('mas')} />
            </div>
          )}

          {/* AF-BURBUJA-STATS (pedido de Mati del 25/09): la pestaña tiene el MISMO tamaño y la misma composición
              que «Cuenta» —ícono y acción—. La invitación «¿Quieres ver qué consumes, cuánto y dónde?» la hacía
              148 px contra 116 (dos líneas a 390) y el contenido de abajo saltaba 32 px al cambiar de pestaña;
              la orden prioriza la composición de «Cuenta», así que se retira. */}
          {tab === 'estadisticas' && (
            <div className="launch-pair home-tab-panel">
              <Launcher
                icon="chart"
                label={t('Ver mis estadísticas')}
                onClick={() => navigate('estadisticas')}
              />
            </div>
          )}

          {/**
           * ⛔ SIN DISEÑO INTERIOR, y es a propósito.
           *
           * "Asociadas" son cuentas de hijos y/o pareja: la parte de hijos es
           * **Cuentas Junior**, que la constitución del workspace lista como
           * stop condition —no se diseña ni implementa antes de un acta propia
           * ratificada—, y compartir tarjeta con la pareja es un instrumento de
           * pago compartido que toca los rieles de dinero de App Backend.
           *
           * Lo único permitido es que la pestaña EXISTA con un estado honesto.
           * Nada de filas, avatares, importes ni copy que describa la relación:
           * *"una pantalla que ya existe es mucho más difícil de discutir que
           * una que todavía no"*.
           */}
          {/* AF-VIAJES · D242 · 1a/1b: Abiertos y Cerrados, o el vacío. */}
          {tab === 'viajes' && (
            <PanelViajes conteo={conteoViajes} elegida={listaDeViajes} onElegir={elegirListaDeViajes} onReintentar={reintentarViajes} />
          )}

          {tab === 'asociadas' && (
            <div className="launch-stack home-tab-panel home-tab-panel-empty">
              <div className="state-unknown">
                <Icon name="info" size={20} />
                <div>
                  <div className="state-unknown-title">{t('Todavía no está disponible')}</div>
                </div>
              </div>
            </div>
          )}
        </MountedCard>
        {tab === 'viajes' && <FilaCrearViaje conteo={conteoViajes} />}
        {/* D246 · la lista elegida, debajo de «Crear viaje». */}
        {tab === 'viajes' && <ListaDeInicio conteo={conteoViajes} elegida={listaDeViajes} />}
        {/* Decisión 109 · la invitación pendiente, arriba de todo lo que sigue a
            las pestañas (la tarjeta montada va enganchada a ellas y no se
            separa). Sin invitaciones no dibuja nada. */}
        <InvitacionEnInicio />
        <FriendAvatarNotice />
        {/* D176 · la guía «Agregar a inicio», la primera vez y sólo en Safari de iOS. */}
        <AvisoAgregarAInicio />

        {/* ─── La burbuja de la mesa. Va DEBAJO de los accesos, no arriba. ─── */}
        <section className="home-mesa" aria-label={t('Tu mesa abierta')}>
          {mesasFallaron ? (
            /* Error de red: borde SÓLIDO --danger + nube tachada + Reintentar.
               Las pestañas de arriba siguen funcionando (§1.1). */
            <div className="state-error">
              <div className="state-error-row">
                <Icon name="x-circle" size={22} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="state-error-title">{t('No pudimos cargar tu mesa')}</div>
                  <p className="state-error-body">{t('Revisa la conexión y prueba de nuevo.')}</p>
                </div>
              </div>
              {/* La salida es OBLIGATORIA: un estado que congela sin acción
                  visible es un defecto de diseño, no una medida de seguridad. */}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void cargarMesas(true)}>
                {t('Reintentar')}
              </button>
            </div>
          ) : openMesas === null ? (
            /* D237 · cargando. Mati, en su video: la silueta de una tarjeta de
               mesa «prometía» una mesa y después decía «No tienes mesas
               abiertas». Ahora, nada durante 300 ms (lo habitual es que llegue
               antes) y, si tarda, una línea neutra que no dice si hay mesa. */
            esperaMesaVisible ? (
              <div className="sk-neutro" aria-busy="true" aria-label={t('Cargando tu mesa')}>
                <span className="sk-line w55" />
              </div>
            ) : null
          ) : porUrgencia.length > 0 ? (
            /* D181 · Mati: «cuando hay más de una mesa que hayan varias burbujas, una
               por cada mesa, no me gusta que tengas que poner +1 mesa abierta más y
               el mensaje que salta». Una tarjeta por mesa, la de siempre, en orden
               de vencimiento. Con una sola, exactamente como antes. */
            <div className="home-mesas">
              {porUrgencia.map((mesa) => {
                const cuenta = countdownLong(mesa.expires_at);
                return (
                  <button key={mesa.code} type="button" className="mesa-card" onClick={() => navigate('mesa', mesa.code)}>
                    <div className="mesa-top">
                      <span className="mesa-kicker">{t('Tu mesa abierta')}</span>
                      {/* Teal siempre: el naranja tiene una lista cerrada de cuatro
                          usos permitidos y un badge de estado no es ninguno. */}
                      <span className="badge badge-teal">
                        {etiquetaPersonal(mesa, t) ?? t(mesaStatusLabel(mesa.status))}
                      </span>
                    </div>
                    <div className="mesa-name">{mesa.restaurant.name}</div>
                    {/* G-27 · cerrado por el dueño v2.93.0 (`participants_count`). */}
                    <div className="mesa-meta">{lineaDeMesa(mesa, t)}</div>
                    {/* G-34 · lo que pagó ESTA cuenta, sólo junto a su etiqueta
                        personal. Nunca lo de otro. */}
                    {pagadoPropioCentavos(mesa) !== null && (
                      <div className="mesa-meta">{t('Pagaste {0}', formatMXN(pagadoPropioCentavos(mesa)!))}</div>
                    )}

                    {/* La jerarquía dice "cuánto falta", no "cuánto es": el monto en
                        --fs-h1 tabular, el total en --fs-body muted.
                        Decisión 76 de Mati: con el dato del dueño (v2.134.0) se
                        muestra lo ELEGIDO, la misma cifra que dentro de la mesa;
                        sin él, lo pagado, como antes. Lo pagado se suma cuando se
                        enciendan los pagos (orden futura). */}
                    <div className="mesa-money">
                      <span className="mesa-paid">{formatMXN(avanceDeMesa(mesa).cents)}</span>
                      <span className="mesa-total">{t('de')} {formatMXN(mesa.total_cents)}</span>
                    </div>
                    {/* La barra NUNCA va sola: los dos importes de arriba son el dato,
                        esto es el refuerzo. Por eso es aria-hidden. */}
                    <div className="mesa-bar" aria-hidden="true">
                      <span style={{ width: `${avanceDeMesa(mesa).percent}%` }} />
                    </div>

                    <div className="mesa-foot">
                      {cuenta && (
                        <span className={`mesa-cd ${cuenta.urgent ? 'urgent' : ''}`}>
                          <Icon name="clock" size={15} className="ico-inline" /> {t('Vence en')} {cuenta.text}
                        </span>
                      )}
                      <span className="mesa-go">{t('Ver mesa →')}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            /* Vacío REAL: sin borde —es el único estado que no lo lleva— y sin
               botón propio. La acción ya está en el círculo naranja de la barra,
               a un centímetro: duplicarla sería competirle. */
            /* D246 · con la pestaña Viajes, el vacío de mesas no se muestra. */
            tab !== 'viajes' && (
              <div className="mesa-empty">
                <div className="mesa-empty-title">{t('No tienes mesas abiertas')}</div>
                <p className="mesa-empty-body">{t('Toca el + para abrir una')}</p>
              </div>
            )
          )}
        </section>

        {/* ══════════════════════════════════════════════════════════════════
            RIEL DE SALDO · DURMIENTE. Los DOS bloques de abajo están gateados
            por la capability del BACKEND y hoy no renderizan nada.

            Se conservan a propósito, y el rediseño no los tocó: el gate cumple
            "cero UI" y el código durmiente cumple "no se borra". Reactivar el
            riel exige gate IFPE, auditoría y ratificación nueva — una orden,
            jamás una variable de entorno. Quien reescriba esta pantalla otra
            vez: son dos, no uno.
            ══════════════════════════════════════════════════════════════════ */}
        {walletRailEnabled && (
          <div className="saldo-card">
            <div className="lbl">Tu saldo PayMe</div>
            <div className="saldo-row">
              {/* G-03 (v2.21): tras el ojito se muestra el DISPONIBLE real. */}
              <div className="saldo-amt">
                {showBalance ? (balance ? formatMXN(balance.available_cents) : '…') : masked}
              </div>
              <button
                className="eye-btn"
                onClick={() => setShowBalance((v) => !v)}
                aria-label={showBalance ? 'Ocultar saldo' : 'Mostrar saldo'}
                aria-pressed={showBalance}
              >
                <Icon name={showBalance ? 'eye-off' : 'eye'} size={18} className="ico-inline" />
              </button>
              <button className="saldo-arrow" onClick={() => navigate('cuenta')} aria-label={t('Ir a Cuenta')}>
                →
              </button>
            </div>
            <div className="saldo-actions">
              <button className="btn btn-teal btn-sm" onClick={() => navigate('cargar')}>
                <Icon name="plus" size={16} className="ico-inline" /> Cargar
              </button>
              <button
                className="btn btn-sm"
                style={{ background: 'rgba(255,255,255,0.18)', color: '#fff' }}
                onClick={() => navigate('transferir')}
              >
                <Icon name="arrow-up-right" size={16} className="ico-inline" /> Transferir
              </button>
            </div>
          </div>
        )}

        {walletRailEnabled && txs && txs.length > 0 && (
          <>
            <div className="sect-row">
              <div className="sect-title">Últimos movimientos</div>
              <button className="vermas" onClick={() => navigate('cuenta')}>
                {t('Ver más')}
              </button>
            </div>
            <div className="card" style={{ padding: '2px 16px' }}>
              {txs.map((tx, idx) => (
                <div
                  key={tx.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '11px 0',
                    borderBottom: idx < txs.length - 1 ? '1px solid var(--gray-l)' : 'none',
                  }}
                >
                  <span style={{ color: 'var(--gray-txt)' }} aria-hidden="true">
                    <Icon name={walletTxIcon(tx.type)} size={20} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 'var(--fs-legacy-base)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {tx.description ?? walletTxLabel(tx.type)}
                    </div>
                    <div className="caption">{txDate(tx.date, locale, t)}</div>
                  </div>
                  {/* El monto respeta el mismo ojito que el saldo. */}
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 'var(--fs-legacy-base)',
                      fontVariantNumeric: 'tabular-nums',
                      color: showBalance ? (tx.sign === 'credit' ? 'var(--green)' : 'var(--red)') : 'var(--gray-txt)',
                    }}
                  >
                    {showBalance
                      ? `${tx.sign === 'credit' ? '+' : '−'}${formatMXN(Math.abs(tx.amount_cents))}`
                      : masked}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <AppBottomBar active="home" />

    </div>
  );
}
