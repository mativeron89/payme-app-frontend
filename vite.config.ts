import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
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
