import * as MVT from '@mapbox/vector-tile'
import { StyleLayer } from '../style/StyleLayer'
import { VectorTileLOD } from '../VectorTileLOD'
import { IRenderLayer } from './IRenderLayer'
import { SymbolLayerVisualizer } from './visualizers/SymbolLayerVisualizer'
import { registerRenderLayer } from './registerRenderLayer'

export class SymbolRenderLayer extends IRenderLayer {
  /**
   * @param {MVT.VectorTileFeature[]} sourceFeatures
   * @param {StyleLayer} style
   * @param {VectorTileLOD} tile
   */
  constructor(sourceFeatures, styleLayer, tile) {
    super(sourceFeatures, styleLayer, tile)
    this.labels = []
  }

  /**
   * @param {Cesium.FrameState} frameState
   * @param {VectorTileset} tileset
   */
  update(frameState, tileset) {
    //TODO：动态更新符号样式
    if (this.paintNeedsUpdate) {
      const style = this.style,
        tile = this.tile

      for (let i = 0; i < this.features.length; i++) {
        const feature = this.features[i]
        const label = this.labels[i]

        const textColor = style.convertColor(
          style.paint.getDataValue('text-color', tile.z, feature)
        )
        const outlineColor = style.convertColor(
          style.paint.getDataValue('text-halo-color', tile.z, feature)
        )
        const outlineWidth = style.paint.getDataValue(
          'text-halo-width',
          tile.z,
          feature
        )

        feature.textColor = textColor
        feature.outlineColor = outlineColor
        feature.outlineWidth = outlineWidth

        label.fillColor = textColor
        label.style = outlineWidth && Cesium.LabelStyle.FILL_AND_OUTLINE
        label.outlineWidth = outlineWidth * feature.textSize
        label.outlineColor = outlineColor

        label._baseFillColor = label.fillColor.clone()
        label._baseOutlineColor = label.outlineColor.clone()
      }

      this.paintNeedsUpdate = false
    }

    super.update(frameState, tileset)
  }
}

registerRenderLayer('symbol', SymbolRenderLayer, SymbolLayerVisualizer)
