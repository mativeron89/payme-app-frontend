import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { AvatarObjectUrlLease, PROFILE_AVATAR_INPUT_MIMES, profileNameInput, validateAvatarInput } from '../api/profileIdentity';
import { normalizarUsername, problemaDeFormato } from '../api/username';
import { useIdioma } from '../i18n/idioma';
import { CampoArroba } from './PuertaArroba';
import { Icon } from './Icon';
import { Avatar } from './ui';

/**
 * AF-LAPIZ-UNICO · decisión 110 de Mati: «dejar solo un lápiz que conglomere la
 * foto, el nombre y el @. Hoy hay un botón para la foto, otro para el nombre y
 * otro para el @».
 *
 * «Editar perfil» junta los tres. Cada campo conserva sus reglas y sus mensajes
 * de hoy; lo que cambia es CUÁNDO se guarda:
 * - «Guardar» manda sólo lo que cambió, en orden (nombre, @, foto), con los
 *   endpoints de siempre. Quien guarda cada parte es su dueño en la pantalla:
 *   nombre y foto `ProfileIdentityEditor`, el @ `useArrobaDeConfiguracion`.
 * - Si una parte falla, el error queda en ESE campo y lo demás se guarda igual.
 *   Lo que se guardó pasa a ser lo actual, así que reintentar manda sólo lo que
 *   falló; lo escrito no se pierde.
 * - «Cancelar» no manda nada y deja todo como estaba.
 * - Mientras guarda: «Guardando…», todo deshabilitado, y un segundo toque no
 *   vuelve a guardar (la guarda es una ref, no el `disabled`, que llega un
 *   render tarde).
 * - La foto nueva se ve antes de guardar (una URL local que se revoca al
 *   cambiarla, al cancelar y al desmontar); no se sube hasta «Guardar».
 */

export type ResultadoParte = { readonly ok: true } | { readonly ok: false; readonly error: string };

export type FotoBorrador =
  | { readonly tipo: 'igual' }
  | { readonly tipo: 'nueva'; readonly archivo: File }
  | { readonly tipo: 'quitar' };

export interface BorradorPerfil {
  readonly nombre: string;
  readonly apellido: string;
  /** `null` cuando el @ no se puede cambiar (no hay, o está en período de espera). */
  readonly arroba: string | null;
  readonly foto: FotoBorrador;
}

export interface PerfilActual {
  readonly nombre: string;
  readonly apellido: string;
  /** El @ si hoy se puede cambiar; `null` si no. */
  readonly arroba: string | null;
}

export type Parte = 'nombre' | 'arroba' | 'foto';
export type ResultadosDePerfil = Partial<Record<Parte, ResultadoParte>>;

export interface GuardadoresDePerfil {
  /** Nunca lanzan: cada uno devuelve el resultado de su parte. */
  readonly nombre: (nombre: string, apellido: string) => Promise<ResultadoParte>;
  readonly arroba: (valor: string) => Promise<ResultadoParte>;
  readonly subirFoto: (archivo: File) => Promise<ResultadoParte>;
  readonly quitarFoto: () => Promise<ResultadoParte>;
}

/** Normalizado si es válido; si no, tal cual: un nombre inválido cuenta como cambio y lo rechaza su guardado. */
function nombreNormal(valor: string): string {
  try { return profileNameInput(valor); } catch { return valor; }
}

/** Qué partes cambiaron respecto de lo actual, en el orden en que se guardan. */
export function partesQueCambiaron(b: BorradorPerfil, a: PerfilActual): Parte[] {
  const partes: Parte[] = [];
  if (nombreNormal(b.nombre) !== a.nombre || nombreNormal(b.apellido) !== a.apellido) partes.push('nombre');
  if (b.arroba !== null && a.arroba !== null && normalizarUsername(b.arroba) !== a.arroba) partes.push('arroba');
  if (b.foto.tipo !== 'igual') partes.push('foto');
  return partes;
}

