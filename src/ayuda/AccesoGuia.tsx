import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icon';
import { useIdioma } from '../i18n/idioma';
import { almacenDeGuia, preferenciaGuia } from './preferenciaGuia';
import type { GuiaContenidoProps } from './GuiaContenido';
import './ayuda.css';

/** Sólo se monta en Inicio y Más, después de las puertas de sesión existentes. */
export function AccesoGuia({ lugar }: { lugar: 'inicio' | 'ayuda' }) {
  const { session } = useAuth();
  if (!session) return null;
  return <AccesoDeCuenta key={`${session.principal_id}:${session.family_id}`} principal={session.principal_id} lugar={lugar} />;
}

function AccesoDeCuenta({ principal, lugar }: { principal: string; lugar: 'inicio' | 'ayuda' }) {
  const { t } = useIdioma();
  const [vista, setVista] = useState<boolean | null>(null);
  const [abierta, setAbierta] = useState(false);
  const [Contenido, setContenido] = useState<ComponentType<GuiaContenidoProps> | null>(null);
  const [fallo, setFallo] = useState(false);
  const boton = useRef<HTMLButtonElement>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    let vigente = true;
    void preferenciaGuia.vista(principal, almacenDeGuia()).then((v) => { if (vigente) setVista(v); });
    return () => { vigente = false; };
  }, [principal]);
  useLayoutEffect(() => {
    if (!abierta || !panel.current) return;
    // Sólo tras la apertura voluntaria. El foco por sí solo deja el título junto al pie,
    // y el contenido diferido aumenta el panel después: se coloca de nuevo al llegar.
    titulo.current?.focus({ preventScroll: true });
    const zona = panel.current.closest<HTMLElement>('.scroll');
    const cabecera = panel.current.querySelector<HTMLElement>('.guia-cabecera');
    if (!zona || !cabecera) return;
    const pantalla = panel.current.closest('.screen');
    const encabezado = pantalla?.querySelector('.hdr');
    const bordeVisible = Math.max(zona.getBoundingClientRect().top, encabezado?.getBoundingClientRect().bottom ?? 0);
    const pie = Math.min(window.innerHeight,
      pantalla?.querySelector('.appbar-block')?.getBoundingClientRect().top ?? window.innerHeight,
      pantalla?.querySelector('.appbar-fab')?.getBoundingClientRect().top ?? window.innerHeight);
    const cabeceraRect = cabecera.getBoundingClientRect();
    const opciones = panel.current.querySelector('.guia-recorridos')?.getBoundingClientRect();
    // En horizontal el espacio entre cabecera y cámara puede ser corto: el margen
    // se reduce sólo lo necesario para que el título y los tres recorridos entren.
    const altoInicial = (opciones?.bottom ?? cabeceraRect.bottom) - cabeceraRect.top;
    // Un píxel de reserva evita que el redondeo de scrollTop deje el borde bajo el pie.
    const aire = Math.max(0, Math.min(8, pie - bordeVisible - altoInicial - 1));
    // El contenedor usa scroll auto, sin animación; también con reduced-motion.
    zona.scrollTop += cabeceraRect.top - bordeVisible - aire;
  }, [abierta, Contenido]);

  function recordar() {
    setVista(true);
    void preferenciaGuia.marcar(principal, almacenDeGuia());
  }
  function devolverFoco() {
    requestAnimationFrame(() => {
      if (boton.current?.isConnected) boton.current.focus();
      else document.querySelector<HTMLButtonElement>('.appbar-center')?.focus();
    });
  }
  function cerrar() { recordar(); setAbierta(false); devolverFoco(); }
  function cargar() {
    setFallo(false);
    void import('./GuiaContenido').then((m) => setContenido(() => m.GuiaContenido)).catch(() => setFallo(true));
  }
  function abrir() { recordar(); setAbierta(true); if (!Contenido) cargar(); }

  if (lugar === 'inicio' && vista !== false && !abierta) return null;
  return (
    <section className={`ayuda-acceso ayuda-acceso--${lugar}`} aria-label={t('Ayuda')}>
      {lugar === 'ayuda' && <h2 className="ayuda-seccion">{t('Ayuda')}</h2>}
      {!abierta && (lugar === 'inicio' ? (
        <div className="guia-oferta">
          <p>{t('¿Primera vez? Conoce PayMe en un minuto.')}</p>
          <div className="guia-oferta-acciones">
            <button ref={boton} type="button" className="ayuda-enlace" onClick={abrir}>{t('Ver guía')}</button>
            <button type="button" className="ayuda-enlace ayuda-enlace--muted" aria-label={t('Ocultar guía por ahora')} onClick={() => { recordar(); devolverFoco(); }}>{t('Ahora no')}</button>
          </div>
        </div>
      ) : (
        <button ref={boton} type="button" className="list-row guia-fila" onClick={abrir}>
          <Icon name="info" size={18} />
          <span>{t('Cómo usar PayMe')}</span>
          <Icon name="arrow-right" size={16} />
        </button>
      ))}
      {abierta && (
        <section ref={panel} className="guia-panel" aria-labelledby="guia-titulo" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); cerrar(); } }}>
          <div className="guia-cabecera">
            <h2 ref={titulo} tabIndex={-1} id="guia-titulo">{t('Cómo usar PayMe')}</h2>
            <button type="button" className="guia-cerrar" aria-label={t('Cerrar guía')} onClick={cerrar}><Icon name="x" size={20} /></button>
          </div>
          <p className="guia-bajada">{t('Elige tu recorrido. Puedes cerrar cuando quieras.')}</p>
          {Contenido ? <Contenido /> : fallo ? (
            <div role="status"><p>{t('No pudimos abrir la guía. Puedes seguir usando PayMe.')}</p><button type="button" className="ayuda-enlace" onClick={cargar}>{t('Reintentar')}</button></div>
          ) : <p role="status">{t('Cargando…')}</p>}
          <button type="button" className="btn btn-navy" onClick={cerrar}>{t('Entendido')}</button>
          <p className="guia-reabrir">{t('La encuentras de nuevo en Más → Ayuda.')}</p>
        </section>
      )}
    </section>
  );
}
