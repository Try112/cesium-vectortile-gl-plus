import { VectorTileset } from './VectorTileset'
import * as MVT from '@mapbox/vector-tile'
import {
  IRenderLayer,
  ILayerVisualizer,
  RenderLayers,
  LayerVisualizers
} from './layers'
import { VectorTileRenderList } from './VectorTileRenderList'
import { ISource } from './sources/ISource'
import { EXTENT } from 'maplibre-gl/src/data/extent'
import Point from '@mapbox/point-geometry'
import { subdivideVertexLine } from 'maplibre-gl/src/render/subdivision'
import { granularitySettings } from './sources/granularitySettings'
import { warnOnce } from 'maplibre-gl/src/util/util'

let tileDepthRenderSate = null
let nextTileKey = 0
let levelZeroMaximumGeometricError = null
/**
 * 计算指定LOD层级的最大几何误差，相当于动态计算3DTiles中geometricError，只是形瓦片的几何误差是一个层级的所有瓦片都相同（rectangle大小都一样）
 * @param {number} z 瓦片层级（整数，不是地图的缩放级别）
 * @param {Cesium.TilingScheme} tilingScheme
 * @returns
 */
function getLevelMaximumGeometricError(z, tilingScheme) {
  if (levelZeroMaximumGeometricError === null) {
    levelZeroMaximumGeometricError =
      Cesium.TerrainProvider.getEstimatedLevelZeroGeometricErrorForAHeightmap(
        tilingScheme.ellipsoid,
        128,
        tilingScheme.getNumberOfXTilesAtLevel(0)
      )
  }
  return levelZeroMaximumGeometricError / (1 << z)
}

/**
 * LOD调度重要参数SSE的计算函数，从Cesium地形调度模块中提取出来的代码，调度逻辑和地形瓦片的一致
 * @param {Cesium.FrameState} frameState
 * @param {VectorTileLOD} tile
 * @returns
 */
function screenSpaceError(frameState, tile) {
  const maxGeometricError = getLevelMaximumGeometricError(
    tile.z,
    tile.tilingScheme
  )

  const distance2 = tile.distanceToCamera
  const height = frameState.context.drawingBufferHeight
  const sseDenominator = frameState.camera.frustum.sseDenominator
  let error = (maxGeometricError * height) / (distance2 * sseDenominator)
  if (frameState.fog.enabled) {
    error -=
      Cesium.Math.fog(distance2, frameState.fog.density) * frameState.fog.sse
  }
  error /= frameState.pixelRatio
  return error
}

function initConstants() {
  if (tileDepthRenderSate !== null) return

  tileDepthRenderSate = Cesium.RenderState.fromCache({
    id: 'vt_tile-depth',
    blending: Cesium.BlendingState.DISABLED,
    depthTest: {
      enabled: true
    },
    depthMask: true,
    cull: {
      enabled: true
    },
    stencilMask: Cesium.StencilConstants.CESIUM_3D_TILE_MASK,
    stencilTest: {
      backFunction: 519,
      backOperation: { fail: 7680, zFail: 7680, zPass: 7681 },
      enabled: true,
      frontFunction: 519,
      frontOperation: { fail: 7680, zFail: 7680, zPass: 7681 },
      mask: 128,
      reference: 128
    },
    colorMask: {
      red: false,
      green: false,
      blue: false,
      alpha: false
    }
  })
}

export class VectorTileLOD {
  constructor(options) {
    initConstants()

    this.x = options.x
    this.y = options.y
    this.z = options.z
    /**暂时用不到，但是还是记录父级瓦片 */
    this.parent = options.parent
    this.children = []

    /**@type {Cesium.TilingScheme} */
    this.tilingScheme = options.tilingScheme
    this.rectangle = this.tilingScheme.tileXYToRectangle(this.x, this.y, this.z)
    /**
     * Cesium.TileBoundingRegion 不是公开的API，但是可以从Cesium地形调度相关模块源码学习，
     */
    this.tileBoundingRegion = new Cesium.TileBoundingRegion({
      rectangle: this.rectangle,
      minimumHeight: 0,
      maximumHeight: 0,
      ellipsoid: this.tilingScheme.ellipsoid,
      computeBoundingVolumes: true
    })

    /**@type {IRenderLayer[]} */
    this.layers = []
    /**@type {ILayerVisualizer[]} */
    this.visualizers = []
    /**
     * 保存pbf/mvt文件解析结果，准备创建图层（要素过滤）时候进一步读取要素，创建图层渲染对象时读取要素几何数据
     * @type {Record<string,MVT.VectorTile>}
     */
    this.sources = {}

    this.tileId = null
    /**
     * 记录最近一次访问时间（用渲染帧数表示），用于筛选过期瓦片
     */
    this.lastVisitTime = 0
    /**
     * 瓦片调度状态
     * @type {'none'|'loading'|'loaded'|'ready'|'error'}
     */
    this.state = 'none'
    this.renderable = false

    this.tileId = {
      x: this.x,
      y: this.y,
      z: this.z,
      key: nextTileKey++,
      color: Cesium.Color.fromRgba(nextTileKey - 1),
      tileColor: Cesium.Color.fromRandom({
        alpha: 1
      })
    }

    const size = EXTENT * Math.pow(2, this.z),
      x0 = EXTENT * this.x,
      y0 = EXTENT * this.y
    this.transformPoint = function (x, y, lonlat) {
      lonlat[0] = ((x + x0) * 360) / size - 180
      lonlat[1] =
        (360 / Math.PI) *
          Math.atan(Math.exp((1 - ((y + y0) * 2) / size) * Math.PI)) -
        90
      return lonlat //[x, y]
    }
  }

