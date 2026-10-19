import type { ReactNode } from 'react';
import { CuadroDeTarjeta, FilaDeTitulo, type IconoDeLaInvitacion, type IconoDeTarjeta } from './TarjetaDeTitulo';

/**
 * D372 · la tarjeta de «Te invitaron a una mesa» (diseño base de Claude Design,
 * con las resoluciones de V). Una sola tarjeta para los diez estados: reemplaza
 * a la burbuja de 240, al `.join-banner` de B y al pie con botones.
 *
 * - Va sobre `.title-card` y `FilaDeTitulo` (D285): el cuadro a la izquierda y
 *   el título al lado, a 14; relleno 16/18; `--sh-mounted`.
 * - El título es el único `<h1>` de la pantalla (ni la banda ni el formulario
 *   tienen uno).
 * - El cuerpo, el restaurante (sólo en D, si llegó) y las acciones van ADENTRO;
 *   la nota de E3 («Tu cuenta ya está lista…») va AFUERA: es otra información.
 * - `suelta` (B, D374): sin banda propia ni el montaje de −42, arriba del
 *   formulario, que no cambia.
 * - No sabe nada de la mesa: lo que muestra lo decide la pantalla, que antes
 *   del canje no tiene de dónde sacarlo (privacidad, sin cambios).
 */
export type CuadroDeLink =
  | { readonly icono: IconoDeTarjeta | IconoDeLaInvitacion; readonly exito?: boolean }
  /** C · el aro de espera; el texto es el nombre del progressbar. */
  | { readonly aro: string };

/**
 * C · el aro dentro del cuadro navy. A diferencia del cuadro de siempre, NO es
 * `aria-hidden`: el progressbar tiene que oírse.
 */
export function CuadroDeEspera({ etiqueta }: { readonly etiqueta: string }) {
  return (
    <span className="title-card-cuadro" data-icono="aro">
      <span className="link-aro" role="progressbar" aria-label={etiqueta} />
    </span>
  );
}

export function TarjetaDeLink({ cuadro, titulo, cuerpo, restaurante, nota, suelta = false, children }: {
  readonly cuadro: CuadroDeLink;
  readonly titulo: string;
  readonly cuerpo?: string;
  readonly restaurante?: string | null;
  readonly nota?: string;
  readonly suelta?: boolean;
  readonly children?: ReactNode;
}) {
  const esperando = 'aro' in cuadro;
  return (
    <>
      <section className={suelta ? 'title-card title-card--suelta' : 'title-card'} aria-busy={esperando || undefined}>
        <FilaDeTitulo
          cuadro={'aro' in cuadro
            ? <CuadroDeEspera etiqueta={cuadro.aro} />
            : <CuadroDeTarjeta icono={cuadro.icono} exito={cuadro.exito ?? false} />}
        >
          <h1 className="title-card-title">{titulo}</h1>
        </FilaDeTitulo>
        {restaurante ? <p className="link-restaurante">{restaurante}</p> : null}
        {cuerpo ? <p className="link-cuerpo">{cuerpo}</p> : null}
        {children ? <div className="link-acciones">{children}</div> : null}
      </section>
      {nota ? <p className="link-nota">{nota}</p> : null}
    </>
  );
}
