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
import { loadEnv, type Plugin } from 'vite';

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
    // 🔴 Cuando está sucio NOMBRA EL PRIMER ARCHIVO, no sólo el hecho. Un
    // «+sucio» pelado obliga a adivinar qué lo ensució, y el instrumento que
    // sólo dice que algo pasa hace perder más tiempo del que ahorra.
    const porcelain = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
    const primero = porcelain.split('\n')[0]?.trim() ?? '';
    return `${head}${porcelain ? `+sucio(${primero})` : ''}`;
  } catch {
    return 'desconocido';
  }
}

/**
 * 🔴 SIN `VITE_API_URL` NO HAY BUILD REAL — falla temprano y acá, no tarde y
 * delante de la persona.
 *
 * `src/api/http.ts` y `src/api/stripe.ts` caen a `http://localhost:3000` cuando
 * la variable falta. En desarrollo eso es exactamente lo que se quiere; **en un
 * artefacto publicado es una app que no habla con nada**, y el modo en que
 * falla es el problema: el navegador en `https://` bloquea el mixed content,
 * así que **no anda nada y el primero en enterarse es quien intenta pagar**.
 * Una aserción de build convierte eso en un rojo nuestro, minutos antes.
 *
 * ⚠️ **Lo que esta guarda NO hace, dicho para que nadie lo estire:** no verifica
 * que la URL sea la correcta, ni que el backend exista, ni que la variable esté
 * cargada en Vercel — **ese valor vive fuera de este repo y sigue fuera de
 * alcance**. Lo que hace es volver ese límite irrelevante en la única dirección
 * que importa: **sin variable no hay artefacto que publicar.** El `vite.config`
 * corre también en el build de Vercel, así que la compuerta viaja con él.
 *
 * `apply: 'build'` a propósito: `npm run dev` conserva su fallback, y el riel
 * mock también — ahí no hay backend al que apuntar y exigir la variable sería
 * pedir un dato que no existe.
 */
function exigirApiUrl(): Plugin {
  return {
    name: 'payme-exigir-api-url',
    apply: 'build',
    config(_config, { mode }) {
      const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
      if (env.VITE_MOCK === '1') return;
      if (env.VITE_API_URL) return;
      throw new Error(
        'BUILD REAL SIN `VITE_API_URL`.\n' +
          '  El bundle habría quedado apuntando a http://localhost:3000, que en un\n' +
          '  origen https ni siquiera llega a intentarlo: mixed content bloqueado.\n' +
          '  · en local:  VITE_API_URL=http://localhost:3000 npm run build\n' +
          '  · el riel mock no la necesita: VITE_MOCK=1 npm run build\n' +
          '  · en Vercel: la variable va en el proyecto, no en el repo.',
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), exigirApiUrl()],
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