  createChildren() {
    var tiles = [
      {
        x: this.x * 2,
        y: this.y * 2 + 1,
        z: this.z + 1
      },
      {
        x: this.x * 2 + 1,
        y: this.y * 2 + 1,
        z: this.z + 1
      },
      {
        x: this.x * 2,
        y: this.y * 2,
        z: this.z + 1
      },
      {
        x: this.x * 2 + 1,
        y: this.y * 2,
        z: this.z + 1
      }
    ]

    for (const { x, y, z } of tiles) {
      var child = new VectorTileLOD({
        x,
        y,
        z,
        tilingScheme: this.tilingScheme,
        parent: this
      })
      this.children.push(child)
    }
  }

  /**
   * @param {Cesium.FrameState} frameState
   * @param {{visitChildren(child:VectorTileLOD):void;accept(tile:VectorTileLOD):void}} visitor
   * @returns
   */
  visit(frameState, visitor) {
    const tileBoundingRegion = this.tileBoundingRegion

    //相机视锥剔除
    this.distanceToCamera = tileBoundingRegion.distanceToCamera(frameState)
    this.visibility =
      frameState.cullingVolume.computeVisibility(tileBoundingRegion)
    if (this.visibility == Cesium.Intersect.OUTSIDE) {
      return
    }

    //性能优化：还可以进行地平线剔除更多被地球完全遮挡的瓦片

    const maxSSE = frameState.maximumScreenSpaceError
    const sse = screenSpaceError(frameState, this)
    if (sse >= maxSSE) {
      //继续遍历子级瓦片
      visitor.visitChildren(this)
    } else {
      //使用当前瓦片渲染
      visitor.accept(this)
    }
  }

  /**
   * @param {VectorTileset} tileset
   */
  async getSources(tileset) {
    /**@type {Record<string,ISource>} */
    const sourcesToLoad = {}
    const style = tileset._styleJson

    for (const styleLayer of style.layers) {
      const sourceId = styleLayer.source
      const source = tileset.sources[sourceId]
      if (source && !sourcesToLoad[sourceId]) {
        sourcesToLoad[sourceId] = source
      }
    }

    const useWorker =
      tileset._taskProcessor &&
      Object.values(sourcesToLoad).every(s => s.type === 'vector')

    if (useWorker) {
      for (const sourceId in sourcesToLoad) {
        const source = sourcesToLoad[sourceId]
        try {
          const data = await source.requestTileBuffer(
            this.x,
            this.y,
            this.z,
            tileset
          )
          if (data && data.buffer) {
            this.sources[sourceId] = data
          }
        } catch (err) {}
      }
      this._workerBuffers = true
    } else {
      for (const sourceId in sourcesToLoad) {
        const source = sourcesToLoad[sourceId]
        try {
          const tileData = await source.requestTile(
            this.x,
            this.y,
            this.z,
            tileset
          )
          if (tileData) {
            this.sources[sourceId] = tileData
          }
        } catch (err) {}
      }
    }

    tileset.numLoading--
    this.state = 'loaded'
  }

