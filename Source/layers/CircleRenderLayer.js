import * as MVT from '@mapbox/vector-tile'
import { StyleLayer } from '../style/StyleLayer'
import { VectorTileset } from '../VectorTileset'
import { VectorTileLOD } from '../VectorTileLOD'
import { IRenderLayer } from './IRenderLayer'
import { registerRenderLayer } from './registerRenderLayer'

export class CircleRenderLayer extends IRenderLayer {
  /**
   * @param {MVT.VectorTileFeature[]} sourceFeatures
   * @param {StyleLayer} styleLayer
   * @param {VectorTileLOD} tile
   */
  constructor(sourceFeatures, styleLayer, tile) {
    super(sourceFeatures, styleLayer, tile)
    /**@type {Cesium.PointPrimitiveCollection|null} */
    this.primitive = null
    /**@type {Cesium.PointPrimitive[]} */
    this.points = []
    this._destroyed = false
  }

  addPoint(coord, sourceFeature, overridePaint = null) {
    const style = this.style
    const tile = this.tile
    const paint = style.paint
    const circleColor = style.convertColor(
      overridePaint?.circleColor ||
        paint.getDataValue('circle-color', tile.z, sourceFeature)
    )
    const circleOpacity =
      overridePaint?.circleOpacity ??
      paint.getDataValue('circle-opacity', tile.z, sourceFeature) ??
      1
    const circleRadius =
      overridePaint?.circleRadius ??
      paint.getDataValue('circle-radius', tile.z, sourceFeature) ??
      5
    const rawStrokeColor =
      overridePaint?.circleStrokeColor ||
      paint.getDataValue('circle-stroke-color', tile.z, sourceFeature)
    const circleStrokeColor = rawStrokeColor
      ? style.convertColor(rawStrokeColor)
      : Cesium.Color.TRANSPARENT.clone()
    const circleStrokeWidth =
      overridePaint?.circleStrokeWidth ??
      paint.getDataValue('circle-stroke-width', tile.z, sourceFeature) ??
      0

    const color = circleColor.clone()
    color.alpha *= circleOpacity

    const point = new Cesium.PointPrimitive({
      position: Cesium.Cartesian3.fromDegrees(coord[0], coord[1], 0),
      pixelSize: Math.max(Number(circleRadius) * 2, 1),
      color,
      outlineColor: circleStrokeColor,
      outlineWidth: Math.max(Number(circleStrokeWidth), 0),
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    })
    this.points.push(point)
  }

  createPrimitve(frameState, tileset) {
    void frameState
    void tileset
    this.points.length = 0

    const tile = this.tile
    for (const sourceFeature of this.sourceFeatures) {
      const feature = sourceFeature.toGeoJSON(tile.x, tile.y, tile.z)
      if (!feature.geometry) continue

      const geometryType = feature.geometry.type
      const coordinates = feature.geometry.coordinates
      const points = []
      if (geometryType === 'Point') {
        points.push(coordinates)
      } else if (geometryType === 'MultiPoint') {
        points.push(...coordinates)
      } else {
        continue
      }

      for (const coord of points) {
        this.addPoint(coord, sourceFeature)
      }
    }
  }

  updatePrimitive(frameState) {
    if (!this.primitive && this.points.length) {
      const primitive = new Cesium.PointPrimitiveCollection()
      for (const point of this.points) {
        primitive.add(point)
      }
      this.primitive = primitive
    }

    if (this.primitive) {
      this.commandList.length = 0
      const preCommandList = frameState.commandList
      frameState.commandList = this.commandList
      this.primitive.update(frameState)
      frameState.commandList = preCommandList
    }
  }

  /**
   * @param {Cesium.FrameState} frameState
   * @param {VectorTileset} tileset
   */
  update(frameState, tileset) {
    if (this._destroyed) return

    super.update(frameState, tileset)
    if (this.visibility === 'none') return

    if (!this.primitive && !this.points.length) {
      this.createPrimitve(frameState, tileset)
    }

    this.updatePrimitive(frameState)

    this.state = 'done'
  }

  destroy() {
    this._destroyed = true
    this.primitive = this.primitive && this.primitive.destroy()
    if (this.points) this.points.length = 0
    super.destroy()
  }
}

registerRenderLayer('circle', CircleRenderLayer)
