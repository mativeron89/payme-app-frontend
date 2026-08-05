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
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
