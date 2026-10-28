import { describe, expect, it } from 'vitest'
// `?raw` trae el CSS como texto. Se usa esto y no `node:fs` a propósito: los
// tipos de `?raw` ya vienen en `vite/client`, que el tsconfig carga, mientras
// que `node:fs` exigiría @types/node — una dependencia nueva, y agregar
// dependencias sin OK previo de Mati está prohibido por el gobierno del repo.
import CSS from './global.css?raw'
import PANTALLA_DEL_LINK from '../screens/JoinMesaScreen.tsx?raw'

/**
 * Fija los tokens de ../../../diseno/SISTEMA_DISENO.md §1–§3.
 *
 * Por qué existe: el sistema dice que TODO ratio de contraste está MEDIDO con
 * la fórmula WCAG 2.1 sobre los hex exactos, y que "si cambiás un hex, se
 * vuelve a medir". Este test es esa medición, automatizada. Cambiar un color
 * sin volver a verificarlo deja de ser posible en silencio.
 *
 * Lee el CSS como texto a propósito: no hay jsdom en la suite (por
 * ratificación) y no hace falta — un token es un valor, y verificarlo es
 * aritmética pura.
 */

function token(name: string): string {
  const found = CSS.match(new RegExp(`^\\s*--${name}:\\s*([^;]+);`, 'm'))
  if (!found) throw new Error(`falta el token --${name} en global.css`)
  return found[1].trim()
}

/** Canales 0–255 de un hex de 6 dígitos. */
function channels(hex: string): [number, number, number] {
  const m = hex.trim().match(/^#([0-9a-f]{6})$/i)
  if (!m) throw new Error(`no es un hex de 6 dígitos: ${hex}`)
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Luminancia relativa, WCAG 2.1. */
function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Ratio de contraste WCAG 2.1 entre dos colores ya opacos. */
function ratio(fg: [number, number, number], bg: [number, number, number]): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a)
  return (hi + 0.05) / (lo + 0.05)
}

/** Compone un color con alpha sobre un fondo opaco (el navegador hace esto). */
function over(fg: [number, number, number], alpha: number, bg: [number, number, number]) {
  return fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha))) as [number, number, number]
}

const contrast = (fgToken: string, bgToken: string) =>
  ratio(channels(token(fgToken)), channels(token(bgToken)))

