# Correcciones locales de auditoría — APP Frontend

Fecha: 2026-09-30 UTC. Orden `CODEX-AUDIT-FIX-20260930`.
Base: `1f9cd45d4ed4dcf3876a502d8e4937bb6e117a9f`. Versión: 0.209.5.
Estado: candidato local probado; **sin push, deploy ni verificación productiva**.

## PUB-02 — extensión OCR negociada

El upload solicita `contract_version=2&receipt_version=1`. El backend corregido
responde con recibo sólo ante esa negociación explícita, preservando clientes
anteriores cuyos decoders rechazan claves adicionales. El frontend conserva el
fallback de respuesta sin recibo, un único refresh y el mismo transporte XHR.
Las pruebas cubren ambos formatos y la conservación de la negociación al reintentar.

El espejo se actualizó mecánicamente desde los 121 archivos del inventario owner:
contenido AB `b4d5d4e2ffae39a55420cbd81e5ff60a9fff61ef`, inventario en
`da5ab905182b88189f3042bd6d2b0c738c46b3e3`, SHA-256
`1a6be142fa988cb7c7f94acfaaa24fab0c2ebcf65ea7b0c082da07c545e990f4`.
No se modificó manualmente código del espejo ni su población.

## Verificación ejecutada

- `npm run typecheck`: PASS, los cuatro proyectos TypeScript.
- `npx --no-install vitest run src/api/ocrUpload.test.ts src/api/contractResponses.test.ts src/api/http.session.test.ts src/api/http.legalGate.test.ts src/api/ocrLimit.mirror.test.ts --maxWorkers=2`: 121/121 PASS.
- `npm test -- --maxWorkers=2`: 201 archivos PASS; 3.159 pruebas PASS, una omitida, cero fallos (3.160 total). No se presenta la omitida como ejecutada.
- `VITE_API_URL=http://127.0.0.1:39999 VITE_MOCK=0 npm run build`: PASS.
- `VITE_MOCK=1 npm run build -- --outDir dist-mock`: PASS.
- `node scripts/verificar-mirror.mjs --vigencia`: PASS, 121 archivos.
- `git diff --check`: PASS antes del commit.

Los builds son verificaciones locales; la URL loopback es deliberadamente ficticia,
no configuración de publicación. Se conservó el aviso existente de Vite sobre
importación estática/dinámica de `src/api/index.ts`. Se reutilizaron dependencias
locales mediante symlink; no se instalaron paquetes. `node_modules` y `dist-mock`
no pertenecen al commit.

## Entrega a Claude

Integrar primero el candidato AB core y después este AF, revisando divergencias
con el trabajo posterior de Claude. No mezclar la rama separada del exportador.
Este resultado no certifica CI remoto, sesión real en iPhone, proveedor OCR real,
producción, ni una auditoría independiente de las propias correcciones.
La política de publicación y los gates vigentes siguen aplicando.
