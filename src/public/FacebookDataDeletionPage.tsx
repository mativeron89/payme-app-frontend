import { useEffect, useState } from 'react';
import { leerEstadoEliminacion } from '../api/publicLegal';

/**
 * `/facebook-data-deletion/<confirmation_code>` · el estado humano de una
 * solicitud de eliminación de datos.
 *
 * ## El código entra, y no sale
 *
 * El `confirmation_code` viaja en la URL porque así lo fija el contrato de
 * Meta. De ahí en adelante es de un solo uso: llega como prop, se le pasa al
 * cliente público y **no aparece en ninguna otra parte** — ni en el DOM, ni en
 * el `<title>`, ni en un `aria-label`, ni en un log, ni en un mensaje de error,
 * ni en el cuerpo de otra request.
 *
 * 🔴 **Eso es una propiedad de la estructura, no una promesa.** `EstadoBorrado`
 * es una unión cerrada de cinco variantes y **ninguna transporta el código**:
 * la vista literalmente no lo recibe, así que no hay camino por el que pueda
 * pintarlo. Un censo de DOM en Playwright lo verifica igual desde afuera, sobre
 * la página servida — la estructura explica por qué pasa, el censo prueba que
 * pasa.
 *
 * ## Un 200 no dice «completada»
 *
 * Sólo `{status:'completed'}` exacto muestra *Completada*. Cualquier otra cosa
 * con 200 —otra clave, otro valor, un objeto de más— cae en *No verificable*.
 * Decirle a alguien que sus datos se borraron cuando no se sabe es el peor
 * error posible de esta pantalla, y es el que un 200 mal leído produce.
 *
 * ## Sin botón de reintento, y sin dejar a nadie sin salida
 *
 * La orden reserva el retry manual para la lectura pública del aviso. Acá el
 * estado *No verificable* dice qué hacer —volver a cargar más tarde— en vez de
 * ofrecer un control que la orden no pidió, y en vez de quedarse mudo, que es
 * la otra forma de dejar a alguien golpeando una puerta cerrada.
 */

export type EstadoBorrado =
  | { readonly fase: 'cargando' }
  | { readonly fase: 'pendiente' }
  | { readonly fase: 'completada' }
  | { readonly fase: 'no-encontrada' }
  | { readonly fase: 'no-verificable' };

export function FacebookDataDeletionView(
  { estado }: { readonly estado: EstadoBorrado },
): JSX.Element {
  return (
    <section className="pub-doc" aria-labelledby="pub-titulo">
      <h1 id="pub-titulo" className="pub-h1">Eliminación de datos</h1>
      <p className="pub-meta">Estado de tu solicitud de eliminación de datos en PayMe.</p>

      <div className="pub-estado" aria-live="polite">
        {estado.fase === 'cargando' && (
          <p className="pub-nota">Consultando el estado de la solicitud…</p>
        )}

        {estado.fase === 'pendiente' && (
          <div className="pub-aviso pub-aviso-espera">
            <p className="pub-badge">Pendiente</p>
            <p className="pub-nota">
              Recibimos tu solicitud y todavía la estamos procesando. Vuelve a
              cargar esta página más tarde para ver si ya terminó.
            </p>
          </div>
        )}

        {estado.fase === 'completada' && (
          <div className="pub-aviso pub-aviso-ok">
            <p className="pub-badge">Completada</p>
            <p className="pub-nota">
              La eliminación de tus datos se completó.
            </p>
          </div>
        )}

        {estado.fase === 'no-encontrada' && (
          <div className="pub-aviso pub-aviso-alerta">
            <p className="pub-badge">No encontrada</p>
            <p className="pub-nota">
              No encontramos una solicitud que corresponda a este enlace.
              Revisa que sea el enlace completo que recibiste.
            </p>
          </div>
        )}

        {estado.fase === 'no-verificable' && (
          <div className="pub-aviso pub-aviso-alerta">
            <p className="pub-badge">No verificable</p>
            <p className="pub-nota">
              No pudimos consultar el estado en este momento. No afirmamos nada
              sobre tu solicitud sin poder verificarlo: vuelve a cargar esta
              página en unos minutos.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

export function FacebookDataDeletionPage(
  { code }: { readonly code: string | null },
): JSX.Element {
  const [estado, setEstado] = useState<EstadoBorrado>(
    // 🔴 El estado inicial ya adjudica el path inválido: sin código consultable
    // no se monta «cargando», porque no se va a consultar nada. Un «cargando»
    // que nunca consulta es un spinner mintiendo.
    code === null ? { fase: 'no-encontrada' } : { fase: 'cargando' },
  );

  useEffect(() => {
    if (code === null) return;
    let vivo = true;
    void leerEstadoEliminacion(code).then((r) => {
      if (!vivo) return;
      setEstado(
        r.estado === 'pendiente' ? { fase: 'pendiente' }
          : r.estado === 'completada' ? { fase: 'completada' }
            : r.estado === 'no-encontrada' ? { fase: 'no-encontrada' }
              : { fase: 'no-verificable' },
      );
    });
    return () => { vivo = false; };
  }, [code]);

  return <FacebookDataDeletionView estado={estado} />;
}
