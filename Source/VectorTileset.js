import { VectorTileLOD } from './VectorTileLOD'
import { StyleLayer } from './style/StyleLayer'
import './layers/index'
import { VectorTileRenderList } from './VectorTileRenderList'
import { Sources } from './sources'
import { ISource } from './sources/ISource'
import { warnOnce } from 'maplibre-gl/src/util/util'
import { SymbolPlacements } from './symbol/SymbolPlacements'

export class VectorTileset {
  /**
   * @param {object} options
   * @param {string|import('@maplibre/maplibre-gl-style-spec').StyleSpecification} options.style
   * @param {boolean} [options.showTileColor=false]
   * @param {string} [options.workerUrl] - Web Worker 脚本 URL，用于瓦片解析/几何计算；不传则走主线程
   * @param {number} [options.maximumActiveTasks=4] - 同时进行的 Worker 任务数，与 maxLoading 配合
   */
  constructor(options) {
    this.maximumLevel = 24
    this.show = true
    this.showTileColor = !!options.showTileColor
    this.ready = false
    this.tilingScheme = new Cesium.WebMercatorTilingScheme()

    this.readyEvent = new Cesium.Event()
    this.errorEvent = new Cesium.Event()

    this._styleJson = null
    this._style = options.style
    this._rootTiles = []
    this._cacheTiles = []
    this._tilesToUpdate = []
    this._tilesToRender = []
    /**@type {StyleLayer[]} */
    this._styleLayers = []
    this._styleLayerIndexMap = new Map()
    /**@type {VectorTileRenderList} */
    this._renderList = new VectorTileRenderList(this._styleLayers)
    this.numLoading = 0
    this.maxLoading = 6
    this.numInitializing = 0
    this.maxInitializing = 6
    /**@type {Cesium.TaskProcessor|null} */
    this._taskProcessor = null
    this._workerUrl = options.workerUrl || null
    this._maximumActiveTasks = options.maximumActiveTasks ?? 4
    /**@type {Cesium.Texture} */
    this.tileIdTexture = null
    this.zoom = 0
    this.scene = null
    this._destroyed = false
    this._initRafId = null
    this._initVersion = 0
    /**@type {Cesium.CustomDataSource|null} */
    this._circleDataSource = null
    /**
     * 负责符号碰撞检测（自动避让），SymbolPlacements 内部基于 maplibre-gl GridIndex 实现
     */
    this._symbolPlacements = new SymbolPlacements()

    this._initRafId = requestAnimationFrame(() => {
      this._initRafId = null
      this.init()
    })
  }

