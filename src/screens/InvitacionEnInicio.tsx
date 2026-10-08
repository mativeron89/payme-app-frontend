import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { olvidarLoDeMesas, ultimoVisto } from '../api/ultimoVisto';
import { api } from '../api';
import { extractApiError } from '../api/errors';
import { useToast } from '../components/ui';
import { FotoDeQuienInvita } from '../components/FotoDeQuienInvita';
import { PREFIJO_INVITADOR_DE_INVITACION, claveInvitadorDeInvitacion, fotosEnMemoria } from '../api/fotosEnMemoria';
import { loadSession } from '../api/storage';
import { useIdioma } from '../i18n/idioma';
import { navigate } from '../router';
import { relTime } from '../utils/format';
import { idsConFotoDeInvitacion, invitacionesMostrables, metaInvitacion, type InvitacionMostrable } from './invitacionAdmision';

/**
 * AF-INVITACION-INICIO · decisión 109 de Mati · la invitación a una mesa vuelve
 * a Inicio, como burbuja. Literal: «la invitación a la mesa tiene que aparecer
 * con una burbuja en el Inicio, no únicamente en notificaciones, tiene que ser
 * más sencillo y ahí ahorramos un click». Supersede el «No se duplica: se
 * saca» del 2026-08-05: desde ahora la invitación se ve en Inicio Y en Avisos.
 *
 * - **Qué se muestra:** la invitación pendiente más nueva que ADMITE entrar
 *   (`mesa_joinable: true`, decodificada por `invitacionAdmision.ts`: sólo
 *   `admite` deja el botón). El dueño ya las devuelve de la más nueva a la más
 *   vieja (`ORDER BY i.created_at DESC`, `routes/invitations.js`), así que es
 *   la primera que admite. Una de mesa cerrada o que no se pudo verificar NO
 *   aparece en Inicio: Avisos la sigue mostrando apagada.
 * - **«+N invitaciones más»** cuenta sólo las otras que admiten entrar y lleva
 *   a Avisos, donde están todas.
 * - **«Sumarme»** hace exactamente lo de Avisos: `aceptarInvitacion`, la misma
 *   función para las dos pantallas.
 * - **Estilo:** el de la burbuja de la mesa (`.mesa-card`, y `.mesa-card-group`
 *   con `.mesa-more` para la fila de «+N»), sin CSS nuevo.
 * - **Sin invitaciones** (o sin poder leerlas) no dibuja NADA: Inicio queda como
 *   estaba. Leer mal la lista no se anuncia: no hay nada que ofrecer.
 */

type Traductor = (s: string, ...a: unknown[]) => string;

/** La que va en la burbuja y cuántas más admiten entrar; `null` si ninguna. */
export function invitacionParaInicio(
  lista: readonly InvitacionMostrable[],
): { readonly principal: InvitacionMostrable; readonly mas: number } | null {
  const admiten = lista.filter((inv) => inv.admision === 'admite');
  const principal = admiten[0];
  return principal ? { principal, mas: admiten.length - 1 } : null;
}

/**
 * «+1 invitación más» / «+N invitaciones más». Dos claves, no un plural
 * inventado, como `etiquetaMasMesas`: la fila aparece justo cuando hay UNA más.
 * El `t` por defecto interpola, así los tests de esta función pura no
 * necesitan el idioma.
 */
export function etiquetaMasInvitaciones(
  n: number,
  t: Traductor = (s, ...a) => s.replace(/\{0\}/g, String(a[0])),
): string {
  return n === 1 ? t('+1 invitación más') : t('+{0} invitaciones más', n);
}

export interface DependenciasDeAceptar {
  readonly aceptar: (id: string) => Promise<unknown>;
  readonly avisar: (texto: string) => void;
  readonly t: Traductor;
  readonly entrarALaMesa: (code: string) => void;
  /** Vuelve a pedir la lista: tras un error, o si la invitación no trae código. */
  readonly recargar: () => void;
}

/**
 * Aceptar una invitación, para Avisos y para Inicio. Es lo que hacía Avisos,
 * sin cambios:
 * - acepta, avisa «Te sumaste a la mesa ✓» y entra a la mesa. Sin código no se
 *   navega a ciegas: se recarga y la lista se corrige sola;
 * - un error avisa y recarga. El 410 (la mesa murió entre el GET y el toque)
 *   tiene copy propia: el genérico diría «no pudimos» cuando lo que pasó es
 *   «ya no hay dónde».
 */
export async function aceptarInvitacion(inv: InvitacionMostrable, d: DependenciasDeAceptar): Promise<void> {
  try {
    await d.aceptar(inv.id);
    d.avisar(d.t('Te sumaste a la mesa ✓'));
    if (inv.mesaCode) d.entrarALaMesa(inv.mesaCode);
    else d.recargar();
  } catch (err) {
    const { status } = extractApiError(err);
    d.avisar(status === 410 ? d.t('Esta mesa ya cerró.') : d.t('No pudimos aceptar la invitación'));
    d.recargar();
  }
}

