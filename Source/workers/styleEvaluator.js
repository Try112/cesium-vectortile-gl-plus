/**
 * Worker 内样式求值：paint 表达式求值、颜色转 [r,g,b,a] 字节。
 * 不依赖 Cesium，仅使用 @maplibre/maplibre-gl-style-spec。
 */
import { expression, latest } from '@maplibre/maplibre-gl-style-spec'

const paintFillRef = latest.paint_fill
const paintLineRef = latest.paint_line
const layoutSymbolRef = latest.layout_symbol
const paintSymbolRef = latest.paint_symbol
const paintCircleRef = latest.paint_circle || {
  'circle-color': { default: { r: 0, g: 0, b: 0, a: 1 } },
  'circle-radius': { default: 5 },
  'circle-opacity': { default: 1 },
  'circle-stroke-color': { default: { r: 1, g: 1, b: 1, a: 1 } },
  'circle-stroke-width': { default: 0 }
}
const layoutCircleRef = latest.layout_circle || {
  visibility: { default: 'visible' }
}

/**
 * 构建图层 paint 的表达式 Map（仅包含需要的 key）
 * @param {object} paint - 原始 paint 对象
 * @param {object} groupRef - latest.paint_fill 或 paint_line
 * @returns {Map<string, object>}
 */
function buildPaintProps(paint, groupRef) {
  const props = new Map()
  if (!paint || !groupRef) return props
  for (const key of Object.keys(groupRef)) {
    const reference = groupRef[key]
    const value = paint[key]
    const property = expression.normalizePropertyExpression(
      value === undefined ? reference.default : value,
      reference
    )
    props.set(key, property)
  }
  return props
}

/**
 * 求值 paint 属性
 * @param {Map<string, object>} props
 * @param {string} name
 * @param {number} zoom
 * @param {object} feature
 * @returns {*}
 */
function getDataValue(props, name, zoom, feature) {
  const expr = props.get(name)
  return expr ? expr.evaluate({ zoom }, feature) : undefined
}

/**
 * Fill 图层 paint 求值（fill-color, fill-opacity）
 * @param {object} styleLayer - 可序列化的 styleLayer（含 paint）
 * @param {number} zoom
 * @param {object} feature
 * @returns {{ fillColor: { r, g, b, a }, fillOpacity: number }}
 */
export function evaluateFillPaint(styleLayer, zoom, feature) {
  const props = buildPaintProps(styleLayer.paint, paintFillRef)
  const fillColor = getDataValue(props, 'fill-color', zoom, feature)
  const fillOpacity = getDataValue(props, 'fill-opacity', zoom, feature) ?? 1
  return {
    fillColor: fillColor || { r: 0, g: 0, b: 0, a: 1 },
    fillOpacity
  }
}

/**
 * Line 图层 paint 求值（line-width, line-color, line-opacity）
 * @param {object} styleLayer
 * @param {number} zoom
 * @param {object} feature
 * @returns {{ lineWidth: number, lineColor: object, lineOpacity: number }}
 */
export function evaluateLinePaint(styleLayer, zoom, feature) {
  const props = buildPaintProps(styleLayer.paint, paintLineRef)
  const lineWidth = getDataValue(props, 'line-width', zoom, feature) ?? 1
  const lineColor = getDataValue(props, 'line-color', zoom, feature) || {
    r: 0,
    g: 0,
    b: 0,
    a: 1
  }
  const lineOpacity = getDataValue(props, 'line-opacity', zoom, feature) ?? 1
  return { lineWidth, lineColor, lineOpacity }
}

/**
 * Circle 图层 paint 求值（circle-color, circle-radius, circle-opacity, circle-stroke-color, circle-stroke-width）
 * @param {object} styleLayer
 * @param {number} zoom
 * @param {object} feature
 * @returns {{ circleColor: object, circleRadius: number, circleOpacity: number, circleStrokeColor: object, circleStrokeWidth: number }}
 */