  async init() {
    const currentVersion = ++this._initVersion
    if (this._destroyed) return

    let style = this._style
    if (!style) {
      this.errorEvent.raiseEvent(new Error('请传入 style 参数'))
      return
    }

    this.path = ''
    if (typeof style == 'string') {
      this.path = style.split('/').slice(0, -1).join('/')
      if (this.path) this.path += '/'
      style = await Cesium.Resource.fetchJson(style)
    }

    if (this._destroyed || currentVersion !== this._initVersion) return

    //初始化数据源

    /** @type {{[sourceId:string]:ISource}}*/
    this.sources = {}
    for (const sourceId in style.sources) {
      /**@type {import('@maplibre/maplibre-gl-style-spec').SourceSpecification} */
      const sourceParams = style.sources[sourceId]
      const SourceCls = Sources[sourceParams.type]
      if (SourceCls) {
        this.sources[sourceId] = new SourceCls(sourceParams, this.path)
        try {
          await this.sources[sourceId].init()
          if (this._destroyed || currentVersion !== this._initVersion) return
          this.maximumLevel = Math.min(
            sourceParams.maxzoom || 24,
            this.maximumLevel
          )
        } catch (err) {
          if (!this._destroyed && currentVersion === this._initVersion) {
            this.errorEvent.raiseEvent(err)
          }
        }
      }
    }

    if (this._destroyed || currentVersion !== this._initVersion) return

    //初始化样式图层
    for (let i = 0; i < style.layers.length; i++) {
      this._styleLayers[i] = new StyleLayer(style.layers[i])
      this._styleLayerIndexMap.set(style.layers[i].id, i)
    }

    //创建顶级瓦片LOD
    const numX = this.tilingScheme.getNumberOfXTilesAtLevel(0)
    const numY = this.tilingScheme.getNumberOfYTilesAtLevel(0)
    let i = 0
    for (let y = 0; y < numY; y++) {
      for (let x = 0; x < numX; x++) {
        var tile = new VectorTileLOD({
          parent: this,
          x,
          y,
          z: 0,
          tilingScheme: this.tilingScheme
        })
        tile.createChildren()
        this._rootTiles[i++] = tile
      }
    }

    //初始化渲染队列
    this._renderList.init()

    if (this._destroyed || currentVersion !== this._initVersion) return

    // Web Worker：有 workerUrl 时创建 TaskProcessor，供瓦片解析/几何计算使用
    if (this._workerUrl && typeof Cesium.TaskProcessor !== 'undefined') {
      this._taskProcessor = new Cesium.TaskProcessor(
        this._workerUrl,
        Math.min(this._maximumActiveTasks, this.maxInitializing)
      )
    }

    if (this._destroyed || currentVersion !== this._initVersion) return

    this._styleJson = style
    this.ready = true
    this.readyEvent.raiseEvent(this)
  }

  //更新瓦片id纹理，用于裁剪超出瓦片边界的像素
  executeTileIdCommands(frameState) {
    const tileIdCommands = this._renderList.tileIdCommands

    if (tileIdCommands.length > 0) {
      const context = frameState.context
      /**@type {Cesium.FrameBuffer} */
      let tileIdFbo = this._tileIdFbo
      if (!tileIdFbo) {
        tileIdFbo = new Cesium.FramebufferManager({
          depthStencil: true,
          supportsDepthTexture: true
        })
        this._tileIdFbo = tileIdFbo
        this._idClearCommand = new Cesium.ClearCommand({
          color: new Cesium.Color(0.0, 0.0, 0.0, 0.0),
          depth: 1.0,
          stencil: 0.0
        })
      }
      const pixelDatatype = context.floatingPointTexture
        ? Cesium.PixelDatatype.FLOAT
        : Cesium.PixelDatatype.UNSIGNED_BYTE
      const width = context.drawingBufferWidth
      const height = context.drawingBufferHeight
      tileIdFbo.update(context, width, height, 1, pixelDatatype)
      tileIdFbo.clear(context, this._idClearCommand)

      const framebuffer = tileIdFbo.framebuffer
      for (const tileIdCommand of tileIdCommands) {
        tileIdCommand.framebuffer = framebuffer
        tileIdCommand.execute(context)
      }

      this.tileIdTexture = tileIdFbo.getColorTexture(0)
    }
  }

