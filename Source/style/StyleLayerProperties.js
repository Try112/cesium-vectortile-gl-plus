import { expression, latest } from '@maplibre/maplibre-gl-style-spec'
import { warnOnce } from 'maplibre-gl/src/util/util'

const FALLBACK_STYLE_GROUPS = {
  paint_circle: {
    'circle-color': { default: { r: 0, g: 0, b: 0, a: 1 } },
    'circle-radius': { default: 5 },
    'circle-opacity': { default: 1 },
    'circle-stroke-color': { default: { r: 1, g: 1, b: 1, a: 1 } },
    'circle-stroke-width': { default: 0 }
  },
  layout_circle: {
    visibility: { default: 'visible' }
  }
}

export class StyleLayerProperties {
  constructor(groupName, styleProperties = {}) {
    this.data = styleProperties
    /**@type {Map<string,import('@maplibre/maplibre-gl-style-spec').StylePropertyExpression>} */
    this.props = new Map()
    this.groupName = groupName

    const groupReference = latest[groupName] || FALLBACK_STYLE_GROUPS[groupName] || {}
    for (const key in groupReference) {
      if (Object.hasOwnProperty.call(groupReference, key)) {
        const reference = groupReference[key]
        const value = styleProperties[key]
        const property = expression.normalizePropertyExpression(
          value === undefined ? reference.default : value,
          reference
        )
        this.props.set(key, property)
      }
    }
  }

  setProperty(name, value) {
    const groupReference = latest[this.groupName]
    if (Object.hasOwnProperty.call(groupReference, name)) {
      const reference = groupReference[name]
      const oldValue = this.data[name]
      if (oldValue === value) {
        return false
      }
      const property = expression.normalizePropertyExpression(
        !Cesium.defined(value) ? reference.default : value,
        reference
      )
      this.props.set(name, property)
      return true
    } else {
      warnOnce(`maplibre样式规范不支持属性：${this.groupName}.${name}`)
      return false
    }
  }

  /**
   * Replace tokens in a string template with values in an object
   *
   * @param properties - a key/value relationship between tokens and replacements
   * @param text - the template string
   * @returns the template with tokens replaced
   */
  resolveTokens(properties, text) {
    return text.replace(/{([^{}]+)}/g, (_, key) => {
      return properties && key in properties ? String(properties[key]) : ''
    })
  }
  getDataConstValue(name, zoom) {
    const expr = this.props.get(name)
    return expr && expr.evaluate({ zoom })
  }

  getDataValue(name, zoom, feature) {
    const expr = this.props.get(name)
    return expr && expr.evaluate({ zoom }, feature)
  }
}
