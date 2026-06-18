import { ILayerVisualizer } from './visualizers/ILayerVisualizer'
import { IRenderLayer } from './IRenderLayer'

/**
 * @type {Record<string,typeof IRenderLayer>}
 */
const RenderLayers = {}
/**
 * @type {Record<string,typeof ILayerVisualizer>}
 */
const LayerVisualizers = {}

/**
 * 注册图层类型，设置渲染图层类和图层渲染器类（非必须）
 * @param {"symbol" | "fill" | "line" | "circle" | "heatmap" | "fill-extrusion" | "raster" | "hillshade" | "color-relief" | "background"} type 图层类型
 * @param {typeof IRenderLayer} renderLayerCls 渲染图层类，必须继承 IRenderLayer
 * @param {typeof ILayerVisualizer} [layerVisualizerCls] 图层渲染器类，必须继承 ILayerVisualizer
 */
function registerRenderLayer(type, renderLayerCls, layerVisualizerCls) {
  RenderLayers[type] = renderLayerCls
  LayerVisualizers[type] = layerVisualizerCls
}

export { RenderLayers, LayerVisualizers, registerRenderLayer }
