import { describe, expect, it } from 'vitest'
// `?raw` trae el CSS como texto. Se usa esto y no `node:fs` a propósito: los
// tipos de `?raw` ya vienen en `vite/client`, que el tsconfig carga, mientras
// que `node:fs` exigiría @types/node — una dependencia nueva, y agregar
// dependencias sin OK previo de Mati está prohibido por el CLAUDE.md del repo.
import CSS from './global.css?raw'

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
    expect(token('brand')).toBe('#ff6b35')
    expect(token('brand-fg')).toBe('#0f1f3d')
    expect(token('brand-soft')).toBe('#fff0eb')
    expect(token('brand-ink')).toBe('#c2410c')
    // Acción.
    expect(token('action')).toBe('#0f1f3d')
    expect(token('action-fg')).toBe('#ffffff')
    expect(token('action-2')).toBe('#00c2cb')
    expect(token('action-2-fg')).toBe('#0f1f3d')
    expect(token('link')).toBe('#0a7b80')
    // Superficie y texto.
    expect(token('bg')).toBe('#f4f7fa')
    expect(token('surface')).toBe('#ffffff')
    expect(token('surface-2')).toBe('#f8fafc')
    expect(token('border')).toBe('#e2e8f0')
    expect(token('text')).toBe('#0f1f3d')
    expect(token('text-muted')).toBe('#5b6b82')
    expect(token('text-faint')).toBe('#7d8ca1')
    expect(token('on-dark')).toBe('#ffffff')
    expect(token('on-dark-muted')).toBe('rgba(255, 255, 255, 0.72)')
    // Semánticos: texto y tinte son valores distintos.
    expect(token('success')).toBe('#047857')
    expect(token('success-tint')).toBe('#ecfdf5')
    expect(token('warning')).toBe('#92620a')
    expect(token('warning-tint')).toBe('#fffbeb')
    expect(token('danger')).toBe('#b42318')
    expect(token('danger-tint')).toBe('#fef2f2')
    expect(token('info')).toBe('#0a6c85')
    expect(token('info-tint')).toBe('#e6f6fa')
  })

  it('mide los ratios que el sistema declara verificados', () => {
    expect(contrast('brand-fg', 'brand')).toBeCloseTo(5.77, 1)
    expect(contrast('brand-ink', 'surface')).toBeCloseTo(5.18, 1)
    expect(contrast('action-fg', 'action')).toBeCloseTo(16.36, 1)
    expect(contrast('action-2-fg', 'action-2')).toBeCloseTo(7.46, 1)
    expect(contrast('link', 'surface')).toBeCloseTo(5.05, 1)
    expect(contrast('on-dark', 'action')).toBeCloseTo(16.36, 1)
  })

  it('--text sobre --bg mide 15.21, no 15.4 como dice el documento', () => {
    // Discrepancia encontrada al automatizar la medición, reportada al
    // Bibliotecario-Auditor: SISTEMA_DISENO.md §1 declara 15.4:1 en dos
    // lugares (tabla de superficie y checklist de verificación). El valor
    // real de #0f1f3d sobre #f4f7fa es 15.21:1. Tampoco corresponde a las
    // otras dos superficies (--surface da 16.36, --surface-2 da 15.64), así
    // que no es que hayan medido sobre el fondo equivocado.
    //
    // SIN consecuencia de accesibilidad: el mínimo AA es 4.5 y esto lo pasa
    // por más de tres veces. Se fija el valor MEDIDO, no el declarado — el
    // documento es de la conversación de Diseño y no se edita desde acá.
    expect(contrast('text', 'bg')).toBeCloseTo(15.21, 1)
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
    expect(contrast('danger', 'danger-tint')).toBeCloseTo(6.01, 1)
    expect(contrast('info', 'info-tint')).toBeCloseTo(5.41, 1)
    for (const s of ['success', 'warning', 'danger', 'info']) {
      expect(contrast(s, `${s}-tint`)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('--on-dark-muted llega a 8:1 sobre la banda navy', () => {
    const composed = over([255, 255, 255], 0.72, channels(token('action')))
    expect(ratio(composed, channels(token('action')))).toBeGreaterThanOrEqual(8)
  })

  describe('las prohibiciones del sistema siguen justificadas', () => {
    it('blanco sobre --brand reprueba: por eso el glifo va en navy', () => {
      const blancoSobreNaranja = ratio([255, 255, 255], channels(token('brand')))
      expect(blancoSobreNaranja).toBeCloseTo(2.84, 1)
      expect(blancoSobreNaranja).toBeLessThan(3) // ni el mínimo de ícono de control
      expect(contrast('brand-fg', 'brand')).toBeGreaterThanOrEqual(4.5)
    })

    it('--brand como TEXTO sobre blanco reprueba: por eso existe --brand-ink', () => {
      expect(contrast('brand', 'surface')).toBeLessThan(3)
      expect(contrast('brand-ink', 'surface')).toBeGreaterThanOrEqual(4.5)
    })

    it('el teal --action-2 como TEXTO sobre blanco reprueba: por eso existe --link', () => {
      expect(contrast('action-2', 'surface')).toBeCloseTo(2.19, 1)
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

  it('declara las tres elevaciones', () => {
    expect(token('sh-1')).toBe('0 1px 2px rgba(15, 31, 61, 0.06)')
    expect(token('sh-2')).toBe('0 2px 8px rgba(15, 31, 61, 0.08)')
    expect(token('sh-3')).toBe('0 8px 24px rgba(15, 31, 61, 0.1)')
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
