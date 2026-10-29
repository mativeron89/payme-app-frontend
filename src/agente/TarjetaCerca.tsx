import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import {
  enlaceDeAtribucion, pedirUbicacion, PARAM_TARJETA_CERCA,
  type Cerca, type LugarCerca, type ParaVos, type ResultadoDeUbicacion, type Ubicacion,
} from '../api/agente';
import { extractApiError } from '../api/errors';
import { Icon } from '../components/Icon';
import { useIdioma } from '../i18n/idioma';
import { useRoute } from '../router';
import { nombreDeCocina } from '../utils/textosDeEstadisticas';
import { nombreDePlato } from '../utils/nombreDePlato';
import { useAgente } from './useAgente';
import './agente.css';

type T = (s: string, ...a: unknown[]) => string;

/** «250 m», «1.5 km». La distancia ya viene redondeada a 50 m por el dueño. */
export function textoDeDistancia(metros: number, locale: string): string {
  if (metros < 1000) return `${metros} m`;
  return `${(metros / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })} km`;
}

/** «★ 4.6 · 7»: el promedio con un decimal y cuántas cuentas lo dieron, y su nombre accesible. */
export function textoDeEstrellas(promedio: number, cuentas: number, locale: string, t: T): { readonly visible: string; readonly accesible: string } {
  const p = promedio.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return { visible: `${p} · ${cuentas}`, accesible: t('{0} estrellas en PayMe, de {1} personas', p, cuentas) };
}

export type Busqueda =
  | { readonly fase: 'quieta' }
  | { readonly fase: 'ubicando' }
  | { readonly fase: 'buscando' }
  | { readonly fase: 'lista'; readonly cerca: Cerca }
  | { readonly fase: 'negada' }
  | { readonly fase: 'sin_ubicacion' }
  | { readonly fase: 'demasiadas' }
  | { readonly fase: 'error' };

/** O3 del PR #95 · el 429 del dueño (`too_many_requests`, el límite por cuenta de 2.208.1) tiene su propio texto. */
export function faseDeErrorDeCerca(err: unknown): 'demasiadas' | 'error' {
  return extractApiError(err).status === 429 ? 'demasiadas' : 'error';
}

/**
 * Una búsqueda de «cerca», de punta a punta. O2 del PR #109: `vigente()` es la MISMA época que reinicia la tarjeta al
 * cambiar de cuenta (como el presupuesto y la calificación): si la sesión cambió mientras se esperaba la ubicación o
 * el POST, el resultado de la cuenta anterior se descarta y no se pone nada.
 */
export async function buscarCerca(paso: {
  readonly pedir: () => Promise<ResultadoDeUbicacion>;
  readonly postear: (u: Ubicacion) => Promise<Cerca>;
  readonly vigente: () => boolean;
  readonly poner: (b: Busqueda) => void;
}): Promise<void> {
  const poner = (b: Busqueda) => { if (paso.vigente()) paso.poner(b); };
  poner({ fase: 'ubicando' });
  const r = await paso.pedir();
  if (!paso.vigente()) return;
  if (r.tipo === 'negada') { poner({ fase: 'negada' }); return; }
  if (r.tipo === 'no_disponible') { poner({ fase: 'sin_ubicacion' }); return; }
  poner({ fase: 'buscando' });
  try {
    const cerca = await paso.postear(r.ubicacion);
    poner({ fase: 'lista', cerca });
  } catch (err) {
    poner({ fase: faseDeErrorDeCerca(err) });
  }
}

/**
 * D550/D554 · R-1 a, R-4 a, R-7 a · «Lo de siempre, cerca», la tarjeta de Inicio.
 *
 * - Aparece sólo con la función encendida en el dueño Y el permiso `recomendaciones` otorgado (el 403 del dueño la
 *   esconde) Y algún plato tuyo (3 visitas o más): sin eso, nada; ni un hueco ni un cartel.
 * - 🔴 La ubicación se pide SÓLO al tocar «Ver lugares cerca» y no se guarda: la pide `pedirUbicacion`, que la
 *   redondea, y viaja directo al POST. Lo que queda en la pantalla es la respuesta del dueño, sin coordenadas.
 * - Hasta 10 lugares (el dueño), con nombre, cocina, distancia, nivel («Se pide en PayMe» o «Probable») y las
 *   estrellas propias de PayMe si hay 3 personas o más. Siempre con la atribución de las fuentes.
 * - El aviso «Es tu hora» de la campana trae a `/home/cerca`: la tarjeta se pone a la vista y recibe el foco.
 */