export function evaluateCirclePaint(styleLayer, zoom, feature) {
  const props = buildPaintProps(styleLayer.paint, paintCircleRef)
  const circleColor = getDataValue(props, 'circle-color', zoom, feature) || {
    r: 0,
    g: 0,
    b: 0,
    a: 1
  }
  const circleRadius = getDataValue(props, 'circle-radius', zoom, feature) ?? 5
  const circleOpacity = getDataValue(props, 'circle-opacity', zoom, feature) ?? 1
  const circleStrokeColor =
    getDataValue(props, 'circle-stroke-color', zoom, feature) || {
      r: 1,
      g: 1,
      b: 1,
      a: 1
    }
  const circleStrokeWidth =
    getDataValue(props, 'circle-stroke-width', zoom, feature) ?? 0
  return {
    circleColor,
    circleRadius,
    circleOpacity,
    circleStrokeColor,
    circleStrokeWidth
  }
}

/**
 * maplibre Color (r,g,b,a 0-1) → Uint8Array [r,g,b,a]，与主线程 StyleLayer.convertColor 一致（premultiply 逆处理）
 * @param {object} c - { r, g, b, a }
 * @param {number} [opacity=1] - 额外透明度（如 fillOpacity/lineOpacity）
 * @returns {Uint8Array}
 */
export function colorToBytes(c, opacity = 1) {
  const a = c.a != null ? c.a : 1
  const alphaScalar = a > 0 ? 1 / a : 1
  const out = new Uint8Array(4)
  out[0] = Math.round((c.r != null ? c.r : 0) * alphaScalar * 255)
  out[1] = Math.round((c.g != null ? c.g : 0) * alphaScalar * 255)
  out[2] = Math.round((c.b != null ? c.b : 0) * alphaScalar * 255)
  out[3] = Math.floor(a * opacity * 255)
  return out
}

/**
 * 构建 layout/paint 的表达式 Map（symbol 用）
 */
function buildProps(styleProperties, groupRef) {
  const props = new Map()
  if (!styleProperties || !groupRef) return props
  for (const key of Object.keys(groupRef)) {
    const reference = groupRef[key]
    const value = styleProperties[key]
    const property = expression.normalizePropertyExpression(
      value === undefined ? reference.default : value,
      reference
    )
    props.set(key, property)
  }
  return props
}

/**
 * Symbol 图层 layout 求值（text-field, text-font, text-size, text-anchor, text-offset 等）
 */
export function evaluateSymbolLayout(styleLayer, zoom, feature) {
  const layout = styleLayer.layout || {}
  const props = buildProps(layout, layoutSymbolRef)
  const get = name => getDataValue(props, name, zoom, feature)
  const textField = get('text-field')
  let text = textField
  if (typeof text === 'string') {
    text = resolveTokens(feature.properties || {}, text)
  } else if (text && text.sections) {
    for (const section of text.sections) {
      section.text = resolveTokens(feature.properties || {}, section.text)
    }
    text = text.toString()
  }
  const textTransform = get('text-transform')
  if (textTransform === 'uppercase') text = String(text).toUpperCase()
  else if (textTransform === 'lowercase') text = String(text).toLowerCase()
  return {
    text: text || '',
    font: get('text-font') || 'Open Sans Regular, Arial Unicode MS Regular',
    textSize: get('text-size') ?? 16,
    textAnchor: get('text-anchor') || 'center',
    textOffset: get('text-offset') || [0, 0]
  }
}

/**
 * Symbol 图层 paint 求值（text-color, text-halo-color, text-halo-width）
 */
export function evaluateSymbolPaint(styleLayer, zoom, feature) {
  const paint = styleLayer.paint || {}
  const props = buildProps(paint, paintSymbolRef)
  const get = name => getDataValue(props, name, zoom, feature)
  const textColor = get('text-color') || { r: 0, g: 0, b: 0, a: 1 }
  const haloColor = get('text-halo-color') || { r: 0, g: 0, b: 0, a: 1 }
  const haloWidth = get('text-halo-width') ?? 0
  return {
    textColor,
    outlineColor: haloColor,
    outlineWidth: haloWidth
  }
}

function resolveTokens(properties, text) {
  return String(text).replace(/\{([^{}]+)\}/g, (match, key) =>
    properties && key in properties ? String(properties[key]) : ''
  )
}
