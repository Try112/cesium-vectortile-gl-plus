import { VectorTileset } from '../VectorTileset'
import { IRenderLayer } from './IRenderLayer'
import { registerRenderLayer } from './registerRenderLayer'
import { FillLayerVisualizer } from './visualizers/FillLayerVisualizer'

export class FillRenderLayer extends IRenderLayer {
  constructor(sourceFeatures, styleLayer, tile) {
    super(sourceFeatures, styleLayer, tile)
    this.outlineOffsets = []
    this.outlineCounts = []
  }
  /**
   * @param {Cesium.FrameState} frameState
   * @param {VectorTileset} tileset
   */
  update(frameState, tileset) {
    //可以在这里实现同步样式，动态更新图层颜色等样式
    if (this.paintNeedsUpdate) {
      const style = this.style,
        tile = this.tile,
        batchTable = this._batchTable

      for (const feature of this.features) {
        const fillColor = style.convertColor(
          style.paint.getDataValue('fill-color', tile.z, feature)
        )
        const fillOpacity = style.paint.getDataValue(
          'fill-opacity',
          tile.z,
          feature
        )
        feature.fillColor = fillColor
        feature.fillOpacity = fillOpacity

        const batchId = feature.batchId
        const colorBytes = fillColor.toBytes()
        colorBytes[3] = Math.floor(colorBytes[3] * fillOpacity)
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
}

registerRenderLayer('fill', FillRenderLayer, FillLayerVisualizer)
