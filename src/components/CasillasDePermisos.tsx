import { useEffect, useState } from 'react';
import { api } from '../api';
import { capacidadFoto } from '../api/fotoPerfilNoAmigos';
import { useCapacidadesOpcionales } from '../api/sugerencias';
import { useIdioma } from '../i18n/idioma';
import { finalidades, type Eleccion } from './permisosDeTerminos';

export function useDisponibilidadPermisos(activa = true) {
  const [foto, setFoto] = useState(false);
  const capacidades = useCapacidadesOpcionales();
  useEffect(() => {
    if (!activa) return;
    let viva = true;
    api.getConfig().then(c => { if (viva) setFoto(capacidadFoto(c).enabled); }).catch(() => undefined);
    return () => { viva = false; };
  }, [activa]);
  return { foto_perfil_no_amigos: foto, analisis_interno: capacidades.analisis_interno?.enabled === true };
}

export function CasillasDePermisos({ elecciones, cambiar, ocupado }: {
  elecciones: Eleccion; cambiar: (valor: Eleccion) => void; ocupado: boolean;
}) {
  const { t } = useIdioma();
  const textos = {
    foto_perfil_no_amigos: [t('Mostrar mi foto'), t('Mostrar mi foto a personas que no son mis amigos')],
    analisis_interno: [t('Análisis interno'), t('Opcional. PayMe analiza, sin tu nombre, cómo se consume en las mesas. No llega a restaurantes ni a otros usuarios. Puedes apagarlo.')],
  } as const;
  return <>{finalidades.map(f => elecciones[f] === undefined ? null : (
    <label key={f} className="casilla-legal">
      <input type="checkbox" aria-label={textos[f][0]} aria-describedby={`ayuda-${f}`}
        checked={elecciones[f]} disabled={ocupado} onChange={e => cambiar({ ...elecciones, [f]: e.target.checked })} />
      <span><strong>{textos[f][0]}</strong><br /><span id={`ayuda-${f}`} className="caption">{textos[f][1]}</span></span>
    </label>
  ))}</>;
}