export function TarjetaCerca() {
  const { t, locale } = useIdioma();
  const { estado, session } = useAgente();
  const route = useRoute();
  const [paraVos, setParaVos] = useState<ParaVos | null>(null);
  const [busqueda, setBusqueda] = useState<Busqueda>({ fase: 'quieta' });
  const titulo = useRef<HTMLHeadingElement | null>(null);
  const tarjeta = useRef<HTMLElement | null>(null);
  const encendida = estado?.recomendaciones === true && session !== null;
  const cuenta = session ? `${session.family_id}:${session.principal_id}` : null;
  const sesionRef = useRef(session);
  sesionRef.current = session;
  const epoca = useRef(0);

  useEffect(() => {
    ++epoca.current;
    setParaVos(null);
    setBusqueda({ fase: 'quieta' });
    const s = sesionRef.current;
    if (!encendida || !s) return undefined;
    let vigente = true;
    // 403 (sin el permiso), 404 (apagada), forma rara o red: la tarjeta no se muestra.
    api.getParaVos(s).then((r) => { if (vigente) setParaVos(r); }, () => undefined);
    return () => { vigente = false; };
  }, [encendida, cuenta]);

  const visible = paraVos !== null && paraVos.platos.length > 0;
  const pideLaTarjeta = route.page === 'home' && route.param === PARAM_TARJETA_CERCA;
  useEffect(() => {
    if (!visible || !pideLaTarjeta) return;
    tarjeta.current?.scrollIntoView?.({ block: 'start' });
    titulo.current?.focus({ preventScroll: true });
  }, [visible, pideLaTarjeta]);

  if (!visible) return null;

  async function buscar() {
    const s = sesionRef.current;
    if (!s || busqueda.fase === 'ubicando' || busqueda.fase === 'buscando') return;
    const marca = epoca.current;
    await buscarCerca({
      pedir: () => pedirUbicacion(),
      postear: (u) => api.postCerca(u, s),
      vigente: () => marca === epoca.current,
      poner: setBusqueda,
    });
  }

  const ocupada = busqueda.fase === 'ubicando' || busqueda.fase === 'buscando';
  const platos = paraVos.platos.map((p) => nombreDePlato(p.nombre)).join(' · ');
  return (
    <section ref={tarjeta} id="tarjeta-cerca" className="agente-cerca" aria-labelledby="agente-cerca-titulo" aria-busy={ocupada}>
      <div className="agente-cerca-cabeza">
        <span className="agente-cerca-cuadro" aria-hidden="true"><Icon name="pin" size={24} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 ref={titulo} id="agente-cerca-titulo" className="agente-cerca-titulo" tabIndex={-1}>{t('Lo de siempre, cerca')}</h2>
          <p className="agente-cerca-platos">{platos}</p>
        </div>
      </div>
      {paraVos.esTuHora && <span className="agente-cerca-hora">{t('Es tu hora')}</span>}
      {busqueda.fase !== 'lista' && (
        <button type="button" className="btn btn-navy agente-cerca-ver" onClick={() => void buscar()} disabled={ocupada}>
          {busqueda.fase === 'ubicando' ? t('Buscando dónde estás…')
            : busqueda.fase === 'buscando' ? t('Buscando lugares…') : t('Ver lugares cerca')}
        </button>
      )}
      {busqueda.fase === 'quieta' && (
        <p className="agente-cerca-nota">{t('Usamos tu ubicación sólo en este momento. No la guardamos.')}</p>
      )}
      {busqueda.fase === 'negada' && (
        <p className="agente-cerca-nota" role="status">{t('Para ver lugares cerca, permite la ubicación en tu navegador.')}</p>
      )}
      {busqueda.fase === 'sin_ubicacion' && (
        <p className="agente-cerca-nota" role="status">{t('No pudimos saber dónde estás. Prueba de nuevo.')}</p>
      )}
      {busqueda.fase === 'demasiadas' && (
        <p className="agente-cerca-nota" role="status">{t('Hiciste muchas búsquedas seguidas. Prueba en un rato.')}</p>
      )}
      {busqueda.fase === 'error' && (
        <p className="agente-cerca-nota" role="status">{t('No pudimos buscar lugares. Prueba de nuevo.')}</p>
      )}
      {busqueda.fase === 'lista' && (
        <>
          <ListaCerca cerca={busqueda.cerca} t={t} locale={locale} />
          {/* O3 del PR #109 · repetir la búsqueda sin recargar ni salir de Inicio. Pide la ubicación de nuevo. */}
          <button type="button" className="btn btn-ghost agente-cerca-de-nuevo" onClick={() => void buscar()}>
            {t('Buscar de nuevo')}
          </button>
        </>
      )}
    </section>
  );
}

