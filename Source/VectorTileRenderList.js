import { ILayerVisualizer } from './layers/visualizers/ILayerVisualizer'
import { IRenderLayer } from './layers/IRenderLayer'

export class VectorTileRenderList {
  constructor(styleLayers) {
    this.styleLayers = styleLayers
    this.renderLayers = []
    this.layerIndexMap = {}
    /**
     * @type {IRenderLayer[]}
     * @private
     */
    this.list = []
    /**@type {Cesium.DrawCommand[]} */
    this.tileIdCommands = []
    /**@type {Cesium.DrawCommand[]} */
    this.tileCommands = []
    /**@type {ILayerVisualizer[]} */
    this.visualizers = []
  }

  init() {
    const { styleLayers, renderLayers, layerIndexMap } = this
    for (let layerIndex = 0; layerIndex < styleLayers.length; layerIndex++) {
      const styleLayer = styleLayers[layerIndex]
      renderLayers[layerIndex] = []
      layerIndexMap[styleLayer.id] = layerIndex
    }
    this.tileIdCommands.length = 0
    this.tileCommands.length = 0
    this.visualizers.length = 0
  }

  beginFrame() {
    const renderLayers = this.renderLayers
    for (const renderLayer of renderLayers) {
      renderLayer.length = 0
    }
    this.tileIdCommands.length = 0
    this.tileCommands.length = 0
    this.visualizers.length = 0
  }

  push(renderLayer) {
    const layerIndex = this.layerIndexMap[renderLayer.id]
    this.renderLayers[layerIndex].push(renderLayer)
  }

  /**
   * @returns {IRenderLayer[]}
   */
  getList() {
    const list = this.list
    list.length = 0
    const renderLayers = this.renderLayers
    for (const renderLayer of renderLayers) {
      if (renderLayer) {
        list.push(...renderLayer)
      }
    }
    return list
  }

  destroy() {
    this.styleLayers.length = 0
    this.renderLayers.length = 0
    this.layerIndexMap = null
    this.init()
  }
}
