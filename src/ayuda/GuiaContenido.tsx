import { useState } from 'react';
import { useIdioma } from '../i18n/idioma';

export type GuiaContenidoProps = Record<string, never>;
type Recorrido = 'organizador' | 'invitado' | 'viajes';

/** Ilustraciones textuales: abrir/cambiar recorrido no importa API ni crea registros. */
export function GuiaContenido() {
  const { t } = useIdioma();
  const [recorrido, setRecorrido] = useState<Recorrido>('organizador');
  const pasos = recorrido === 'organizador' ? [
    [t('Escanea y revisa'), t('Toca Escanear. Usa una foto del ticket y revisa los platos y el total antes de continuar.')],
    [t('Decide cómo dividir'), t('Elige la forma de reparto y cuántas personas son. Revisa los datos que faltan en la misma pantalla.')],
    [t('Invita a la mesa'), t('Comparte la invitación. Cada persona se suma con su cuenta y confirma lo suyo.')],
    [t('Revisa tu parte'), t('Si dividen por consumo, elige tus platos en Tus consumos. Si compartieron, elige tu porción y confirma con Listo.')],
  ] : recorrido === 'invitado' ? [
    [t('Abre la invitación'), t('Entra con tu cuenta y acepta la invitación a la mesa.')],
    [t('Elige lo tuyo'), t('Si dividen por consumo, toca tus platos en Tus consumos. Si compartieron, elige sólo tu porción.')],
    [t('Confirma tu selección'), t('Revisa lo elegido y toca Listo. Cada persona confirma su propia selección.')],
    [t('Consulta tu parte'), t('La mesa muestra tu parte según el reparto elegido. Sigue únicamente las acciones disponibles.')],
  ] : [
    [t('Prepara el viaje'), t('Crea el viaje desde Viajes en Inicio e invita a tus amigos. Participan quienes aceptan.')],
    [t('Agrega un ticket o gasto'), t('Desde el viaje, Escanear agrega un ticket. Agregar gasto permite escribir un monto sin foto.')],
    [t('Revisa quién pagó y quién estuvo'), t('Indica quién pagó y revisa las personas incluidas. En restaurantes por consumo, cada una elige lo suyo.')],
    [t('Consulta el balance'), t('Compara lo pagado con lo consumido. Al cerrar el viaje, PayMe sugiere cómo ajustar cuentas; las transferencias se hacen por fuera.')],
  ];
  return (
    <>
      <div className="guia-recorridos" role="group" aria-label={t('Recorrido de la guía')}>
        <button type="button" aria-pressed={recorrido === 'organizador'} onClick={() => setRecorrido('organizador')}>{t('Organizo la mesa')}</button>
        <button type="button" aria-pressed={recorrido === 'invitado'} onClick={() => setRecorrido('invitado')}>{t('Me invitaron')}</button>
        <button type="button" aria-pressed={recorrido === 'viajes'} onClick={() => setRecorrido('viajes')}>{t('Viajes')}</button>
      </div>
      <ol className="guia-pasos" aria-live="polite">
        {pasos.map(([titulo, cuerpo], i) => <li key={`${recorrido}-${i}`}><span className="guia-numero" aria-hidden="true">{i + 1}</span><div><h3>{titulo}</h3><p>{cuerpo}</p></div></li>)}
      </ol>
      <aside className="guia-ejemplo" aria-label={t('Ejemplo ilustrativo')}>
        <b>{t('Ejemplo ilustrativo')}</b>
        <p>{recorrido === 'viajes'
          ? t('Pagaste $300 y consumiste $200: tienes $100 a favor. El balance puede cambiar mientras agregan gastos.')
          : t('Compartieron una pizza entre dos: cada persona elige ½ de esa pizza y confirma su selección.')}</p>
        <small>{t('Este ejemplo no crea mesas, gastos ni pagos.')}</small>
      </aside>
    </>
  );
}