/** `aceptarInvitacion` con su estado de «Sumándote…», para las pantallas. */
export function useAceptarInvitacion(recargar: () => void): {
  readonly ocupada: string | null;
  readonly aceptar: (inv: InvitacionMostrable) => Promise<void>;
} {
  const { t } = useIdioma();
  const toast = useToast();
  const [ocupada, setOcupada] = useState<string | null>(null);
  async function aceptar(inv: InvitacionMostrable) {
    setOcupada(inv.id);
    // D237 · aceptar cambia las mesas y las invitaciones: lo guardado ya no vale.
    olvidarLoDeMesas();
    try {
      await aceptarInvitacion(inv, {
        aceptar: (id) => api.acceptInvitation(id),
        avisar: toast,
        t,
        entrarALaMesa: (code) => navigate('mesa', code),
        recargar,
      });
    } finally {
      setOcupada(null);
    }
  }
  return { ocupada, aceptar };
}

/** La burbuja, sin estado: la dibujan los tests tal cual. */
export function VistaInvitacionEnInicio({
  principal,
  mas,
  ocupada,
  onSumarme,
  onVerMas,
  t,
  foto,
}: {
  readonly principal: InvitacionMostrable;
  readonly mas: number;
  readonly ocupada: boolean;
  readonly onSumarme: () => void;
  readonly onVerMas: () => void;
  readonly t: Traductor;
  /**
   * E174-3B · la foto de quien invita, si el dueño dio la pista. Llega armada
   * desde `InvitacionEnInicio`: la vista sigue sin estado y sin sesión.
   */
  readonly foto?: ReactNode;
}) {
  const meta = metaInvitacion(principal, (iso) => relTime(iso, undefined, t), t);
  const tarjeta = (
    // No es un botón, como la de la mesa: adentro va «Sumarme». Sin el cursor
    // de mano de `.mesa-card`, que prometería que la burbuja entera se toca.
    <div className="mesa-card" style={{ cursor: 'auto' }} data-invitacion={principal.id}>
      <div className="mesa-top">
        {foto ? (
          <span className="mesa-top-quien">
            {foto}
            <span className="mesa-kicker">
              {principal.invitador ? t('{0} te invitó a', principal.invitador) : t('Te invitaron a una mesa')}
            </span>
          </span>
        ) : (
          <span className="mesa-kicker">
            {principal.invitador ? t('{0} te invitó a', principal.invitador) : t('Te invitaron a una mesa')}
          </span>
        )}
      </div>
      {principal.restaurante && <div className="mesa-name">{principal.restaurante}</div>}
      {meta && <div className="mesa-meta">{meta}</div>}
      {/* A la derecha y del ancho de su texto, como en Avisos; navy, no naranja. */}
      <div className="mesa-foot" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-navy btn-fit" onClick={onSumarme} disabled={ocupada}>
          {ocupada ? t('Sumándote…') : t('Sumarme')}
        </button>
      </div>
    </div>
  );
  return mas === 0 ? (
    tarjeta
  ) : (
    <div className="mesa-card-group">
      {tarjeta}
      <button type="button" className="mesa-more" onClick={onVerMas}>
        {etiquetaMasInvitaciones(mas, t)} <span aria-hidden="true">›</span>
      </button>
    </div>
  );
}

/** Inicio: pide las invitaciones y dibuja la burbuja, o nada. */
export function InvitacionEnInicio() {
  const { t } = useIdioma();
  // D237 · lo último visto: la tarjeta «Te invitaron» no aparece de golpe al
  // volver a Inicio empujando lo de abajo.
  const [lista, setLista] = useState<InvitacionMostrable[]>(
    () => ultimoVisto.leer<InvitacionMostrable[]>('inicio.invitaciones') ?? [],
  );
  const cargar = useCallback(() => {
    api
      .getPendingInvitations()
      .then((r) => {
        const mostrables = invitacionesMostrables(r.invitations);
        // E174-3B · la misma poda que en Avisos.
        const actual = loadSession();
        if (actual) fotosEnMemoria.podar(actual, PREFIJO_INVITADOR_DE_INVITACION, idsConFotoDeInvitacion(mostrables));
        setLista(ultimoVisto.guardar('inicio.invitaciones', mostrables));
      })
      .catch(() => {
        // Sin poder confirmarla, no se sigue mostrando la guardada.
        ultimoVisto.olvidar('inicio.invitaciones');
        setLista([]);
      });
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  const { ocupada, aceptar } = useAceptarInvitacion(cargar);
  const elegida = invitacionParaInicio(lista);
  if (!elegida) return null;
  return (
    <section className="home-mesa" aria-label={t('Te invitaron')}>
      <VistaInvitacionEnInicio
        principal={elegida.principal}
        mas={elegida.mas}
        ocupada={ocupada === elegida.principal.id}
        onSumarme={() => void aceptar(elegida.principal)}
        onVerMas={() => navigate('avisos')}
        t={t}
        foto={elegida.principal.fotoDelInvitador ? (
          <FotoDeQuienInvita
            clave={claveInvitadorDeInvitacion(elegida.principal.id)}
            pedir={async (s) => (await api.getInvitationInviterAvatar(elegida.principal.id, s)).blob}
            nombre={elegida.principal.invitadorCompleto ?? elegida.principal.invitador ?? ''}
            size={28}
          />
        ) : undefined}
      />
    </section>
  );
}
