import * as MVT from '@mapbox/vector-tile'
import { StyleLayer } from '../style/StyleLayer'
import { VectorTileset } from '../VectorTileset'
import { IRenderLayer } from './IRenderLayer'
import { registerRenderLayer } from './registerRenderLayer'
import { VectorTileLOD } from '../VectorTileLOD'
import { LineLayerVisualizer } from './visualizers/LineLayerVisualizer'
import { warnOnce } from 'maplibre-gl/src/util/util'

export class LineRenderLayer extends IRenderLayer {
  /**
   * @param {MVT.VectorTileFeature[]} sourceFeatures
   * @param {StyleLayer} styleLayer
   * @param {VectorTileLOD} tile
   */
  constructor(sourceFeatures, styleLayer, tile) {
    super(sourceFeatures, styleLayer, tile)
    this.primitive = null
    this.dasharray = []
    this.dashLength = 0
  }

  createPrimitve(frameState, tileset) {
    const primitive = new Cesium.PolylineCollection()
    const sourceFeatures = this.sourceFeatures
    const style = this.style
    const tile = this.tile

    function addPolyline(coordinates, lineWidth, lineColor) {
      if (coordinates.length < 2) return

      const positions = coordinates.map(coord =>
        Cesium.Cartesian3.fromDegrees(coord[0], coord[1])
      )
      primitive.add({
        positions,
        width: lineWidth,
        material: Cesium.Material.fromType('Color', {
          color: style.convertColor(lineColor)
        })
      })
    }

    for (const sourceFeature of sourceFeatures) {
      const feature = sourceFeature.toGeoJSON(tile.x, tile.y, tile.z)
      if (!feature.geometry) continue

      //读取图层样式属性
      const lineWidth = style.paint.getDataValue(
        'line-width',
        tile.z,
        sourceFeature
      )
      const lineColor = style.paint.getDataValue(
        'line-color',
        tile.z,
        sourceFeature
      )

      const geometryType = feature.geometry.type
      const coordinates = feature.geometry.coordinates
      if (geometryType == 'LineString') {
        addPolyline(coordinates, lineWidth, lineColor)
      } else if (
        geometryType == 'MultiLineString' ||
        geometryType == 'Polygon'
      ) {
        for (const ring of coordinates) {
          addPolyline(ring, lineWidth, lineColor)
        }
      } else if (geometryType == 'MultiPolygon') {
        for (const polygon of coordinates) {
          for (const ring of polygon) {
            addPolyline(ring, lineWidth, lineColor)
          }
        }
      } else {
        console.log('暂不支持几何类型：' + geometryType)
      }
    }

    this.primitive = primitive
  }

  /**
   * @param {Cesium.FrameState} frameState
   * @param {VectorTileset} tileset
   */
  update(frameState, tileset) {
    // if (!this.primitive) {
    //     this.createPrimitve(frameState, tileset)
    // }
    // if (this.primitive && this.primitive.length) {
    //     this.primitive.update(frameState)
    //     this._batchTable = primitive._batchTable
    // }
    if (this.paintNeedsUpdate) {
      const style = this.style,
        tile = this.tile,
        batchTable = this._batchTable

      for (const feature of this.features) {
        const lineWidth = style.paint.getDataValue(
          'line-width',
          tile.z,
          feature
        )
        const lineColor = style.convertColor(
          style.paint.getDataValue('line-color', tile.z, feature)
        )
        const lineOpacity = style.paint.getDataValue(
          'line-opacity',
          tile.z,
          feature
        )

        if (lineWidth !== feature.lineWidth) {
          warnOnce('不支持动态修改 line 图层样式属性：line-width')
        }

        feature.lineColor = lineColor
        feature.lineOpacity = lineOpacity
        feature.lineWidth = lineWidth

        const batchId = feature.batchId
        const colorBytes = lineColor.toBytes()
        colorBytes[3] = Math.floor(colorBytes[3] * lineOpacity)
        batchTable.setBatchedAttribute(batchId, 0, {
          x: colorBytes[0],
          y: colorBytes[1],
          z: colorBytes[2],
          w: colorBytes[3]
        })
      }

      this.paintNeedsUpdate = false
    }
    super.update(frameState, tileset)
  }

  destroy() {
    this.primitive = this.primitive && this.primitive.destroy()
    super.destroy()
  }
}

registerRenderLayer('line', LineRenderLayer, LineLayerVisualizer)
