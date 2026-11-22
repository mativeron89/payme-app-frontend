/** El splash, las cabeceras y la cámara pueden cambiar sin navegar de ruta.
 * CSS elige el color por la superficie montada. El navegador recibe ese color. */
export function sincronizarFranja(): (() => void) | undefined {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) return;
  let cuadro: number | undefined;
  const actualizar = () => {
    cuadro = undefined;
    const color = getComputedStyle(document.documentElement).getPropertyValue('--franja-superior').trim();
    if (color && meta.content !== color) meta.content = color;
  };
  const cambios = new MutationObserver(() => {
    if (cuadro === undefined) cuadro = requestAnimationFrame(actualizar);
  });
  cambios.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  actualizar();
  return () => {
    cambios.disconnect();
    if (cuadro !== undefined) cancelAnimationFrame(cuadro);
  };
}
