import { ISource } from './ISource'
import { registerSource } from './registerSource'
import { VectorTile, VectorTileFeature } from '@mapbox/vector-tile'
import { MLTVectorTile } from 'maplibre-gl/src/source/vector_tile_mlt'
import Pbf from 'pbf'

export class VectorSource extends ISource {
  constructor(styleSource, path) {
    super(styleSource, path)
    /**@type {Cesium.WebMercatorTilingScheme} */
    this.tilingScheme = new Cesium.WebMercatorTilingScheme()
  }

  async init() {
    const sourceParams = this.styleSource
    let url = sourceParams.url
    if (url && !sourceParams.tiles) {
      url = /^((http)|(https)|(data:)|\/)/.test(url)
        ? url
        : this.path + sourceParams.url
      try {
        const metadata = await Cesium.Resource.fetchJson(url)
        for (const key in metadata) {
          if (!sourceParams[key]) {
            sourceParams[key] = metadata[key]
          }
        }
      } catch (err) {
        this.errorEvent.raiseEvent(err)
      }
    }
  }

  async requestTile(x, y, z) {
    const sourceParams = this.styleSource
    if (!sourceParams.tiles || !sourceParams.tiles.length) return
    if (sourceParams.scheme === 'tms') {
      const numOfY = this.tilingScheme.getNumberOfYTilesAtLevel(z)
      y = numOfY - y - 1
    }
    let tileUrl = sourceParams.tiles[0]
      .replace('{x}', x)
      .replace('{y}', y)
      .replace('{z}', z)
    tileUrl = /^((http)|(https)|(data:)|\/)/.test(tileUrl)
      ? tileUrl
      : this.path + tileUrl

    try {
      const tileBuf = await fetch(tileUrl).then(res => res.arrayBuffer())
      const tileData =
        sourceParams.encoding == 'mlt'
          ? new MLTVectorTile(tileBuf)
          : new VectorTile(new Pbf(tileBuf))
      return tileData
    } catch (err) {
      this.errorEvent.raiseEvent(err)
    }
  }

  /**
   * 仅拉取瓦片 ArrayBuffer，不解析；供 Web Worker 路径使用。
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {import('../../VectorTileset').VectorTileset} [tileset]
   * @returns {Promise<{buffer:ArrayBuffer,encoding:string}|undefined>}
   */
  async requestTileBuffer(x, y, z, tileset) {
    const sourceParams = this.styleSource
    if (!sourceParams.tiles || !sourceParams.tiles.length) return
    if (sourceParams.scheme === 'tms') {
      const numOfY = this.tilingScheme.getNumberOfYTilesAtLevel(z)
      y = numOfY - y - 1
    }
    let tileUrl = sourceParams.tiles[0]
      .replace('{x}', x)
      .replace('{y}', y)
      .replace('{z}', z)
    tileUrl = /^((http)|(https)|(data:)|\/)/.test(tileUrl)
      ? tileUrl
      : this.path + tileUrl

    try {
      const buffer = await fetch(tileUrl).then(res => res.arrayBuffer())
      const encoding = sourceParams.encoding === 'mlt' ? 'mlt' : 'mvt'
      return { buffer, encoding }
    } catch (err) {
      this.errorEvent.raiseEvent(err)
    }
  }
}

registerSource('vector', VectorSource)
