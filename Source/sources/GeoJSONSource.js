import { ISource } from './ISource'
import { registerSource } from './registerSource'
import geojsonvt from 'geojson-vt'
import { GeoJSONWrapper } from '@maplibre/vt-pbf'
import { EXTENT } from 'maplibre-gl/src/data/extent'

export class GeoJSONSource extends ISource {
  constructor(styleSource, path) {
    super(styleSource, path)
  }

  async init() {
    /**@type {import("@maplibre/maplibre-gl-style-spec").GeoJSONSourceSpecification} */
    const sourceParams = this.styleSource
    let data = sourceParams.data
    if (typeof data === 'string') {
      const url = /^((http)|(https)|(data:)|\/)/.test(data)
        ? data
        : this.path + data
      try {
        data = await Cesium.Resource.fetchJson(url)
      } catch (err) {
        this.errorEvent.raiseEvent(err)
      }
    }
    if (data && data.features?.length) {
      this.tileIndex = new geojsonvt(data, {
        extent: EXTENT,
        buffer: sourceParams.buffer === undefined ? 128 : sourceParams.buffer,
        tolerance:
          sourceParams.tolerance === sourceParams.tolerance
            ? 0.375
            : sourceParams.tolerance
      })
    }
  }

  async requestTile(x, y, z) {
    if (!this.tileIndex) return
    try {
      const geoJSONTile = this.tileIndex.getTile(z, x, y)
      if (!geoJSONTile) return
      const geojsonWrapper = new GeoJSONWrapper(geoJSONTile.features, {
        extent: EXTENT
      })
      return geojsonWrapper
    } catch (err) {
      this.errorEvent.raiseEvent(err)
    }
  }
}

registerSource('geojson', GeoJSONSource)
