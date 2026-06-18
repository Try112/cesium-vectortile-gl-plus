import { VectorTile } from '@mapbox/vector-tile'

/**
 * 数据源基类，定义通用属性和必须实现的方法（init、requestTile）
 * @see VectorSource
 * @see GeoJSONSource
 */
export class ISource {
  /**
   * 构造数据源实例。注意：该构造函数由VectorTileset调用，请勿在其他模块直接调用
   * @param {import('@maplibre/maplibre-gl-style-spec').SourceSpecification} styleSource
   * @param {string} [path]
   * @see VectorSource
   * @see GeoJSONSource
   */
  constructor(styleSource, path = '') {
    /**@type {"vector"|"geojson"} */
    this.type = styleSource.type
    /**@type {import('@maplibre/maplibre-gl-style-spec').SourceSpecification} */
    this.styleSource = styleSource
    this.path = path
    this.errorEvent = new Cesium.Event()
  }

  async init() {}

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {Promise<VectorTile>}
   */
  requestTile(x, y, z) {}

  destroy() {
    this.styleSource = null
    this.errorEvent = null
  }
}