/** Guarda lo que cambió, una parte después de la otra. Una falla no frena a las demás. */
export async function guardarPerfil(
  b: BorradorPerfil,
  a: PerfilActual,
  g: GuardadoresDePerfil,
): Promise<ResultadosDePerfil> {
  const resultados: ResultadosDePerfil = {};
  for (const parte of partesQueCambiaron(b, a)) {
    if (parte === 'nombre') resultados.nombre = await g.nombre(b.nombre, b.apellido);
    else if (parte === 'arroba') resultados.arroba = await g.arroba(b.arroba!);
    else if (b.foto.tipo === 'nueva') resultados.foto = await g.subirFoto(b.foto.archivo);
    else resultados.foto = await g.quitarFoto();
  }
  return resultados;
}

type Traductor = (s: string, ...a: unknown[]) => string;

const CAMPO = { fontSize: 16, fontWeight: 400 } as const;

/** El formulario, sin estado: lo dibujan los tests tal cual. */
export function VistaEditarPerfil({
  borrador,
  actual,
  editaNombreYFoto,
  notaDeEspera,
  arrobaEnEspera,
  fotoUrl,
  tieneFoto,
  nombreParaAvatar,
  errores,
  guardando,
  onNombre,
  onApellido,
  onArroba,
  onElegirFoto,
  onQuitarFoto,
  onCancelar,
  onGuardar,
  t,
}: {
  readonly borrador: BorradorPerfil;
  readonly actual: PerfilActual;
  readonly editaNombreYFoto: boolean;
  readonly notaDeEspera: string | null;
  /** El @ en período de espera, tal como se muestra (con su «@»), para verlo sin editar. */
  readonly arrobaEnEspera: string | null;
  /** La foto que se ve: la nueva elegida, la de hoy o ninguna. */
  readonly fotoUrl: string | null;
  readonly tieneFoto: boolean;
  readonly nombreParaAvatar: string;
  readonly errores: Partial<Record<Parte, string>>;
  readonly guardando: boolean;
  readonly onNombre: (v: string) => void;
  readonly onApellido: (v: string) => void;
  readonly onArroba: (v: string) => void;
  readonly onElegirFoto: () => void;
  readonly onQuitarFoto: () => void;
  readonly onCancelar: () => void;
  readonly onGuardar: () => void;
  readonly t: Traductor;
}) {
  const arrobaCambia = borrador.arroba !== null && actual.arroba !== null
    && normalizarUsername(borrador.arroba) !== actual.arroba;
  // Como hoy: un @ con formato inválido no se manda (el campo dice por qué).
  const arrobaInvalida = arrobaCambia && problemaDeFormato(normalizarUsername(borrador.arroba!)) !== 'ok';
  const errorArroba = errores.arroba && errores.arroba !== notaDeEspera ? errores.arroba : null;
  return (
    <form
      className="profile-editar"
      aria-label={t('Editar perfil')}
      style={{ display: 'grid', gap: 'var(--sp-3)', width: 'min(100%, 300px)', marginTop: 'var(--sp-3)', textAlign: 'left' }}
      onSubmit={(e: FormEvent) => { e.preventDefault(); if (!arrobaInvalida) onGuardar(); }}
    >
      {editaNombreYFoto && (
        // Centrada, como el encabezado: la foto, y debajo cambiarla o eliminarla.
        <div className="profile-editar-foto" style={{ display: 'grid', justifyItems: 'center', gap: 'var(--sp-2)' }}>
          <div className="profile-avatar-wrap">
            {fotoUrl ? (
              <img className="profile-avatar-image" src={fotoUrl} alt={t('Foto de perfil')} />
            ) : (
              <Avatar name={nombreParaAvatar} size={84} variant="marca" />
            )}
          </div>
          <button type="button" className="btn btn-ghost btn-fit btn-sm" onClick={onElegirFoto} disabled={guardando}>
            <Icon name="camera" size={15} /> {t('Cambiar foto de perfil')}
          </button>
          {tieneFoto && (
            <button type="button" className="profile-avatar-delete" style={{ marginTop: 0 }} onClick={onQuitarFoto} disabled={guardando}>
              <Icon name="trash" size={14} /> {t('Eliminar foto')}
            </button>
          )}
          {errores.foto && <div className="ingreso-error" role="alert">{errores.foto}</div>}
        </div>
      )}

      {editaNombreYFoto && (
        <div className="profile-name-editor" style={{ width: '100%', marginTop: 0 }}>
          {/* 16 px, como el campo del @: por debajo, el iPhone agranda la
              pantalla al tocar el campo. La etiqueta sigue en su tamaño. */}
          <label>
            <span>{t('Nombre')}</span>
            <input value={borrador.nombre} onChange={(e) => onNombre(e.target.value)} maxLength={200} disabled={guardando} style={CAMPO} />
          </label>
          <label>
            <span>{t('Apellido')}</span>
            <input value={borrador.apellido} onChange={(e) => onApellido(e.target.value)} maxLength={200} disabled={guardando} style={CAMPO} />
          </label>
          {errores.nombre && <div className="ingreso-error" role="alert">{errores.nombre}</div>}
        </div>
      )}

      {borrador.arroba !== null ? (
        <div className="arroba-edicion">
          <CampoArroba
            id="config-arroba-campo"
            etiqueta={t('Tu @usuario')}
            valor={borrador.arroba}
            disabled={guardando}
            onCambio={onArroba}
          />
          <div className="arroba-nota">{t('Después vas a tener que esperar 30 días para volver a cambiarlo.')}</div>
          {errorArroba && <div className="ingreso-error arroba-error-guardar" role="alert">{errorArroba}</div>}
        </div>
      ) : arrobaEnEspera !== null ? (
        <div className="arroba-edicion">
          <div className="arroba-etiqueta">{t('Tu @usuario')}</div>
          <div className="profile-arroba" style={{ marginTop: 0 }}>{arrobaEnEspera}</div>
          {notaDeEspera && (
            <div className="arroba-nota" role={errores.arroba ? 'alert' : 'status'}>{notaDeEspera}</div>
          )}
          {errorArroba && <div className="ingreso-error arroba-error-guardar" role="alert">{errorArroba}</div>}
        </div>
      ) : null}

      <div className="profile-name-actions">
        <button type="button" className="btn btn-ghost btn-fit" onClick={onCancelar} disabled={guardando}>
          {t('Cancelar')}
        </button>
        <button type="submit" className="btn btn-navy btn-fit" disabled={guardando || arrobaInvalida}>
          {guardando ? t('Guardando…') : t('Guardar')}
        </button>
      </div>
    </form>
  );
}

