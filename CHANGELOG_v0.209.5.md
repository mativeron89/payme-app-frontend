# 0.209.5 — compatibilidad OCR opt-in (local)

- Solicita `receipt_version=1` con OCR v2, según contrato AB 2.145.3. Evita que el servidor añada `receipt` a clientes antiguos con decoder cerrado.
- Conserva respuesta sin recibo como fallback, token en memoria, bloqueo de claves extra y transporte autenticado con un refresh acotado. No recarga automática.
- Reespejo mecánico del inventario owner de 121 archivos, contenido b4d5d4e, publicado sólo cuando se complete el circuito posterior de integración.
- Pruebas y límites en docs/CORRECCIONES_CODEX_20260930.md. Sin push/deploy, sin OCR real ni datos productivos.