  /**
   * @param {Cesium.FrameRateMonitor} frameState
   * @param {VectorTileset} tileset
   */
  async createRenderLayers(frameState, tileset) {
    const sources = this.sources
    const styleLayers = tileset._styleLayers
    const renderLayers = this.layers
    const visualizers = this.visualizers
    /**@type {Record<string,ILayerVisualizer>} */
    const visualizerMap = {}

    for (const styleLayer of styleLayers) {
      const sourceVectorTile = sources[styleLayer.source]
      /**
       * 按图层类型获取对应的渲染图层类
       * @type {typeof IRenderLayer}
       */
      const RenderLayer = RenderLayers[styleLayer.type]
      const LayerVisualizer = LayerVisualizers[styleLayer.type]
      const isBackgroundLayer = styleLayer.type === 'background'
      if (!RenderLayer) {
        warnOnce('不支持图层类型' + styleLayer.type)
      }
      if ((!isBackgroundLayer && !sourceVectorTile) || !RenderLayer) continue

      const features = []
      if (!isBackgroundLayer) {
        const sourceType =
          styleLayer.source && tileset.sources[styleLayer.source].type
        const sourceLayer =
          sourceType == 'geojson' ? '_geojsonTileLayer' : styleLayer.sourceLayer
        const vectorTileLayer = sourceVectorTile.layers[sourceLayer]
        if (!vectorTileLayer) continue

        //读取要素，并根据图层样式filter表达式进行过滤
        //性能优化：同一帧读取和过滤大量要素，耗时较长，应该将其移到Web Worker
        const featureCount = vectorTileLayer.length
        for (let i = 0; i < featureCount; i++) {
          //读取要素
          const feature = vectorTileLayer.feature(i)
          //过滤要素
          if (
            styleLayer.filter &&
            !styleLayer.filter.filter({ zoom: this.z }, feature)
          ) {
            continue
          }
          //MLT的Feature类没有实现toGeoJSON方法，直接使用MVT的方法
          if (!feature.toGeoJSON) {
            feature.toGeoJSON = MVT.VectorTileFeature.prototype.toGeoJSON
          }
          features.push(feature)
        }
        if (!features.length) continue
      }

      //创建渲染图层
      const renderLayer = new RenderLayer(features, styleLayer, this)
      renderLayers.push(renderLayer)

      //将渲染图层分配到对应类型的图层渲染器，图层渲染器应实现如下功能，以提升渲染性能：
      //1、合批创建几何体、批次表和 DrawCommand；
      //2、克隆合批DrwaCommand，创建副本，通过offset和count指定图层的绘制范围。
      if (LayerVisualizer) {
        let visualizer = visualizerMap[styleLayer.type]
        if (!visualizer) {
          visualizer = new LayerVisualizer(this)
          visualizerMap[styleLayer.type] = visualizer
          visualizers.push(visualizer)
        }
        visualizer.addLayer(features, renderLayer, frameState, tileset)
      }
    }

    this.state = 'ready'
  }

  /**
   * 从 Web Worker 结果创建渲染图层与 Visualizer（仅几何数据来自 Worker）
   * @param {object} result - Worker 返回的 { fill, line, symbol }
   * @param {Cesium.FrameState} frameState
   * @param {VectorTileset} tileset
   */
  createRenderLayersFromWorkerResult(result, frameState, tileset) {
    if (result.error) {
      this.state = 'error'
      return
    }
    const styleLayers = tileset._styleLayers
    const renderLayers = this.layers
    const visualizers = this.visualizers
    /**@type {Record<string,ILayerVisualizer>} */
    const visualizerMap = {}

    for (const item of result.fill || []) {
      const styleLayer = styleLayers.find(l => l.id === item.layerId)
      if (!styleLayer) continue
      const RenderLayer = RenderLayers.fill
      const LayerVisualizer = LayerVisualizers.fill
      const renderLayer = new RenderLayer([], styleLayer, this)
      renderLayers.push(renderLayer)
      let visualizer = visualizerMap.fill
      if (!visualizer) {
        visualizer = new LayerVisualizer(this)
        visualizerMap.fill = visualizer
        visualizers.push(visualizer)
      }
      visualizer.addLayerFromWorkerResult(
        item,
        renderLayer,
        frameState,
        tileset
      )
    }

    for (const item of result.line || []) {
      const styleLayer = styleLayers.find(l => l.id === item.layerId)
      if (!styleLayer) continue
      const RenderLayer = RenderLayers.line
      const LayerVisualizer = LayerVisualizers.line
      const renderLayer = new RenderLayer([], styleLayer, this)
      renderLayers.push(renderLayer)
      let visualizer = visualizerMap.line
      if (!visualizer) {
        visualizer = new LayerVisualizer(this)
        visualizerMap.line = visualizer
        visualizers.push(visualizer)
      }
      visualizer.addLayerFromWorkerResult(
        item,
        renderLayer,
        frameState,
        tileset
      )
    }

    for (const item of result.circle || []) {
      const styleLayer = styleLayers.find(l => l.id === item.layerId)
      if (!styleLayer) continue
      const RenderLayer = RenderLayers.circle
      const renderLayer = new RenderLayer(item.points || [], styleLayer, this)
      renderLayers.push(renderLayer)
    }

    for (const item of result.symbol || []) {
      const styleLayer = styleLayers.find(l => l.id === item.layerId)
      if (!styleLayer) continue
      const RenderLayer = RenderLayers.symbol
      const LayerVisualizer = LayerVisualizers.symbol
      const renderLayer = new RenderLayer([], styleLayer, this)
      renderLayers.push(renderLayer)
      let visualizer = visualizerMap.symbol
      if (!visualizer) {
        visualizer = new LayerVisualizer(this)
        visualizerMap.symbol = visualizer
        visualizers.push(visualizer)
      }
      visualizer.addLayerFromWorkerResult(
        item,
        renderLayer,
        frameState,
        tileset
      )
    }

    this.state = 'ready'
  }

