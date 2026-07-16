/** 排版选项：主题 / 配色 / 字体 / 字号（借 doocs/md style 配置） */

export const THEMES = {
  classic: {
    id: 'classic',
    label: '经典',
    hint: '色块标题，醒目',
    file: 'classic.css',
  },
  grace: {
    id: 'grace',
    label: '优雅',
    hint: '柔和随笔',
    file: 'grace.css',
  },
  simple: {
    id: 'simple',
    label: '简洁',
    hint: '轻量现代',
    file: 'simple.css',
  },
}

export const COLORS = [
  { id: 'green', label: '微信绿', value: '#07c160' },
  { id: 'blue', label: '经典蓝', value: '#0F4C81' },
  { id: 'emerald', label: '翡翠绿', value: '#009874' },
  { id: 'rose', label: '玫瑰金', value: '#B76E79' },
  { id: 'orange', label: '活力橘', value: '#FA5151' },
  { id: 'purple', label: '薰衣紫', value: '#92617E' },
  { id: 'ink', label: '石墨黑', value: '#333333' },
]

/** 与 doocs fontFamilyOptions 对齐 */
export const FONTS = [
  {
    id: 'sans',
    label: '无衬线',
    hint: '清晰好读',
    value: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Arial, sans-serif',
  },
  {
    id: 'serif',
    label: '衬线',
    hint: '随笔书卷气',
    value: 'Optima, "PingFang SC", Georgia, "Times New Roman", serif',
  },
  {
    id: 'mono',
    label: '等宽',
    hint: '工整特别',
    value: 'Menlo, Monaco, "Courier New", monospace',
  },
]

export const FONT_SIZES = [
  { id: '14', label: '14', value: '14px' },
  { id: '15', label: '15', value: '15px' },
  { id: '16', label: '16', value: '16px' },
  { id: '17', label: '17', value: '17px' },
  { id: '18', label: '18', value: '18px' },
]

export const DEFAULT_STYLE = {
  theme: 'grace',
  primaryColor: '#07c160',
  fontFamily: FONTS[0].value,
  fontSize: '16px',
  indent: true,
  justify: false,
}

/**
 * @param {unknown} input
 */
export function normalizeStyle(input = {}) {
  const theme = THEMES[input?.theme] ? input.theme : DEFAULT_STYLE.theme

  const colorHit = COLORS.find((c) => c.value === input?.primaryColor || c.id === input?.primaryColor)
  const primaryColor = colorHit?.value
    || (typeof input?.primaryColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(input.primaryColor)
      ? input.primaryColor
      : DEFAULT_STYLE.primaryColor)

  const fontHit = FONTS.find((f) => f.id === input?.fontFamily || f.value === input?.fontFamily)
  const fontFamily = fontHit?.value
    || (typeof input?.fontFamily === 'string' && input.fontFamily.trim()
      ? input.fontFamily.trim()
      : DEFAULT_STYLE.fontFamily)

  const sizeHit = FONT_SIZES.find((s) => s.value === input?.fontSize || s.id === String(input?.fontSize || '').replace(/px$/, ''))
  const fontSize = sizeHit?.value
    || (typeof input?.fontSize === 'string' && /^\d{2}px$/.test(input.fontSize)
      ? input.fontSize
      : DEFAULT_STYLE.fontSize)

  return {
    theme,
    primaryColor,
    fontFamily,
    fontSize,
    indent: input?.indent === undefined ? DEFAULT_STYLE.indent : Boolean(input.indent),
    justify: Boolean(input?.justify),
  }
}

export function listThemesPublic() {
  return Object.values(THEMES).map(({ id, label, hint }) => ({ id, label, hint }))
}

export function listColorsPublic() {
  return COLORS.map(({ id, label, value }) => ({ id, label, value }))
}

export function listFontsPublic() {
  return FONTS.map(({ id, label, hint, value }) => ({ id, label, hint, value }))
}

export function listFontSizesPublic() {
  return FONT_SIZES.map(({ id, label, value }) => ({ id, label, value }))
}
