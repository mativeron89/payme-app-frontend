import react from '@vitejs/plugin-react';
// 🔴 `vitest/config` y no `vite`: este archivo declara un bloque `test`, y el
// `defineConfig` de vite NO lo conoce — daba
// `TS2769 … 'test' does not exist in type 'UserConfigExport'`.
// Nadie lo veía porque este archivo no estaba en ningún proyecto de TypeScript
// (FASE 2 · B). O sea que la config de la suite estaba SIN TIPAR: un `include`
// mal escrito o una opción inexistente pasaban en silencio.
// `vitest` ya es devDependency; no se agrega nada.
import { execSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';

/**
 * 🔴 SENTINELA DEL ÁRBOL SERVIDO (P2-02, hallazgo de Codex 2026-08-20).
 *
 * Codex reprodujo, determinista, que una corrida de Playwright puede ejecutar
 * los specs de UN árbol contra el servidor de OTRO —`reuseExistingServer`
 * adopta lo que encuentre en el puerto— y **el resultado sale verde igual**.
 * Un verde así no prueba nada del commit que se está auditando.
 *
 * El arreglo primario es no reutilizar servidores (ver `playwright.config.ts`).
 * Esto es la segunda línea: el servidor **declara qué árbol es**, y un spec lo
 * compara contra el repo local. Si alguien reactiva la reutilización, la
 * discrepancia se ve en vez de pasar callada.
 *
 * Sale `git rev-parse HEAD` + si el árbol está sucio: servir un árbol sucio es
 * legítimo en desarrollo, pero **una evidencia de auditoría tiene que decir que
 * lo estaba**. Falla a `'desconocido'` en vez de romper el build: esto es
 * instrumentación, no una compuerta.
 */
function arbolServido(): string {
  try {
    const head = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    const sucio = execSync('git status --porcelain', { encoding: 'utf8' }).trim() !== '';
    return `${head}${sucio ? '+sucio' : ''}`;
  } catch {
    return 'desconocido';
  }
}

export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
  define: { __ARBOL_SERVIDO__: JSON.stringify(arbolServido()) },
  // Sin esto, vitest reemplaza todo módulo CSS por un stub vacío (`css: false`
  // es su default), incluso el import `?raw` con el que designTokens.test.ts
  // verifica los tokens del sistema de diseño: el archivo llegaba como "".
  // No afecta al resto de la suite — el único otro import de CSS es el de
  // main.tsx, y ningún test monta la app (no hay jsdom, por ratificación).
  test: {
    css: true,
    // ORDEN 5 · vitest sólo mira `src/`. Sin esto barre también `e2e/`, cuyos
    // specs importan `@playwright/test` y explotan fuera de su runner — y el
    // error que tira no dice "runner equivocado", así que se pierde un rato
    // largo. Los dos runners conviven porque cada uno tiene su carpeta.
    // `scripts/` entra desde la ORDEN 1-C·C: el gate del espejo (un .sh) se
    // prueba como CAJA NEGRA desde un test de node, y tiene que correr en la
    // CI con todo lo demás — un gate cuyo comportamiento nadie verifica es
    // justo el que devolvía exit 0 con tres archivos distintos.
    // `landing/` entra desde la ORDEN CARRIL 1A: la landing es un artefacto
    // SEPARADO y sus tests viven con ella, pero tienen que correr en la
    // misma suite — un aislamiento que se verifica en otra corrida es un
    // aislamiento que alguien puede olvidarse de correr.
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts', 'landing/**/*.test.ts'],
  },
});