  update(frameState) {
    if (!this.ready || !this.show) return

    if (frameState.context.webgl2) {
      warnOnce('webgl2模式下贴地线面的支持将导致性能下降')
    }

    const renderList = this._renderList
    //清空渲染队列
    renderList.beginFrame()

    this.numInitializing = 0

    /**@type {Cesium.Globe} */
    const scene = frameState.camera._scene
    const globe = scene.globe
    const globeSuspendLodUpdate = globe._surface._debug.suspendLodUpdate
    this.scene = scene
    this.dataSources = scene?.dataSources || null
    if (scene?.dataSources && !this._circleDataSource) {
      this._circleDataSource = new Cesium.CustomDataSource('circle-global')
      scene.dataSources.add(this._circleDataSource)
    }

    // 获取可见瓦片
    // 优化：采用更高效的LOD调度算法，获取当前帧实际可渲染到屏幕的瓦片，避免出现瓦片层级切换时候出现闪烁

    /**@type {VectorTileLOD[]} */
    const tilesToUpdate = getTilesToUpdate(frameState, this)
    // const tilesToUpdate = globeSuspendLodUpdate ? this._tilesToUpdate : getTilesToUpdate(frameState, this)

    //瓦片排序，决定瓦片加载瓦片数据、初始化的优先级
    //优化：采用更精细、高效的优先级策略
    if (!globeSuspendLodUpdate) {
      tilesToUpdate.sort((a, b) => a.distanceToCamera - b.distanceToCamera)
    }

    //更新瓦片状态：请求瓦片数据，创建渲染图层，初始化等
    for (const tile of tilesToUpdate) {
      tile.lastVisitTime = frameState.frameNumber
      tile.expired = false
      tile.update(frameState, renderList, this)
    }

    /**@type {VectorTileLOD[]} */
    const tilesToRender = globeSuspendLodUpdate
      ? this._tilesToRender
      : getTilesToRender(tilesToUpdate, this._tilesToRender)
    if (!globeSuspendLodUpdate) {
      tilesToRender.sort((a, b) => a.distanceToCamera - b.distanceToCamera)
    }
    //渲染瓦片内容
    for (const tile of tilesToRender) {
      tile.lastVisitTime = frameState.frameNumber
      tile.expired = false
      tile.render(frameState, renderList, this)
    }

    //渲染图层分组、排序
    const orderedRenderLayers = renderList.getList()
    //符号碰撞检测
    this._symbolPlacements.update(frameState, orderedRenderLayers, this.zoom)
    //获取渲染命令（DrawCommand），渲染图层内部可以使用Primitive、PolylineCollection、LabelCollection、BillboardCollection等API，
    //也可以自定义DrawCommand
    for (const renderLayer of orderedRenderLayers) {
      renderLayer.render(frameState, this)
    }
    for (const visualizer of renderList.visualizers) {
      visualizer.render(frameState, this)
    }
    //瓦片颜色、深度
    frameState.commandList.push(...renderList.tileCommands)

    this.executeTileIdCommands(frameState)

    //释放过期瓦片
    //优化：使用更高效的内存缓存管理策略
    const expiredTiles = []
    for (const cacheTile of this._cacheTiles) {
      if (cacheTile.lastVisitTime < frameState.frameNumber) {
        if (!cacheTile.expired) expiredTiles.push(cacheTile)
      }
    }
    expiredTiles.sort((a, b) => a.lastVisitTime - b.lastVisitTime)
    if (expiredTiles.length > 100) {
      for (const expiredTile of expiredTiles) {
        expiredTile.unload()
        expiredTile.expired = true
        if (expiredTiles.length <= 50) break
      }
    }
  }

  //样式编辑API

  setLayoutProperty(layerId, name, value) {
    const styleLayerIndexMap = this._styleLayerIndexMap
    if (!styleLayerIndexMap.has(layerId)) {
      warnOnce(`不存在图层：${layerId}`)
      return false
    }
    const layerIndex = styleLayerIndexMap.get(layerId)
    const styleLayer = this._styleLayers[layerIndex]
    const changed = styleLayer.setLayoutProperty(name, value)
    //强制更新
    if (changed && name !== 'visibility') {
      this._forceUpdate()
    }
    return changed
  }

  setPaintProperty(layerId, name, value) {
    const styleLayerIndexMap = this._styleLayerIndexMap
    if (!styleLayerIndexMap.has(layerId)) {
      warnOnce(`不存在图层：${layerId}`)
      return false
    }
    const layerIndex = styleLayerIndexMap.get(layerId)
    const styleLayer = this._styleLayers[layerIndex]
    return styleLayer.setPaintProperty(name, value)
  }

