import { featureFilter, Color } from '@maplibre/maplibre-gl-style-spec'
import { StyleLayerProperties } from './StyleLayerProperties'

export class StyleLayer {
  /**
   * @param {import('@maplibre/maplibre-gl-style-spec').LayerSpecification} layer
   */
  constructor(layer) {
    this.data = layer
    this.type = layer.type
    this.id = layer.id
    this.minzoom = layer.minzoom || 0
    this.maxzoom = layer.maxzoom || 24
    this.source = layer.source
    /**@type {string} */
    this.sourceLayer = layer['source-layer']
    /**@type {import("@maplibre/maplibre-gl-style-spec").FeatureFilter|null} */
    this.filter = null
    this.paint = new StyleLayerProperties('paint_' + layer.type, layer.paint)
    this.layout = new StyleLayerProperties('layout_' + layer.type, layer.layout)
    if (layer.filter) {
      this.filter = featureFilter(layer.filter)
    }
    this.paintVersion = 0
  }

  setLayoutProperty(name, value) {
    return this.layout.setProperty(name, value)
  }

  setPaintProperty(name, value) {
    const changed = this.paint.setProperty(name, value)
    if (changed) {
      this.paintVersion++
    }
    return changed
  }

  setFilter(filter) {
    if (!filter) {
      const changed = Cesium.defined(this.filter)
      this.filter = null
      delete this.data.filter
      return changed
    } else if (JSON.stringify(this.data.filter) !== JSON.stringify(filter)) {
      this.data.filter = filter
      this.filter = featureFilter(filter)
      return true
    }
    return false
  }

  /**
   * 转换图层样式颜色，内部进行预乘Alpha的逆处理，@maplibre/maplibre-gl-style-spec内部会自动对颜色进行premultiplyAlpha操作，直接使用会出现明显的色差
   * @param {Color} styleColor
   * @param {Cesium.Color} [result]
   * @returns
   */
  convertColor(styleColor, result) {
    if (!styleColor) return
    const alphaScalar = styleColor.a > 0 ? 1 / styleColor.a : 1
    if (!result) {
      result = new Cesium.Color()
    }
    result.red = styleColor.r * alphaScalar
    result.green = styleColor.g * alphaScalar
    result.blue = styleColor.b * alphaScalar
    result.alpha = styleColor.a
    return result
  }
}
