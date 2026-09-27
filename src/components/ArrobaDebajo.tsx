import { arrobaVisible, useUsernameCapability } from '../api/username';

/**
 * AF-USERNAME-D104 · decisión 104 de Mati: «que el usuario esté abajo del
 * nombre, oculta el ID que se le asigna, no hace falta mostrarlo».
 *
 * La línea debajo del nombre en una fila de persona (`.fr-name`), con la misma
 * forma que ya usa la búsqueda por @ (`BuscarPorArroba`): `@usuario`. Sin @
 * —ausente con un dueño anterior, `null`, mal formado— o con
 * `features.username` apagada: NADA, ni la línea vacía. Nunca el `payme_id`:
 * este componente no lo recibe.
 */
export function ArrobaDebajo({ username }: { readonly username: string | null | undefined }) {
  const { enabled } = useUsernameCapability();
  const arroba = arrobaVisible(username, enabled);
  return arroba === null ? null : <div className="id">{arroba}</div>;
}