  setFilter(layerId, filter) {
    const styleLayerIndexMap = this._styleLayerIndexMap
    if (!styleLayerIndexMap.has(layerId)) {
      warnOnce(`不存在图层：${layerId}`)
      return false
    }
    const layerIndex = styleLayerIndexMap.get(layerId)
    const styleLayer = this._styleLayers[layerIndex]
    const changed = styleLayer.setFilter(filter)
    if (changed) {
      this._forceUpdate()
    }
    return changed
  }

  //强制更新
  _forceUpdate() {
    for (const cacheTile of this._cacheTiles) {
      cacheTile.unload()
    }
    for (const cacheTile of this._tilesToRender) {
      cacheTile.unload()
    }
    for (const cacheTile of this._tilesToUpdate) {
      cacheTile.unload()
    }
    this._tilesToRender.length = 0
    this._tilesToUpdate.length = 0
  }

  destroy() {
    this._destroyed = true
    this._initVersion++
    if (this._initRafId != null) {
      if (typeof window !== 'undefined' && window.cancelAnimationFrame) {
        window.cancelAnimationFrame(this._initRafId)
      }
      this._initRafId = null
    }

    const scene = this.scene
    const rootTiles = this._rootTiles
    if (scene?.dataSources) {
      try {
        const dataSources = scene.dataSources
        for (let i = dataSources.length - 1; i >= 0; i--) {
          const ds = dataSources.get(i)
          if (ds && typeof ds.name === 'string' && ds.name === 'circle-global') {
            dataSources.remove(ds, true)
          }
        }
      } catch (_) {
        // ignore
      }
    }
    this.scene = null
    if (scene && scene.primitives.contains(this)) {
      scene.primitives.remove(this)
    }

    if (rootTiles) {
      for (const tile of rootTiles) {
        tile.destroy()
      }
      rootTiles.length = 0
      this._rootTiles = null
    }
    if (this._cacheTiles) {
      this._cacheTiles.length = 0
      this._cacheTiles = null
    }

    if (this.sources) {
      for (const key in this.sources) {
        if (Object.hasOwnProperty.call(this.sources, key)) {
          const source = this.sources[key]
          source.destroy()
        }
      }
      this.sources = null
    }
    this._styleLayers = null

    if (this._renderList) {
      this._renderList.destroy()
      this._renderList = null
    }

    if (this._taskProcessor && !this._taskProcessor.isDestroyed()) {
      this._taskProcessor.destroy()
      this._taskProcessor = null
    }

    if (this._tilesToUpdate) {
      this._tilesToUpdate.length = 0
      this._tilesToUpdate = null
    }

    if (this._tilesToRender) {
      this._tilesToRender.length = 0
      this._tilesToRender = null
    }

    if (this._tileIdFbo) {
      this._tileIdFbo.destroy()
      this.tileIdTexture = null
      this._tileIdFbo = null
      this._idClearCommand = null
    }

    this._styleJson = null
  }

  isDestroyed() {
    return false
  }
}

/**
 * 遍历LOD四叉树，获取所有可见瓦片，取离相机最近的一个瓦片的 z 作为全局缩放参数 zoom
 * @param {Cesium.FrameState} frameState
 * @param {VectorTileset} tileset
 * @returns
 */
function getTilesToUpdate(frameState, tileset) {
  const queue = [...tileset._rootTiles]
  const tilesToUpdate = tileset._tilesToUpdate
  let zoom = 24,
    nearDist = Infinity
  const visitor = {
    //当see大于阈值，继续查找子级瓦片
    visitChildren(tile) {
      if (tile.z >= tileset.maximumLevel) {
        if (tile.distanceToCamera < nearDist) {
          nearDist = tile.distanceToCamera
          zoom = tile.z
        }
        return tilesToUpdate.push(tile)
      }

      if (tile.children.length == 0) {
        tile.createChildren()
        for (const child of tile.children) {
          tileset._cacheTiles.push(child)
        }
      }
      for (const child of tile.children) {
        queue.push(child)
      }
    },
    //否则使用当前瓦片填充视口
    accept(tile) {
      if (tile.distanceToCamera < nearDist) {
        nearDist = tile.distanceToCamera
        zoom = tile.z
      }
      tilesToUpdate.push(tile)
    }
  }

  tilesToUpdate.length = 0

  do {
    const tile = queue.shift()
    tile.visit(frameState, visitor)
  } while (queue.length > 0)

  tileset.zoom = zoom

  return tilesToUpdate
}