describe('sistema de diseño · §1 color', () => {
  it('declara la paleta con los hex exactos del sistema', () => {
    // Marca. --brand y --brand-ink NO son intercambiables.
    expect(token('brand')).toBe('#f0703c')
    // 🔴 Enmienda del 2026-08-08: era `#0f1f3d`. Ver EXCEPCIONES_AA abajo.
    expect(token('brand-fg')).toBe('#ffffff')
    expect(token('brand-soft')).toBe('#fff0eb')
    expect(token('brand-ink')).toBe('#c2410c')
    // Acción.
    expect(token('action')).toBe('#101e3b')
    expect(token('action-fg')).toBe('#ffffff')
    expect(token('action-2')).toBe('#12a5b4')
    expect(token('action-2-fg')).toBe('#101e3b')
    expect(token('link')).toBe('#0a7b80')
    // Superficie y texto.
    expect(token('bg')).toBe('#f4f7fa')
    expect(token('surface')).toBe('#ffffff')
    expect(token('surface-2')).toBe('#f8fafc')
    expect(token('border')).toBe('#e3e9f0')
    expect(token('text')).toBe('#101e3b')
    expect(token('text-muted')).toBe('#5b6b82')
    expect(token('text-faint')).toBe('#7d8ca1')
    expect(token('on-dark')).toBe('#ffffff')
    expect(token('on-dark-muted')).toBe('rgba(255, 255, 255, 0.72)')
    // Semánticos: texto y tinte son valores distintos.
    expect(token('success')).toBe('#047857')
    expect(token('success-tint')).toBe('#ecfdf5')
    expect(token('warning')).toBe('#92620a')
    expect(token('warning-tint')).toBe('#fffbeb')
    expect(token('danger')).toBe('#b4462f')
    expect(token('danger-tint')).toBe('#fbe7e3')
    expect(token('danger-l')).toBe('#fbe7e3')
    expect(token('teal-l')).toBe('#e4f7f8')
    expect(token('teal')).toBe(token('action-2'))
    expect(token('orange')).toBe(token('brand'))
    expect(token('info')).toBe('#0a6c85')
    expect(token('info-tint')).toBe('#e6f6fa')
  })

  it('mide los ratios que el sistema declara verificados', () => {
    // D310: 2.96 (antes 2.84 desde la enmienda del 2026-08-08). Se sigue MIDIENDO y
    // se sigue FIJANDO: la excepción es al mínimo AA, no a la medición.
    expect(contrast('brand-fg', 'brand')).toBeCloseTo(2.96, 1)
    expect(contrast('brand-ink', 'surface')).toBeCloseTo(5.18, 1)
    expect(contrast('action-fg', 'action')).toBeCloseTo(16.52, 1)
    expect(contrast('action-2-fg', 'action-2')).toBeCloseTo(5.56, 1)
    expect(contrast('link', 'surface')).toBeCloseTo(5.05, 1)
    expect(contrast('on-dark', 'action')).toBeCloseTo(16.52, 1)
  })

  it('--text sobre --bg mide 15.37, y el documento ya coincide', () => {
    // 🔴 ESTE TEST SE LLAMABA «mide 15.21, no 15.4 como dice el documento», y
    // esa discrepancia SE CERRÓ SOLA con la migración de logo del 2026-08-14.
    //
    // La historia, porque explica por qué el título cambió: al automatizar la
    // medición apareció que `SISTEMA_DISENO.md` declaraba 15.4:1 en dos lugares
    // mientras el navy viejo `#0f1f3d` sobre `#f4f7fa` daba 15.21:1. Se fijó el
    // valor MEDIDO y se reportó, sin editar el documento —que es de Diseño—.
    //
    // Con el navy nuevo `#101e3b` la medición da **15.37** y el documento
    // declara **15.38**: coinciden dentro del redondeo. **La discrepancia no se
    // arregló, se volvió sin objeto** — conviene decirlo así y no borrar el
    // rastro, porque el próximo que lea «15.4» en un doc viejo va a querer
    // saber si esto sigue abierto.
    //
    // Sin consecuencia de accesibilidad ni antes ni ahora: el mínimo AA es 4.5.
    expect(contrast('text', 'bg')).toBeCloseTo(15.37, 1)
    expect(contrast('text', 'bg')).toBeGreaterThanOrEqual(4.5)
  })

  it('--text-muted pasa AA en las TRES superficies, que es la corrección que lo trajo', () => {
    // El --text-muted viejo era #64748b: 4.43:1 sobre el fondo de página,
    // por debajo del mínimo. El nuevo pasa en las tres.
    expect(contrast('text-muted', 'bg')).toBeCloseTo(5.05, 1)
    expect(contrast('text-muted', 'surface')).toBeCloseTo(5.43, 1)
    expect(contrast('text-muted', 'surface-2')).toBeCloseTo(5.19, 1)
    for (const surface of ['bg', 'surface', 'surface-2']) {
      expect(contrast('text-muted', surface)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('cada semántico pasa AA sobre su propio tinte', () => {
    expect(contrast('success', 'success-tint')).toBeCloseTo(5.21, 1)
    expect(contrast('warning', 'warning-tint')).toBeCloseTo(5.1, 1)
    expect(contrast('danger', 'danger-tint')).toBeCloseTo(4.57, 1)
    expect(contrast('info', 'info-tint')).toBeCloseTo(5.41, 1)
    for (const s of ['success', 'warning', 'danger', 'info']) {
      expect(contrast(s, `${s}-tint`)).toBeGreaterThanOrEqual(4.5)
    }
  })

  /**
   * §5 bis · F · El ÚNICO color de la app que no sale de la paleta de marca.
   *
   * El token existe por una razón que es exactamente la de este archivo: §F lo
   * declara *"para que una auditoría de contraste no lo cuente como color
   * suelto"*. Mientras el hex vivía hardcodeado dentro de la regla `.share-wa`,
   * `token()` no podía verlo y el barrido pasaba por encima sin medirlo. Ahora
   * el valor está donde el instrumento lo alcanza, y ésta es la medición.
   *
   * El verde moderno de WhatsApp (`#25D366`) da 1.98:1 con blanco y reprueba AA
   * de punta a punta; por eso el sistema eligió el teal oscuro histórico. Ese
   * número NO se puede fijar acá: sería un token que la app no tiene. Queda
   * dicho en prosa, que es lo honesto — este test mide lo que la app pinta.
   */
  it('el canal externo pasa AA con el blanco que lleva encima', () => {
    expect(token('channel-whatsapp')).toBe('#075e54')
    expect(contrast('on-dark', 'channel-whatsapp')).toBeCloseTo(7.67, 1)
    expect(contrast('on-dark', 'channel-whatsapp')).toBeGreaterThanOrEqual(4.5)
  })

  /**
   * SPEC_APP.md §1.3 · la observación del total vive DENTRO de la tarjeta de
   * título, así que cuando pasa a advertencia el par no es el que el sistema
   * midió (`--warning` sobre `--warning-tint`, 5.10:1) sino `--warning` sobre
   * `--teal-l`. Es un fondo más claro y el ratio BAJA: pasa AA, pero por menos
   * margen. Queda fijado acá para que un retoque del celeste no lo hunda en
   * silencio en el único lugar donde la app dice que las cuentas no cierran.
   *
   * 🔴 RE-MEDIDO el 2026-08-10 · `4.77` → `4.91`. `--teal-l` pasó de `#e0f8f9`
   * a `#e4fbfc`, **el valor ratificado del sistema de diseño**: el de la app
   * era DERIVA (decisión de Diseño; el de la landing era el bueno). El celeste
   * aclara, así que este par MEJORA. Se re-mide, no se afloja: el número
   * anterior describía un color que la app ya no usa.
   *
   * Cotejo del instrumento: el sistema publica 15.19:1 para navy y 5.04:1 para
   * `--text-muted` sobre el celeste histórico. D310 cambia el fondo a
   * #E4F7F8: se vuelve a medir y se mantiene el mínimo AA abajo.
   */
  it('la advertencia del total pasa AA sobre el celeste de la tarjeta', () => {
    expect(contrast('warning', 'teal-l')).toBeCloseTo(4.78, 1)
    expect(contrast('warning', 'teal-l')).toBeGreaterThanOrEqual(4.5)
    // Y el texto normal de la misma tarjeta, que comparte fondo.
    expect(contrast('text-muted', 'teal-l')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('text', 'teal-l')).toBeGreaterThanOrEqual(4.5)
  })

  it('--on-dark-muted llega a 8:1 sobre la banda navy', () => {
    const composed = over([255, 255, 255], 0.72, channels(token('action')))
    expect(ratio(composed, channels(token('action')))).toBeGreaterThanOrEqual(8)
  })

  /**
   * 🔴 REGISTRO DE EXCEPCIONES AA · 2026-08-08
   *
   * Esto NO es una guarda aflojada. Es lo contrario: la excepción queda
   * ANOTADA, con su número, su fecha y quién la tomó, y se sigue midiendo.
   *
   * El caso: `#FFFFFF` sobre `#FF6B35` da 2.84:1 — reprueba el mínimo AA de
   * 4.5:1 y también el 3:1 de un ícono de control. Es exactamente el número
   * que el sistema de diseño citaba como el problema a resolver. Mati vio los
   * cuatro usos del naranja lado a lado, con el contraste medido al lado de
   * cada uno, y eligió éste igual.
   *
   * 🔴 Por qué no se borra el test y ya: **una guarda desactivada sin
   * explicación es peor que no tenerla**, porque la próxima persona no puede
   * saber si fue decisión o descuido. Acá el que la lea encuentra la decisión,
   * la fecha y la frase textual.
   *
   * Y el registro corta para los dos lados: si una excepción empieza a PASAR
   * —porque alguien oscureció el naranja, digamos— deja de ser excepción y
   * tiene que salir de la lista. El test de abajo lo exige.
   */
  const EXCEPCIONES_AA = [
    {
      fg: 'brand-fg',
      bg: 'brand',
      ratio: 2.96, // D310 · #F0703C, mejora el 2.84 previo; mismo riesgo, no AA.
      minimo: 4.5,
      fecha: '2026-08-08',
      decide: 'Mati',
      literal: 'Quiero los propuestos en la app por favor.',
      fuente: 'diseno/SISTEMA_DISENO.md §1 · tabla de Marca',
    },
  ] as const

  describe('las excepciones a AA están registradas, no escondidas', () => {
    it('🔴 cada excepción sigue MEDIDA y sigue por debajo de su mínimo', () => {
      expect(EXCEPCIONES_AA.length, 'el registro quedó vacío: nada que verificar').toBe(1)
      for (const e of EXCEPCIONES_AA) {
        const medido = contrast(e.fg, e.bg)
        // Fijado: la excepción es al MÍNIMO, no a la medición. Si alguien
        // retoca el naranja y lo hunde todavía más, se entera acá.
        expect(medido, `--${e.fg} sobre --${e.bg}`).toBeCloseTo(e.ratio, 1)
        expect(medido, `--${e.fg} sobre --${e.bg} ya PASA ${e.minimo}: sacala del registro`)
          .toBeLessThan(e.minimo)
      }
    })

    it('🔴 cada excepción dice quién, cuándo y dónde — sin eso es un descuido', () => {
      for (const e of EXCEPCIONES_AA) {
        expect(e.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(e.decide.length).toBeGreaterThan(0)
        expect(e.literal.length, 'sin la frase textual no se puede auditar la decisión')
          .toBeGreaterThan(10)
        expect(e.fuente).toContain('SISTEMA_DISENO.md')
      }
    })

    it('🔴 y la excepción NO se derramó: el resto sigue pasando AA', () => {
      // El riesgo de aceptar un incumplimiento es que se vuelva costumbre.
      // Estos pares no están en el registro y tienen que seguir pasando.
      expect(contrast('brand-ink', 'surface')).toBeGreaterThanOrEqual(4.5)
      expect(contrast('action-fg', 'action')).toBeGreaterThanOrEqual(4.5)
      expect(contrast('action-2-fg', 'action-2')).toBeGreaterThanOrEqual(4.5)
      expect(contrast('link', 'surface')).toBeGreaterThanOrEqual(4.5)
      expect(contrast('text', 'bg')).toBeGreaterThanOrEqual(4.5)
      expect(contrast('text-muted', 'bg')).toBeGreaterThanOrEqual(4.5)
    })
  })

  describe('las prohibiciones del sistema siguen justificadas', () => {
    it('--brand como TEXTO sobre blanco reprueba: por eso existe --brand-ink', () => {
      expect(contrast('brand', 'surface')).toBeLessThan(3)
      expect(contrast('brand-ink', 'surface')).toBeGreaterThanOrEqual(4.5)
    })

    it('el cian --action-2 como TEXTO sobre blanco reprueba: por eso existe --link', () => {
      // D310: 2.97 con el cian `#12a5b4`; antes daba 2.48. **Sube y
      // sigue reprobando** — la prohibición no depende de cuánto reprueba.
      expect(contrast('action-2', 'surface')).toBeCloseTo(2.97, 1)
      expect(contrast('link', 'surface')).toBeGreaterThanOrEqual(4.5)
    })

    it('--text-faint no llega a texto: está prohibido para información', () => {
      expect(contrast('text-faint', 'bg')).toBeLessThan(4.5)
    })
  })
})

describe('sistema de diseño · §2 tipografía', () => {
  it('declara SEIS tamaños, y ninguno baja de 12px', () => {
    const escala = {
      'fs-display': '40px',
      'fs-h1': '28px',
      'fs-h2': '20px',
      'fs-body': '16px',
      'fs-sm': '14px',
      'fs-xs': '12px',
    }
    for (const [name, value] of Object.entries(escala)) {
      expect(token(name)).toBe(value)
      expect(parseFloat(token(name))).toBeGreaterThanOrEqual(12)
    }
  })

  it('el cuerpo de la app es 16px — mínimo de accesibilidad, no preferencia', () => {
    expect(parseFloat(token('fs-body'))).toBeGreaterThanOrEqual(16)
  })

  it('cada tamaño trae su line-height', () => {
    expect(token('lh-display')).toBe('1.05')
    expect(token('lh-h1')).toBe('1.2')
    expect(token('lh-h2')).toBe('1.25')
    expect(token('lh-body')).toBe('1.5')
    expect(token('lh-sm')).toBe('1.45')
    expect(token('lh-xs')).toBe('1.4')
  })

  it('la mono existe y es SOLO para códigos de mesa', () => {
    expect(token('font-mono')).toContain('ui-monospace')
  })
})

describe('sistema de diseño · §3 espaciado, radios y elevación', () => {
  it('la escala de espaciado es base 4 y no se mezcla con otra', () => {
    const sp = { 'sp-1': 4, 'sp-2': 8, 'sp-3': 12, 'sp-4': 16, 'sp-6': 24, 'sp-8': 32, 'sp-12': 48 }
    for (const [name, value] of Object.entries(sp)) {
      expect(token(name)).toBe(`${value}px`)
      expect(value % 4).toBe(0)
    }
  })

  it('declara TRES radios más el full', () => {
    expect(token('r-sm')).toBe('10px')
    expect(token('r-md')).toBe('16px')
    expect(token('r-lg')).toBe('22px')
    expect(token('r-full')).toBe('9999px')
  })

  it('declara las elevaciones generales y las del sistema compartido', () => {
    expect(token('sh-1')).toBe('0 1px 2px rgba(16, 30, 59, 0.06)')
    expect(token('sh-2')).toBe('0 2px 8px rgba(16, 30, 59, 0.06)')
    expect(token('sh-3')).toBe('0 8px 24px rgba(16, 30, 59, 0.1)')
    expect(token('sh-mounted')).toBe('0 4px 16px rgba(16, 30, 59, 0.1)')
    expect(token('sh-fab')).toBe('0 6px 16px rgba(240, 112, 60, 0.34)')
  })

  it('el área táctil mínima de la app es 44px, sin excepción', () => {
    expect(token('tap-min')).toBe('44px')
  })
})

describe('la escala legacy sigue intacta — el paso 1 no cambia un pixel', () => {
  it('conserva sus valores originales bajo el prefijo legacy', () => {
    expect(token('fs-legacy-2xs')).toBe('10.5px')
    expect(token('fs-legacy-xs')).toBe('11.5px')
    expect(token('fs-legacy-sm')).toBe('12.5px')
    expect(token('fs-legacy-base')).toBe('14px')
    expect(token('fs-legacy-md')).toBe('15.5px')
    expect(token('fs-legacy-lg')).toBe('17px')
    expect(token('fs-legacy-xl')).toBe('20px')
    expect(token('fs-legacy-2xl')).toBe('26px')
    expect(token('fs-legacy-3xl')).toBe('33px')
    expect(token('fs-legacy-hero')).toBe('40px')
  })

  it('los dos nombres que colisionaban tienen valores DISTINTOS a los del sistema', () => {
    // Es el motivo entero del rename. Si algún día coincidieran, el prefijo
    // dejaría de hacer falta — pero mientras difieran, mezclarlos mueve píxeles.
    expect(token('fs-legacy-sm')).not.toBe(token('fs-sm'))
    expect(token('fs-legacy-xs')).not.toBe(token('fs-xs'))
  })
})

/** Devuelve el cuerpo de una regla CSS por selector exacto. */
function rule(selector: string): string {
  const escapado = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const found = CSS.match(new RegExp(`^\\s*${escapado}\\s*\\{([^}]*)\\}`, 'm'))
  if (!found) throw new Error(`falta la regla ${selector} en global.css`)
  return found[1]
}

describe('D236 · «Solicitar unirme» con texto blanco', () => {
  /**
   * Mati: «La letra de la burbuja naranja tiene que ser blanca». Era navy. El
   * par blanco sobre este naranja es la excepción a AA ya registrada arriba
   * (`brand-fg` sobre `brand`, 2.84), así que el color va por ESE token: un
   * `#fff` a mano funcionaría igual hoy y quedaría desenganchado del sistema.
   */
  it('el texto del botón listo sale de `--brand-fg`, no de un literal', () => {
    const boton = rule('.unirse-solicitar')
    expect(boton).toContain('color: var(--brand-fg)')
    expect(boton, 'el color va por token, no hardcodeado').not.toMatch(/(^|[^-])color:\s*(#|white|black|rgb|var\(--navy\))/im)
  })

  it('apagado no es naranja y conserva su gris (blanco ahí no se vería)', () => {
    const apagado = rule('.unirse-solicitar:disabled')
    expect(apagado).toContain('background: var(--surface)')
    expect(apagado).toContain('color: var(--text-muted)')
  })
})

describe('entrada por link · SPEC_APP.md §1.2', () => {
  /**
   * El CUARTO uso del naranja es una EXCEPCIÓN ratificada (SISTEMA_DISENO.md
   * §1, enmienda del 2026-08-04), no una puerta abierta.
   *
   * 🔴 ENMENDADO 2026-08-08: el texto pasó de navy a BLANCO. Este test decía
   * "nunca blanco" y prohibía explícitamente `color: #fff`; hoy eso es falso y
   * la prohibición está retirada.
   *
   * Lo que se CONSERVA es la propiedad que de verdad importaba y que no
   * cambió: **el color sale del TOKEN, no de un literal escrito acá**. El modo
   * silencioso de romperlo sigue existiendo, sólo que ahora al revés — alguien
   * que ponga `color: #fff` a mano "para que quede igual" desengancha este
   * botón del sistema, y el día que Mati revierta la enmienda este lugar no se
   * entera.
   */
  it('el CTA de primer contacto toma su color del token, no de un literal', () => {
    const cta = rule('.link-btn-brand')
    expect(cta).toContain('background: var(--brand)')
    expect(cta).toContain('color: var(--brand-fg)')
    // Cualquier color escrito a mano —blanco, navy o el que sea— rompe acá.
    expect(cta, 'el color va por token, no hardcodeado').not.toMatch(
      /color:\s*(#[0-9a-f]{3,8}|white|black|rgb)/i,
    )
  })

  it('el círculo de salida toma el mismo token que el de la barra', () => {
    const circulo = rule('.link-round')
    expect(circulo).toContain('background: var(--brand)')
    expect(circulo).toContain('color: var(--brand-fg)')
  })

  it('el botón con borde del "Ya tengo cuenta" usa navy, que sí pasa sobre blanco', () => {
    const outline = rule('.link-btn-outline')
    expect(outline).toContain('color: var(--action)')
    expect(contrast('action', 'surface')).toBeGreaterThanOrEqual(4.5)
  })

  it('D372 · el canje hecho: el cuadro verde de la tarjeta, con el tilde en el blanco del cuadro, pasa AA', () => {
    // Reemplaza al tilde de 72 (`.link-check`). El blanco lo hereda de `.title-card-cuadro` (--on-dark).
    const exito = rule('.title-card-cuadro--exito')
    expect(exito).toContain('background: var(--success)')
    expect(exito, 'sin color propio: el del cuadro').not.toMatch(/(^|[^-])color:/m)
    expect(rule('.title-card-cuadro')).toContain('color: var(--on-dark)')
    expect(contrast('on-dark', 'success')).toBeGreaterThanOrEqual(4.5)
  })

  it('el área táctil de los botones no baja del mínimo de la app (D372: 52, con relleno 12/16)', () => {
    const boton = rule('.link-btn')
    expect(boton).toContain('min-height: 52px')
    expect(boton).toContain('padding: var(--sp-3) var(--sp-4)')
    expect(52, 'el alto del diseño no baja del mínimo de la app').toBeGreaterThanOrEqual(parseFloat(token('tap-min')))
    // El círculo es de 56px por spec, ya por encima de los 44.
    expect(rule('.link-round')).toContain('width: 56px')
  })
})

/** Los bloques `@media (prefers-reduced-motion: reduce) { … }` enteros, con las llaves balanceadas. */
function bloquesSinMovimiento(): string[] {
  const out: string[] = []
  const inicio = /@media \(prefers-reduced-motion: reduce\)\s*\{/g
  for (const m of CSS.matchAll(inicio)) {
    let nivel = 1
    let i = m.index! + m[0].length
    const desde = i
    while (nivel > 0 && i < CSS.length) {
      if (CSS[i] === '{') nivel++
      else if (CSS[i] === '}') nivel--
      i++
    }
    out.push(CSS.slice(desde, i - 1))
  }
  return out
}

describe('D372 · la invitación base (Claude Design, con las resoluciones de V)', () => {
  it('🔴 la barra reducida: la sombra ES la de la barra principal (derivada, no copiada), de borde a borde, sin transform', () => {
    const sombra = (cuerpo: string) => cuerpo.match(/box-shadow:\s*([^;]+);/)![1]
    const barra = rule('.link-barra')
    expect(sombra(barra)).toBe(sombra(rule('.appbar-block')))
    for (const decl of ['position: absolute', 'left: 0', 'right: 0', 'bottom: 0', 'height: var(--appbar-alto)', 'border-radius: 24px 24px 0 0']) {
      expect(barra, decl).toContain(decl)
    }
    expect(barra, 'la entrada usa transform: la barra no puede depender de un translateX').not.toMatch(/transform/)
    expect(rule('.link-barra .link-round')).toContain('margin-top: -16px')
  })

  it('🔴 .hdr no cambia; .hdr-compact tiene su alto propio y no se suman reglas compactas nuevas', () => {
    const hdr = rule('.hdr')
    expect(hdr).toContain('height: calc(154px + env(safe-area-inset-top))')
    expect(hdr).toContain('padding: calc(14px + env(safe-area-inset-top)) 16px 56px')
    const compacta = rule('.hdr-compact')
    expect(compacta).toContain('height: calc(var(--sp-4) + var(--tap-min) + var(--sp-4) + 42px + env(safe-area-inset-top))')
    expect(compacta).toContain('padding: calc(var(--sp-4) + env(safe-area-inset-top)) var(--sp-4) 0')
    const selectores = [...CSS.matchAll(/^\s*(\.hdr-compact[^{,]*?)\s*[{,]/gm)].map((m) => m[1]!.trim())
    expect(selectores).toEqual(['.hdr-compact', '.hdr-compact .hdr-mark'])
  })

  it('B · la tarjeta suelta: sin el montaje de −42, 16/16/16 con el área segura, --sh-2, sin encogerse', () => {
    const suelta = rule('.title-card.title-card--suelta')
    expect(suelta).toContain('margin: calc(var(--sp-4) + env(safe-area-inset-top)) var(--sp-4) var(--sp-4)')
    expect(suelta).toContain('box-shadow: var(--sh-2)')
    expect(suelta).toContain('flex: none')
  })

  it('la entrada: 200 ms con 40 de retraso, en la tarjeta montada, la suelta y la barra', () => {
    expect(CSS).toMatch(/\.link-screen > \.title-card,\s*\.link-alta > \.title-card,\s*\.link-barra \{\s*animation: link-entra 200ms cubic-bezier\(0\.2, 0, 0, 1\) 40ms both;/)
  })

  it('🔴 con «reducir movimiento», el aro quieto y la entrada sólo con opacidad; control positivo: el extractor ve otros bloques', () => {
    const bloques = bloquesSinMovimiento()
    // Control positivo: el mismo extractor encuentra el de la burbuja de la guía.
    expect(bloques.some((b) => b.includes('.ayuda-opcion-burbuja'))).toBe(true)
    const nuestro = bloques.find((b) => b.includes('.link-aro'))
    expect(nuestro, 'falta el bloque de la invitación').toBeDefined()
    expect(nuestro!).toMatch(/\.link-aro \{\s*animation: none;/)
    expect(nuestro!).toMatch(/animation: link-entra-quieta 120ms linear both;/)
    expect(CSS).toMatch(/@keyframes link-entra-quieta \{\s*from \{\s*opacity: 0;\s*\}\s*to \{\s*opacity: 1;\s*\}\s*\}/)
  })

  it('🔴 lo que reemplazó la tarjeta no queda ni en el CSS ni en la pantalla; control positivo: la misma búsqueda ve .link-round', () => {
    const viejas = ['join-banner', 'link-mid', 'link-bubble', 'link-foot', 'link-check', 'link-ok-title', 'link-ok-sub']
    const usa = (texto: string, clase: string) => new RegExp(`(^|[^\\w-])${clase}(?![\\w-])`).test(texto)
    for (const clase of viejas) {
      expect(usa(CSS, clase), `${clase} en global.css`).toBe(false)
      expect(usa(PANTALLA_DEL_LINK, clase), `${clase} en JoinMesaScreen`).toBe(false)
    }
    expect(usa(CSS, 'link-round')).toBe(true)
  })

  it('Q5 · las duraciones van locales: no se declara ningún token --mo-*; control positivo: el patrón ve --sp-4', () => {
    expect(CSS).not.toMatch(/^\s*--mo-[a-z-]+\s*:/m)
    expect(CSS).toMatch(/^\s*--sp-4\s*:/m)
  })
})

/**
 * APP-LOGIN-REDESIGN-AF-02-20260917 · LOS COLORES QUE PAYME NO DECIDE.
 *
 * Los seis tokens de Google y de Meta entran por la guía de cada marca, que el
 * paquete de diseño del 10/09 manda respetar sin monocromatizar ni recolorear.
 * Se miden igual que los propios: un color que no decidimos tampoco se deja
 * sin medir.
 *
 * 🔴 POR QUÉ NO VAN AL REGISTRO `EXCEPCIONES_AA` DE ARRIBA, Y LA DIFERENCIA
 * IMPORTA. Ese registro exige `decide`, `literal` y una `fuente` dentro de
 * `SISTEMA_DISENO.md`: es para incumplimientos que **Mati ratificó** mirando el
 * número. El par de Facebook no lo ratificó nadie — es un límite de una guía
 * ajena—, y meterlo ahí obligaría a inventarle una frase y un decisor. Un
 * incumplimiento heredado y una decisión tomada no se anotan en el mismo lugar.
 */
describe('§5 bis · F bis · tokens de marca de terceros del login social', () => {
  it('🔴 Google pasa AA con holgura, y el borde llega al mínimo de no-texto', () => {
    expect(contrast('google-text', 'google-bg')).toBeCloseTo(16.48, 1)
    expect(contrast('google-text', 'google-bg')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('google-text', 'google-bg-hover')).toBeGreaterThanOrEqual(4.5)
    // Un borde no es texto: su mínimo es 3:1 (WCAG 1.4.11), no 4.5.
    expect(contrast('google-border', 'google-bg')).toBeCloseTo(4.53, 1)
    expect(contrast('google-border', 'google-bg')).toBeGreaterThanOrEqual(3)
  })

  it('🔴 el blanco de Facebook sobre su azul NO llega a AA · medido, no estimado', () => {
    const medido = contrast('facebook-text', 'facebook-bg')
    // Fijado en 4.23 a propósito: si alguien retoca el azul, se entera acá en
    // vez de arrastrar el incumplimiento un escalón más abajo.
    expect(medido).toBeCloseTo(4.23, 1)
    expect(medido, 'ya pasa AA: si Meta cambió su azul, actualiza este bloque')
      .toBeLessThan(4.5)
    // El texto va a 15px/700, que NO es «texto grande» —eso empieza en 18.66px
    // negrita—, así que el mínimo que le corresponde es 4.5 y no 3.
    expect(medido).toBeGreaterThanOrEqual(3)
    // Y el dato que conviene no perder: el hover SÍ pasa. Si algún día se
    // decide apartarse de la guía, ese valor ya está del lado bueno.
    expect(contrast('facebook-text', 'facebook-bg-hover')).toBeGreaterThanOrEqual(4.5)
  })

  it('🔴 el incumplimiento no se derramó al resto de la pantalla nueva', () => {
    // Los pares que la tarjeta estrena con tokens PROPIOS siguen pasando AA.
    expect(contrast('text', 'surface')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('text', 'teal-l')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('text-muted', 'teal-l')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('text-muted', 'surface')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('link', 'bg')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('warning', 'warning-tint')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('warning', 'surface')).toBeGreaterThanOrEqual(4.5)
  })
})
