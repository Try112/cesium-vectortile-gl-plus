import { VectorTileFeature } from '@mapbox/vector-tile'
import { IRenderLayer } from '../IRenderLayer'
import { VectorTileset } from '../../VectorTileset'
import { VectorTileLOD } from '../../VectorTileLOD'

/**
 * 图层渲染器基类，负责瓦片内指定类型图层的合批几何体、批次表、绘图命令（DrawCommand）的构建，以及图层DrawCommand浅拷贝副本（shallow clone）的分配
 * @see FillLayerVisualizer
 * @see LineLayerVisualizer
 * @see SymbolLayerVisualizer
 */
export class ILayerVisualizer {
  /**
   * 构造图层渲染器实例。图层渲染器负责瓦片内指定类型图层的合批几何体、批次表、绘图命令（DrawCommand）的构建，以及图层DrawCommand浅拷贝副本（shallow clone）的分配。
   * 注意：构造函数仅供VectorTileLOD调用，请勿在其他模块直接调用
   * @param {VectorTileLOD} tile
   * @param {IRenderLayer[]} [layers]
   * @inner
   * @see FillLayerVisualizer
   * @see LineLayerVisualizer
   * @see SymbolLayerVisualizer
   */
  constructor(tile, layers = []) {
    /**
     * @type {VectorTileLOD}
     */
    this.tile = tile
    /**
     * @type {IRenderLayer[]}
     */
    this.layers = layers
    /**
     * 图层渲染器状态
     * @type {'none'|'done'|'error'}
     */
    this.state = 'none'
    this.commandList = []
  }

  /**
   * 添加图层：将图层及其过滤后的要素添加到图层渲染器，子类实现该方法，完成图层存储、要素转换等合批构建需要的准备工作
   * @param {VectorTileFeature[]} features
   * @param {IRenderLayer} renderLayer
   * @param {Cesium.frameState} frameState
   * @param {VectorTileset} tileset
   */
  addLayer(features, renderLayer, frameState, tileset) {}

  /**
   * 设置渲染器及图层的状态
   * @param {'none'|'done'|'error'} state
   */
  setState(state) {
    for (const layer of this.layers) {
      layer.state = state
    }
    this.state = state
  }

  /**
   * 更新渲染器：子类实现该方法，完成合批几何体、批次表、绘图命令（DrawCommand）的构建，以及图层DrawCommand浅拷贝副本（shallow clone）的分配等工作
   * @param {*} frameState
   * @param {*} tileset
   */
  update(frameState, tileset) {}

  render(frameState) {
    const commandList = this.commandList
    if (commandList && commandList.length) {
      for (const command of commandList) {
        frameState.commandList.push(command)
      }
    }
  }

  /**
   * 销毁图层渲染器对象，释放资源
   */
  destroy() {
    this.tile = null
    this.layers.length = 0
    this.isDestroyed = function returnTrue() {
      return true
    }
  }

  isDestroyed() {
    return false
  }
}
