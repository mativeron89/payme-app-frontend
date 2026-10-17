import type { CSSProperties, RefObject } from 'react';
import { Icon } from '../components/Icon';
import { useIdioma } from '../i18n/idioma';
import type { EtapaDelMapa, Paso } from './recorridoGuia';

/**
 * D341-M2 · la PRESENTACIÓN de la guía, separada del motor (`GuiaContenido`).
 * Recibe un estado visual ya resuelto y dibuja; no mide, no decide pasos y no
 * toca la app. El aspecto final lo define Claude Design: los estilos viven en
 * `guiaInteractiva.css`, con variables propias de la guía.
 *
 * Estados visuales que produce el motor:
 * - `completa`: mapa (sólo restaurante), contador, título, texto, nota, Atrás y
 *   el botón principal (Siguiente, Entendido o Terminar guía);
 * - `achicada`: la línea «Tu turno: toca X», que vuelve a abrir la burbuja;
 * - `fuera`: cualquiera de las dos sin resaltado, con «Está más abajo/arriba» y Mostrar;
 * - `espera`: completa sin botones de avance.
 * Con una ventana encima la capa entera se oculta (`hidden`): no hay estado visible.
 */
export type Primario = 'siguiente' | 'entendido' | 'terminar';

export interface VistaDeGuia {
  readonly forma: 'completa' | 'achicada';
  readonly paso: Paso;
  readonly etapa: EtapaDelMapa | null;
  readonly conPagar: boolean;
  readonly numero: number;
  readonly total: number;
  readonly fuera: 'arriba' | 'abajo' | null;
  readonly primario: Primario | null;
  readonly atras: boolean;
}

export interface BurbujaGuiaProps {
  readonly vista: VistaDeGuia;
  readonly lado: string;
  readonly estilo: CSSProperties;
  readonly noMostrar: boolean;
  readonly onNoMostrar: (valor: boolean) => void;
  readonly onCerrar: () => void;
  readonly onAtras: () => void;
  readonly onPrimario: () => void;
  readonly onAbrir: () => void;
  readonly onMostrar: () => void;
  readonly panelRef: RefObject<HTMLElement>;
  readonly tituloRef: RefObject<HTMLHeadingElement>;
  readonly chipRef: RefObject<HTMLButtonElement>;
}

type T = (s: string, ...args: unknown[]) => string;
function etapasDelMapa(t: T, conPagar: boolean): readonly (readonly [EtapaDelMapa, string])[] {
  const base: (readonly [EtapaDelMapa, string])[] = [
    ['foto', t('Foto')], ['dividir', t('Dividir')], ['invitar', t('Invitar')], ['elegir', t('Elegir')],
  ];
  return conPagar ? [...base, ['pagar', t('Pagar')]] : base;
}

function MapaDeGuia({ etapa, conPagar }: { etapa: EtapaDelMapa; conPagar: boolean }) {
  const { t } = useIdioma();
  const etapas = etapasDelMapa(t, conPagar);
  return <ol className="guia-mapa" aria-label={t('Recorrido de la guía')}>
    {etapas.map(([id, nombre], i) => <li key={id} className={id === etapa ? 'guia-mapa-actual' : undefined} aria-current={id === etapa ? 'step' : undefined}>
      {i > 0 && <span className="guia-mapa-flecha" aria-hidden="true">→</span>}{nombre}
    </li>)}
  </ol>;
}

function Cerrar({ onCerrar }: { onCerrar: () => void }) {
  const { t } = useIdioma();
  return <button type="button" className="guia-cerrar" onClick={onCerrar} aria-label={t('Cerrar guía')}><Icon name="x" size={18} /></button>;
}

function Fuera({ fuera, onMostrar }: { fuera: 'arriba' | 'abajo'; onMostrar: () => void }) {
  const { t } = useIdioma();
  return <p className="guia-fuera">
    <span>{fuera === 'abajo' ? t('Está más abajo') : t('Está más arriba')}</span>
    <button type="button" className="guia-mostrar" onClick={onMostrar}>{t('Mostrar')}</button>
  </p>;
}

export function BurbujaGuia(p: BurbujaGuiaProps) {
  const { t } = useIdioma();
  const { vista } = p;
  const { paso } = vista;
  if (vista.forma === 'achicada') {
    return <section ref={p.panelRef} className="guia-burbuja guia-achicada" role="region" aria-label={t('Guía interactiva')} data-paso={paso.id} data-lado={p.lado} style={p.estilo}>
      <button ref={p.chipRef} type="button" className="guia-chip" aria-expanded={false} onClick={p.onAbrir}>{paso.chip ?? paso.titulo}</button>
      {vista.fuera && <button type="button" className="guia-mostrar" onClick={p.onMostrar}>{t('Mostrar')}</button>}
      <Cerrar onCerrar={p.onCerrar} />
    </section>;
  }
  const principal = vista.primario === 'siguiente' ? t('Siguiente') : vista.primario === 'entendido' ? t('Entendido') : t('Terminar guía');
  return <section ref={p.panelRef} className="guia-burbuja" role="region" aria-label={t('Guía interactiva')} data-paso={paso.id} data-lado={p.lado} data-tipo={paso.tipo} style={p.estilo}>
    <div className="guia-cabeza">
      <span className="guia-progreso">{vista.total > 1 ? t('{0} de {1}', vista.numero, vista.total) : null}</span>
      <label className="guia-preferencia"><input type="checkbox" checked={p.noMostrar} onChange={(e) => p.onNoMostrar(e.currentTarget.checked)} /><span>{t('No volver a mostrar')}</span></label>
      <Cerrar onCerrar={p.onCerrar} />
    </div>
    {vista.etapa && <MapaDeGuia etapa={vista.etapa} conPagar={vista.conPagar} />}
    <div className="guia-cuerpo" aria-live="polite" aria-atomic="true">
      <h2 ref={p.tituloRef} tabIndex={-1}>{paso.titulo}</h2>
      <p id="guia-explicacion">{paso.texto}</p>
      {paso.nota && <p className="guia-nota">{paso.nota}</p>}
    </div>
    {vista.fuera && <Fuera fuera={vista.fuera} onMostrar={p.onMostrar} />}
    {vista.primario && <div className="guia-acciones">
      <button type="button" disabled={!vista.atras} onClick={p.onAtras}>{t('Atrás')}</button>
      <button type="button" className="guia-siguiente" onClick={p.onPrimario}>{principal}</button>
    </div>}
  </section>;
}

/** El resaltado del control real. Decorativo: el control conserva su nombre y su foco. */
export function FocoGuia({ caja, objetivo, ancla }: { caja: { left: number; top: number; width: number; height: number }; objetivo: string; ancla: string }) {
  return <div className="guia-foco" aria-hidden="true" data-objetivo={objetivo} data-ancla={ancla} style={caja} />;
}