function ListaCerca({ cerca, t, locale }: { readonly cerca: Cerca; readonly t: T; readonly locale: string }) {
  const conLugares = cerca.platos.filter((p) => p.lugares.length > 0);
  return (
    <>
      {conLugares.length === 0 ? (
        <p className="agente-cerca-nota" role="status">{t('No encontramos lugares cerca para lo de siempre.')}</p>
      ) : (
        <>
          {cerca.radioM === 3000 && <p className="agente-cerca-nota">{t('No había nada a 1 km: te mostramos hasta 3 km.')}</p>}
          {conLugares.map((p) => (
            <div key={p.nombre}>
              <h3 className="agente-cerca-plato">{nombreDePlato(p.nombre)}</h3>
              <ul className="agente-cerca-lista">
                {p.lugares.map((l) => <FilaDeLugar key={l.ref} lugar={l} t={t} locale={locale} />)}
              </ul>
            </div>
          ))}
        </>
      )}
      <Atribucion textos={cerca.atribucion.textos} urls={cerca.atribucion.urls} />
    </>
  );
}

function FilaDeLugar({ lugar, t, locale }: { readonly lugar: LugarCerca; readonly t: T; readonly locale: string }) {
  const cocina = nombreDeCocina(lugar.cocina, t);
  const estrellas = lugar.estrellas && textoDeEstrellas(lugar.estrellas.promedio, lugar.estrellas.cuentas, locale, t);
  return (
    <li className="agente-lugar">
      <div className="agente-lugar-datos">
        <div className="agente-lugar-nombre">{lugar.nombre}</div>
        <div className="agente-lugar-meta">
          {[cocina, textoDeDistancia(lugar.distanciaM, locale)].filter(Boolean).join(' · ')}
        </div>
      </div>
      <div className="agente-lugar-lado">
        <span className={`agente-nivel agente-nivel--${lugar.nivel}`}>
          {lugar.nivel === 'confirmado' ? t('Se pide en PayMe') : t('Probable')}
        </span>
        {estrellas && (
          <span className="agente-estrellas" role="img" aria-label={estrellas.accesible}>
            <Icon name="star-fill" size={14} />{estrellas.visible}
          </span>
        )}
      </div>
    </li>
  );
}

/** Las fuentes del catálogo, siempre (contrato): cada texto con su enlace, si es `https:`. */
function Atribucion({ textos, urls }: { readonly textos: readonly string[]; readonly urls: readonly string[] }) {
  if (textos.length === 0) return null;
  return (
    <p className="agente-atribucion">
      {textos.map((texto, i) => {
        const href = enlaceDeAtribucion(urls[i]);
        return (
          <span key={texto}>
            {i > 0 && ' · '}
            {href ? <a href={href} target="_blank" rel="noreferrer">{texto}</a> : texto}
          </span>
        );
      })}
    </p>
  );
}