/**
 * 获取可渲染瓦片
 * @param {VectorTileLOD[]} tilesToUpdate
 * @param {VectorTileLOD[]} tilesToRender
 * @returns
 */
function getTilesToRender(tilesToUpdate, tilesToRender) {
  const cache = new Map()
  for (const newTile of tilesToUpdate) {
    if (newTile.renderable) {
      cache.set(newTile, true)
    }
  }

  //在当前可渲染瓦片队列中，找出上一帧所有可渲染瓦片的后代节点瓦片，只有当后代节点瓦片都可渲染才被替代
  const descendantsList = []
  for (let i = 0; i < tilesToRender.length; i++) {
    const oldTile = tilesToRender[i]

    oldTile.renderable = cache.has(oldTile)
    if (oldTile.renderable) continue //前后两帧都可见，不需要特殊处理

    const descendants = {
      tiles: [],
      total: 0,
      renderable: 0
    }
    descendantsList[i] = descendants

    for (const newTile of tilesToUpdate) {
      const dz = newTile.z - oldTile.z
      if (dz === 0) {
        continue
      } else if (dz > 0) {
        //针对需要后代瓦片替换祖先瓦片的情况：先记录所有可见的后代瓦片，并统计可渲染后代瓦片数量
        const scale = Math.pow(2, dz),
          newAncestorX = Math.floor(newTile.x / scale),
          newAncestorY = Math.floor(newTile.y / scale)

        if (newAncestorX === oldTile.x && newAncestorY === oldTile.y) {
          descendants.total++
          descendants.tiles.push(newTile)
          if (newTile.renderable) descendants.renderable++
        }
      } else {
        //针对需要祖先瓦片覆盖后代瓦片的情况：祖先瓦片可渲染则显示，否则继续显示后代瓦片
        const scale = Math.pow(2, -dz),
          oldAncestorX = Math.floor(oldTile.x / scale),
          oldAncestorY = Math.floor(oldTile.y / scale)

        if (oldAncestorX === newTile.x && oldAncestorY === newTile.y) {
          oldTile.renderable = !newTile.renderable
        }
      }
    }
  }

  //针对后代瓦片替换祖先瓦片的情况：只有所有可见的后代瓦片都可渲染，才显示后代瓦片，否则继续显示祖先瓦片
  for (let i = 0; i < tilesToRender.length; i++) {
    const oldTile = tilesToRender[i]
    const descendants = descendantsList[i]
    if (descendants && descendants.total) {
      const descendantsRenderable = descendants.total === descendants.renderable
      oldTile.renderable = !descendantsRenderable
      for (const descendantTile of descendants.tiles) {
        descendantTile.renderable = descendantsRenderable
      }
    }
  }

  //从 tilesToUpdate 和 tilesToRender 中筛选最终可渲染的瓦片

  cache.clear()

  let length = tilesToRender.length
  for (let i = 0; i < length; i++) {
    const tileToRender = tilesToRender.shift()
    if (tileToRender.renderable) {
      tilesToRender.push(tileToRender)
      cache.set(tileToRender, true)
    }
  }

  length = tilesToUpdate.length
  for (let i = 0; i < length; i++) {
    const tileToUpdate = tilesToUpdate[i]
    if (tileToUpdate.renderable && !cache.has(tileToUpdate)) {
      tilesToRender.push(tileToUpdate)
      cache.set(tileToUpdate, true)
    }
  }

  return tilesToRender
}
