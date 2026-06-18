import { VectorTileset } from '../VectorTileset'
import { IRenderLayer } from './IRenderLayer'
import { registerRenderLayer } from './registerRenderLayer'
import { warnOnce } from 'maplibre-gl/src/util/util'

export class BackgroundRenderLayer extends IRenderLayer {
  createPrimitve(frameState, tileset) {
    const style = this.style
    const tile = this.tile
    const color = style.convertColor(
      style.paint.getDataConstValue('background-color', tile.z)
    )
    const opacity = style.paint.getDataConstValue('background-opacity', tile.z)
    const pattern = style.paint.getDataConstValue('background-pattern', tile.z)
    if (pattern) {
      return warnOnce('background图层：不支持纹理填充')
    }
    color.alpha *= opacity

    const primitive = new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({
        geometry: new Cesium.RectangleGeometry({
          rectangle: this.tile.rectangle
        })
      }),
      compressVertices: false,
      asynchronous: false,
      appearance: new Cesium.MaterialAppearance({
        translucent: false,
        material: Cesium.Material.fromType('Color', {
          color: color
        }),
        flat: true
      })
    })

    this.primitive = primitive
  }

  /**
   * @param {Cesium.FrameState} frameState
   * @param {VectorTileset} tileset
   */
  update(frameState, tileset) {
    super.update(frameState, tileset)

    if (this.visibility == 'none') return

    if (!this.primitive) {
      this.createPrimitve(frameState, tileset)
    }
    if (this.primitive && !this.commandList.length) {
      const preCommandList = frameState.commandList
      const layerCommandList = (frameState.commandList = this.commandList)

      this.primitive.update(frameState)

      //DrawCommand创建完成后，关闭深度写入，开启深度测试
      if (layerCommandList.length > 0) {
        const renderState = Cesium.RenderState.fromCache({
          blending: Cesium.BlendingState.ALPHA_BLEND,
          depthMask: false,
          depthTest: {
            enabled: true
          },
          cull: {
            enabled: true
          }
        })
        for (const layerCommand of layerCommandList) {
          layerCommand.renderState = renderState
          layerCommand.pass = Cesium.Pass.CESIUM_3D_TILE
        }
        this.state = 'done'
      }

      if (this.primitive._state === Cesium.PrimitiveState.FAILED) {
        this.state = 'error'
      }

      frameState.commandList = preCommandList
    }
    if (this.primitive && this.paintNeedsUpdate) {
      const style = this.style,
        tile = this.tile
      const color = style.convertColor(
        style.paint.getDataConstValue('background-color', tile.z)
      )
      const opacity = style.paint.getDataConstValue(
        'background-opacity',
        tile.z
      )
      color.alpha *= opacity
      this.primitive.appearance.material.uniforms.color = color

      this.paintNeedsUpdate = false
    }
  }

  destroy() {
    this.primitive = this.primitive && this.primitive.destroy()
    super.destroy()
  }
}

registerRenderLayer('background', BackgroundRenderLayer)
