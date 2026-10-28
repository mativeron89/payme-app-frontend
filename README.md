# PayMe · app web del comensal

App web (mobile-first) para dividir y registrar la cuenta de una mesa de restaurante o de un viaje entre amigos: se escanea el ticket, cada persona elige lo que consumió y la app arma la parte de cada uno.

Hecha con React 18, TypeScript y Vite. La landing (`landing/`) es un sitio estático aparte, sin JavaScript.

## Correrla

Usa Node 20, la versión de la CI.

```bash
npm ci
npm run dev
```

`npm run dev` levanta la app en modo de ejemplo (`VITE_MOCK=1`, ver `.env.development`): todos los datos son de ejemplo y no se conecta a ningún servidor.

## Probarla

```bash
npm run typecheck   # los cuatro proyectos TypeScript
npm test            # pruebas unitarias (Vitest)
npm run e2e         # pruebas de navegador (Playwright)
npm run build       # build de la app
npm run build:landing
```

La CI corre esas mismas suites en cada cambio.

## Licencias

Créditos de imágenes en `landing/img/CREDITOS.md`; las fuentes, en `src/assets/fonts/README.md` y `landing/fonts/README.md`.
