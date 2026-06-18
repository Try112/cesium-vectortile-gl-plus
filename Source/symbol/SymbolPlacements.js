import { GridIndex } from 'maplibre-gl/src/symbol/grid_index'
import { IRenderLayer } from '../layers/IRenderLayer'

//参考 maplibre-gl/src/symbol/CollisionIndex.ts

// When a symbol crosses the edge that causes it to be included in
// collision detection, it will cause changes in the symbols around
// it. This constant specifies how many pixels to pad the edge of
// the viewport for collision detection so that the bulk of the changes
// occur offscreen. Making this constant greater increases label
// stability, but it's expensive.
const viewportPadding = 100
let scratchScreenSpacePosition = null
let scratchScreenSpaceBoundingBox = null

/**
 * 基于 maplibre-gl GridIndex 实现符号碰撞检测（自动避让）。文字碰撞检测结果存放在 label 对象的扩展属性 vtPlaceable，该值为true表示文字可以显示到屏幕
 */
export class SymbolPlacements {
  constructor() {
    scratchScreenSpacePosition = new Cesium.Cartesian2()
    scratchScreenSpaceBoundingBox = new Cesium.BoundingRectangle()
  }
  /**
   * @param {Cesium.FrameState} frameState
   * @param {IRenderLayer[]} orderedRenderLayers
   * @param {number} zoom
   */
  update(frameState, orderedRenderLayers, zoom) {
    const width = frameState.context.drawingBufferWidth / frameState.pixelRatio
    const height =
      frameState.context.drawingBufferHeight / frameState.pixelRatio
    const scene = frameState.camera._scene

    const grid = new GridIndex(
      width + 2 * viewportPadding,
      height + 2 * viewportPadding,
      25
    )

    for (const layer of orderedRenderLayers) {
      const style = layer.style
      /**@type {Cesium.Label[]} */
      const labels = layer.labels
      if (
        layer.type !== 'symbol' ||
        layer.visibility === 'none' ||
        zoom < style.minzoom ||
        zoom >= style.maxzoom ||
        !Cesium.defined(labels) ||
        !labels.length
      ) {
        continue
      }

      //layout属性取值时 getDataConstValue 的 zoom 参数取瓦片层级，而不是全局缩放层级
      const textAllowOverlap = style.layout.getDataConstValue(
        'text-allow-overlap',
        layer.tile.z
      )
      const textOverlap = style.layout.getDataConstValue(
        'text-overlap',
        layer.tile.z
      )
      const textOverlapMode = getOverlapMode(textOverlap, textAllowOverlap)
      const textPadding = style.layout.getDataConstValue(
        'text-padding',
        layer.tile.z
      )

      for (const label of labels) {
        const position = label.computeScreenSpacePosition(
          scene,
          scratchScreenSpacePosition
        )
        if (!position) {
          //可能未准备就绪，先标记为可以摆放，确保Cesium能生成文字
          label.vtPlaceable = true
          continue
        }
        /**@type {Cesium.BoundingRectangle} */
        const box = Cesium.Label.getScreenSpaceBoundingBox(
          label,
          position,
          scratchScreenSpaceBoundingBox
        )

        const tlX = box.x - textPadding,
          tlY = box.y - textPadding,
          brX = tlX + box.width + textPadding,
          brY = tlY + box.height + textPadding
        if (!grid.hitTest(tlX, tlY, brX, brY, textOverlapMode, null)) {
          //二维包围盒碰撞检测
          const textKey = { overlapMode: textOverlapMode }
          grid.insert(textKey, tlX, tlY, brX, brY)
          label.vtPlaceable = true
        } else {
          label.vtPlaceable = false
        }
      }
    }
  }
}

function getOverlapMode(overlap, allowOverlap) {
  let result = 'never'

  if (overlap) {
    // if -overlap is set, use it
    result = overlap
  } else if (allowOverlap) {
    // fall back to -allow-overlap, with false='never', true='always'
    result = 'always'
  }

  return result
}