  /**
   * @param {Cesium.FrameState} frameState
   * @param {VectorTileRenderList} renderList
   * @param {VectorTileset} tileset
   */
  update(frameState, renderList, tileset) {
    // 这里构建的 primitive 有如下用途：
    // 1. showTileColor 设置为 true 时，展示瓦片范围，验证LOD调度效果
    // 2. 生成绘制瓦片 id 的 DrawCommand，在 VectorTileset 中实时更新瓦片id纹理，实现瓦片边界精准裁剪

    if (!this.primitive) {
      this.primitive = new Cesium.Primitive({
        geometryInstances: new Cesium.GeometryInstance({
          geometry: new Cesium.RectangleGeometry({
            rectangle: this.rectangle
          })
        }),
        compressVertices: false,
        asynchronous: false,
        appearance: new Cesium.MaterialAppearance({
          flat: true,
          translucent: false,
          material: Cesium.Material.fromType('Color', {
            color: Cesium.Color.fromAlpha(this.tileId.tileColor, 0.25)
          }),
          renderState: {
            blending: Cesium.BlendingState.ALPHA_BLEND,
            depthMask: false,
            depthTest: {
              enabled: true
            },
            cull: {
              enabled: false
            }
          }
        })
      })
      this.primitive.name = '_tile-color_'
    }

    const tileComandList = this.commandList || []
    const tileIdCommands = this.tileIdCommands || []
    const tileDepthCommands = this.tileDepthCommands || []

    if (!tileComandList.length) {
      const preCommandList = frameState.commandList
      frameState.commandList = tileComandList

      this.primitive.update(frameState)

      if (tileComandList.length) {
        const tileIdColor = this.tileId.color
        for (const tileComand of tileComandList) {
          tileComand.pass = Cesium.Pass.CESIUM_3D_TILE

          const tileIdCommand = Cesium.DrawCommand.shallowClone(tileComand)
          tileIdCommand.renderState = Cesium.RenderState.fromCache({
            id: 'tileId',
            blending: {
              enabled: false
            },
            depthTest: {
              enabled: false
            },
            depthMask: true,
            cull: {
              enabled: true
            }
          })
          tileIdCommand.layerType = 'tile-id'
          tileIdCommand.uniformMap = {
            ...tileComand.uniformMap
          }
          tileIdCommand.uniformMap.color_0 = function () {
            return tileIdColor
          }
          tileIdCommands.push(tileIdCommand)
          // 浅克隆一个副本，renderState替换成只写入深度和开启模板测试的版本，以支持Entity和GroundPrimitive等贴地对象
          const tileDepthCommand = Cesium.DrawCommand.shallowClone(tileComand)
          tileDepthCommand.pass = Cesium.Pass.CESIUM_3D_TILE
          tileDepthCommand.renderState = tileDepthRenderSate
          tileDepthCommands.layerType = 'tile-depth'
          tileDepthCommands.push(tileDepthCommand)
        }
        this.tileIdCommands = tileIdCommands
        this.tileDepthCommands = tileDepthCommands
      }

      this.commandList = tileComandList
      frameState.commandList = preCommandList
    }

    //瓦片范围
    if (tileset.showTileColor && tileComandList.length) {
      renderList.tileCommands.push(...tileComandList)
    }

    //更新瓦片状态，根据状态执行不同的处理过程

    //请求瓦片数据，解析pbf/mvt文件
    if (this.state == 'none' && tileset.numLoading <= tileset.maxLoading) {
      tileset.numLoading++
      this.state = 'loading'
      this.getSources(tileset)
    }

    //创建渲染图层实例（主线程或 Worker 路径）
    if (
      this.state === 'loaded' &&
      tileset.numInitializing < tileset.maxInitializing
    ) {
      if (this._workerBuffers && tileset._taskProcessor) {
        const parameters = {
          sources: {},
          x: this.x,
          y: this.y,
          z: this.z,
          extent: EXTENT,
          styleLayers: tileset._styleLayers.map(sl => ({
            id: sl.id,
            type: sl.type,
            source: sl.source,
            sourceLayer: sl.sourceLayer ?? sl.data['source-layer'],
            filter: sl.data.filter,
            paint: sl.data.paint,
            layout: sl.data.layout
          }))
        }
        const transferableObjects = []
        for (const sourceId in this.sources) {
          const data = this.sources[sourceId]
          if (data && data.buffer) {
            parameters.sources[sourceId] = {
              buffer: data.buffer,
              encoding: data.encoding || 'mvt'
            }
            transferableObjects.push(data.buffer)
          }
        }
        const promise = tileset._taskProcessor.scheduleTask(
          parameters,
          transferableObjects
        )
        if (Cesium.defined(promise)) {
          this.state = 'initializing'
          tileset.numInitializing++
          promise
            .then(result => {
              this.createRenderLayersFromWorkerResult(
                result,
                frameState,
                tileset
              )
            })
            .catch(() => {
              this.state = 'error'
            })
        }
      } else {
        this.state = 'initializing'
        tileset.numInitializing++
        this.createRenderLayers(frameState, tileset)
      }
    }

    if (this.state === 'ready') {
      let visualizerReady = true,
        layersReady = true
      //更新图层渲染器
      for (const visualizer of this.visualizers) {
        visualizer.update(frameState, tileset)
        if (visualizer.state === 'none') {
          visualizerReady = false
        }
      }
      for (const layer of this.layers) {
        layer.update(frameState, tileset)
        if (layer.visibility != 'none' && layer.state == 'none') {
          layersReady = false
        }
      }
      //标记瓦片是否可渲染
      this.renderable = visualizerReady && layersReady
    }
  }