/**
 * «Editar perfil» con su estado. Lo abre el único lápiz del encabezado de
 * Configuración (`ProfileIdentityEditor`).
 */
export function EditarPerfil({
  actual,
  editaNombreYFoto,
  arrobaEnEspera,
  notaDeEspera,
  fotoUrl,
  tieneFoto,
  nombreParaAvatar,
  guardadores,
  onGuardado,
  onCerrar,
}: {
  readonly actual: PerfilActual;
  readonly editaNombreYFoto: boolean;
  readonly arrobaEnEspera: string | null;
  readonly notaDeEspera: string | null;
  readonly fotoUrl: string | null;
  readonly tieneFoto: boolean;
  readonly nombreParaAvatar: string;
  readonly guardadores: GuardadoresDePerfil;
  /** Todo lo que cambió se guardó. */
  readonly onGuardado: () => void;
  /** Cancelar, o «Guardar» sin cambios: se cierra sin mandar nada. */
  readonly onCerrar: () => void;
}) {
  const { t } = useIdioma();
  const [nombre, setNombre] = useState(actual.nombre);
  const [apellido, setApellido] = useState(actual.apellido);
  const [arroba, setArroba] = useState<string | null>(actual.arroba);
  const [foto, setFoto] = useState<FotoBorrador>({ tipo: 'igual' });
  const [vistaPrevia, setVistaPrevia] = useState<string | null>(null);
  const [errores, setErrores] = useState<Partial<Record<Parte, string>>>({});
  const [guardando, setGuardando] = useState(false);
  const enVuelo = useRef(false);
  const lease = useRef<AvatarObjectUrlLease | null>(null);
  const archivo = useRef<HTMLInputElement | null>(null);
  if (!lease.current) lease.current = new AvatarObjectUrlLease();

  useEffect(() => () => { lease.current?.dispose(); }, []);

  // El @ llega por su lado: si se abrió antes de leerlo, el campo aparece al
  // llegar; si deja de poder cambiarse (se guardó, o el dueño dijo que todavía
  // no), pasa a mostrarse en espera. Lo ya escrito no se pisa.
  useEffect(() => {
    setArroba((previo) => (actual.arroba === null ? null : previo ?? actual.arroba));
  }, [actual.arroba]);

  const borrador: BorradorPerfil = { nombre, apellido, arroba, foto };

  function elegirFoto(event: ChangeEvent<HTMLInputElement>) {
    const elegido = event.target.files?.[0];
    event.target.value = '';
    if (!elegido) return;
    try {
      validateAvatarInput(elegido);
    } catch {
      setErrores((e) => ({ ...e, foto: t('Usa una imagen JPG, PNG o WebP de hasta 5 MB.') }));
      return;
    }
    setErrores((e) => ({ ...e, foto: undefined }));
    setFoto({ tipo: 'nueva', archivo: elegido });
    setVistaPrevia(lease.current!.replace(elegido));
  }

  function quitarFoto() {
    lease.current?.clear();
    setVistaPrevia(null);
    setErrores((e) => ({ ...e, foto: undefined }));
    // Sin foto hoy, «Eliminar foto» sólo suelta la elegida: no hay nada que borrar.
    setFoto(tieneFoto ? { tipo: 'quitar' } : { tipo: 'igual' });
  }

  function cancelar() {
    if (enVuelo.current) return;
    lease.current?.clear();
    onCerrar();
  }

  async function guardar() {
    if (enVuelo.current) return;
    if (partesQueCambiaron(borrador, actual).length === 0) {
      onCerrar();
      return;
    }
    enVuelo.current = true;
    setGuardando(true);
    setErrores({});
    try {
      const resultados = await guardarPerfil(borrador, actual, guardadores);
      const nuevos: Partial<Record<Parte, string>> = {};
      for (const [parte, r] of Object.entries(resultados) as Array<[Parte, ResultadoParte]>) {
        if (!r.ok) nuevos[parte] = r.error;
      }
      if (resultados.foto?.ok) {
        // Guardada: la foto de hoy pasa a ser ésa; la vista previa se suelta.
        lease.current?.clear();
        setVistaPrevia(null);
        setFoto({ tipo: 'igual' });
      }
      if (Object.keys(nuevos).length === 0) {
        onGuardado();
        return;
      }
      setErrores(nuevos);
    } finally {
      enVuelo.current = false;
      setGuardando(false);
    }
  }

  const fotoQueSeVe = foto.tipo === 'nueva' ? vistaPrevia : foto.tipo === 'quitar' ? null : fotoUrl;
  return (
    <>
      <VistaEditarPerfil
        borrador={borrador}
        actual={actual}
        editaNombreYFoto={editaNombreYFoto}
        notaDeEspera={notaDeEspera}
        arrobaEnEspera={arroba === null ? arrobaEnEspera : null}
        fotoUrl={fotoQueSeVe}
        tieneFoto={foto.tipo === 'nueva' || (foto.tipo === 'igual' && tieneFoto)}
        nombreParaAvatar={nombreParaAvatar}
        errores={errores}
        guardando={guardando}
        onNombre={setNombre}
        onApellido={setApellido}
        onArroba={(v) => { setErrores((e) => ({ ...e, arroba: undefined })); setArroba(v); }}
        onElegirFoto={() => archivo.current?.click()}
        onQuitarFoto={quitarFoto}
        onCancelar={cancelar}
        onGuardar={() => void guardar()}
        t={t}
      />
      {editaNombreYFoto && (
        <input
          ref={archivo}
          className="profile-file-input"
          type="file"
          accept={PROFILE_AVATAR_INPUT_MIMES.join(',')}
          onChange={elegirFoto}
          tabIndex={-1}
        />
      )}
    </>
  );
}
