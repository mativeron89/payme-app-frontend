# legal/ — fuente de verdad de los textos legales

Estos archivos **son** el texto que se le muestra al titular. `legal_texts` en la
base es su proyección consultable, y `consent_events` guarda el **hash** del
cuerpo exacto que se mostró en cada acto.

## Reglas (acta 2026-07-24, D-06)

1. **Un cambio de texto abre versión nueva.** Nunca se edita una vigente: su
   hash es la prueba de qué leyó la persona que consintió.
2. Para publicar un cambio: editás el `.md`, subís el `version:` del
   front-matter y corrés `npm run legal:sync`. El sincronizador cierra la
   versión anterior (`effective_to = NOW()`) y abre la nueva.
3. Si el cuerpo cambió pero la versión no, `legal:sync` **falla** — es el guard
   contra pisar un texto vigente sin dejar rastro.

## Estado

⚠️ Los textos son **PLACEHOLDER**: el redactado legal está esperando al
abogado. El andamiaje se construye igual (así lo ratificó el acta) para que el
día que llegue el texto real sea una versión más, no una migración.
