import { useEffect } from 'react';
import { FacebookDataDeletionPage } from './FacebookDataDeletionPage';
import { PrivacyNoticePage } from './PrivacyNoticePage';
import type { RutaPublica } from './publicRoute';

/**
 * APP-FE-META-PUBLIC-COMPLIANCE-01 · el shell de las dos superficies públicas.
 *
 * Es el árbol COMPLETO de estas rutas: no monta `App`, ni `AuthProvider`, ni
 * `IdiomaProvider`, ni router hash. Lo que se ve acá es lo que hay.
 *
 * ## Español fijo, sin `IdiomaProvider`
 *
 * `IdiomaProvider` persiste la preferencia en `localStorage`, y estas rutas
 * tienen prohibido escribirlo. La orden pide español; el idioma queda fijo y no
 * hay selector. Es una superficie de cumplimiento que lee un tercero, no una
 * pantalla de producto.
 *
 * ## El título se fija acá, y nunca lleva el código
 *
 * `document.title` es la única escritura al documento fuera del árbol React.
 * Los dos valores son constantes literales: no hay interpolación posible del
 * `confirmation_code` en el título, que es uno de los lugares que la orden
 * nombra explícitamente.
 *
 * ## Volver a PayMe es un `<a>` a un origen absoluto, con `rel="noreferrer"`
 *
 * Absoluto y no relativo: estas páginas pueden servirse desde el mismo
 * artefacto en más de un host, y «volver» significa siempre la webapp del
 * comensal.
 *
 * 🔴 `rel="noreferrer"` es defensa en profundidad sobre el pathname que lleva
 * el `confirmation_code`. La cabecera `Referrer-Policy: no-referrer` de
 * `vercel.json` ya debería cubrirlo, **pero esa cabecera la sirve el edge y
 * este repo sólo puede probar que está configurada**. El atributo viaja en el
 * documento: si la cabecera no llegara —otro proyecto, otro Root Directory, un
 * proxy—, el enlace sigue sin filtrar la URL de origen.
 */

const TITULO: Readonly<Record<RutaPublica['tipo'], string>> = {
  privacidad: 'Aviso de privacidad · PayMe',
  eliminacion: 'Eliminación de datos · PayMe',
};

export const URL_APP = 'https://app.paymemx.com/';

export function PublicApp({ ruta }: { readonly ruta: RutaPublica }): JSX.Element {
  useEffect(() => {
    document.title = TITULO[ruta.tipo];
  }, [ruta.tipo]);

  return (
    <div className="pub">
      <header className="pub-top">
        <a className="pub-marca" href={URL_APP} rel="noreferrer">PayMe</a>
      </header>

      <main className="pub-main">
        {ruta.tipo === 'privacidad'
          ? <PrivacyNoticePage />
          : <FacebookDataDeletionPage code={ruta.code} />}
      </main>

      <footer className="pub-pie">
        <a className="pub-volver" href={URL_APP} rel="noreferrer">Volver a PayMe</a>
      </footer>
    </div>
  );
}
