import { AppBottomBar } from '../components/AppBottomBar';
import { useIdioma } from '../i18n/idioma';
import { AppHeaderBack } from '../components/AppHeader';
import { CardsPanel } from '../components/CardsPanel';
import { goBack } from '../router';

/**
 * **Tarjetas** — la pantalla real que lanza el acceso "Ver tarjetas" de la
 * pestaña Cuenta (`SPEC_APP.md` §1.11).
 *
 * Es una cáscara a propósito: todo el comportamiento vive en `CardsPanel`, que
 * es el MISMO componente que monta la Cuenta vieja. La máquina de alta de
 * tarjeta tiene una sola copia; ver el docblock de ese archivo.
 *
 * **Restricción dura de §1.11:** los accesos de la pestaña Cuenta son
 * `Ver tarjetas` y `Ver pagos`, **y nada más**. Acá no existe saldo, ni
 * movimientos de saldo, ni cargar, ni transferir — ni siquiera como estado
 * vacío o deshabilitado.
 */
export function TarjetasScreen() {
  const { t } = useIdioma();
  return (
    <div className="screen has-appbar">
      <AppHeaderBack title={t('Mis tarjetas')} onBack={() => goBack('home')} />
      <div className="scroll" style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 16 }}>
        <CardsPanel />
      </div>
      <AppBottomBar active={null} />
    </div>
  );
}