  render(frameState, renderList, tileset) {
    if (!this.renderable) {
      return
    }

    const tileComandList = this.commandList
    const tileIdCommands = this.tileIdCommands
    const tileDepthCommands = this.tileDepthCommands

    //将渲染图层追加到相应的渲染队列（渲染队列内部按图层id分组，确保不同瓦片的同一个id图层都在一组内，然后按图层顺序逐组渲染）
    for (const layer of this.layers) {
      renderList.push(layer)
    }

    for (const visualizer of this.visualizers) {
      renderList.visualizers.push(visualizer)
    }

    //瓦片id纹理
    for (const tileIdCommand of tileIdCommands) {
      renderList.tileIdCommands.push(tileIdCommand)
    }

    //最后将瓦片深度写入主深度缓冲区，这样才能使Entity和GroundPrimitive等贴地对象能贴合瓦片内的矢量要素
    if (tileDepthCommands.length) {
      renderList.tileCommands.push(...tileDepthCommands)
    }
  }

  /**
   * 卸载瓦片，当瓦片过期（不可见，且符合其他过期规则）时，释放pbf/mvt解析数据、图层渲染对象等资源，重置瓦片状态
   */
  unload() {
    //释放用于展示瓦片范围的primitive
    if (this.primitive) {
      this.primitive.destroy()
      this.primitive = null
    }
    this.tileGeometry = null

    //清空瓦片克隆的 DrawCommand，不需要手动释放，相关资源在 primitive.destroy 执行时已经释放
    if (this.commandList) {
      this.commandList.length = 0
    }
    if (this.tileIdCommands) {
      this.tileIdCommands.length = 0
    }
    if (this.tileDepthCommands) {
      this.tileDepthCommands.length = 0
    }

    //销毁渲染图层，释放图层渲染资源
    for (const visualizer of this.visualizers) {
      visualizer.destroy()
    }
    this.visualizers.length = 0

    for (const layer of this.layers) {
      layer.destroy()
    }
    this.layers.length = 0

    //释放pbf/mvt解析数据
    this.sources = {}

    //重置瓦片状态
    this.state = 'none'
  }

  /**
   * 销毁瓦片，释放所有资源
   */
  destroy() {
    this.unload()

    this.tileId = null
    this.tilingScheme = null
    this.parent = null
    if (this.children) {
      for (const child of this.children) {
        child.destroy()
      }
      this.children.length = 0
      this.children = null
    }
  }
}
