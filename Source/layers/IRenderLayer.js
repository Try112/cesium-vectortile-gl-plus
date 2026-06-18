import * as MVT from '@mapbox/vector-tile'
import { StyleLayer } from '../style/StyleLayer'
import { VectorTileset } from '../VectorTileset'
import { VectorTileLOD } from '../VectorTileLOD'
import { warnOnce } from 'maplibre-gl/src/util/util'

/**
 * 渲染要素接口，对应数据要素中的一个图形（例如 MultiLineString 中的1个多段线）
 */
export class IRenderFeature {
  constructor() {
    //如下2个属性用于表达式取值
    this.id = null
    this.properties = {}

    //如下2个属性用于同步图层样式
    this.batchId = 0
    this.featureId = 0

    //可选，批量构建几何体可能需要临时存储，创建结束后应及时释放
    this.coordinates = []
  }
}

/**
 * 渲染图层基类，定义渲染图层的通用属性和方法（更新、销毁）
 */
export class IRenderLayer {
  /**
   * 构造渲染图层实例。注意：该构造函数由VectorTileset调用，请勿在其他模块直接调用
   * @param {MVT.VectorTileFeature[]} sourceFeatures
   * @param {StyleLayer} styleLayer
   * @param {VectorTileLOD} tile
   */
  constructor(sourceFeatures, styleLayer, tile) {
    /**@type {MVT.VectorTileFeature[]} */
    this.sourceFeatures = sourceFeatures
    /**@type {StyleLayer} */
    this.style = styleLayer
    /**@type {VectorTileLOD} */
    this.tile = tile
    /**
     * @type {IRenderFeature[]}
     */
    this.features = []

    //如下5个属性是图层渲染器专用，未定义相应类型图层渲染器的可以忽略
    /**
     * 图层渲染器构造几何体实例过程中，记录当前图层第一个实例的索引，这个索引与批次表及几何体顶点数组中的的batchId一致。
     * 注意：该属性是针对图层渲染器设计，未定义相应类型图层渲染器的可以忽略
     * @type {number}
     */
    this.firstBatchId = -1
    /**
     * 图层渲染器构造几何体实例过程中，记录当前图层最后一个实例的索引，这个索引与批次表及几何体顶点数组中的的batchId一致
     * 注意：该属性是针对图层渲染器设计，未定义相应类型图层渲染器的可以忽略
     * @type {number}
     */
    this.lastBatchId = -1
    /**
     * 图层渲染器构造绘图命令后，根据 firstBatchId 、 lastBatchId 、几何体顶点数组中的 batchId 计算当前图层的绘制范围，
     * 绘制范围用几何体的起始索引和索引数量表示，对应绘图命令中的offset和count，由于 Cesium 合批构造几何体的结果仍然可能是多个几何体，
     * 所以这里用数组存储起始索引（offset）部分，与合批构造结果一一对应。
     * 注意：该属性是针对图层渲染器设计，未定义相应类型图层渲染器的可以忽略
     */
    this.offsets = []
    /**
     * 这里用数组存储索引数量（count）部分，与合批构造结果一一对应。详细说明同 offsets 注释
     * 注意：该属性是针对图层渲染器设计，未定义相应类型图层渲染器的可以忽略
     */
    this.counts = []
    /**
     * 这里用数组存储渲染器分配到图层的绘图命令（DrawCommand）副本，与合批构造结果一一对应。详细说明同 offsets 注释。
     */
    this.commandList = []
    /**
     * @type {'visible'|'none'}
     */
    this.visibility = 'visible'
    /**
     * 渲染图层状态
     * @type {'none'|'done'|'error'}
     */
    this.state = 'none'
    /**
     * 绘制（paint）属性版本号，用于监听绘制属性变化
     */
    this.paintVersion = styleLayer.paintVersion
  }

  get id() {
    return this.style.id
  }

  get type() {
    return this.style.type
  }

  get paintNeedsUpdate() {
    return this.paintVersion !== this.style.paintVersion
  }
  set paintNeedsUpdate(val) {
    if (!val) {
      this.paintVersion = this.style.paintVersion
    }
  }

  /**
   * 更渲染图层，可在该方法内实现绘图命令构建、动态样式更新等图层渲染准备相关功能。该方法可以被子类重写或复用
   * @param {Cesium.FrameState} frameState
   * @param {VectorTileset} tileset
   */
  update(frameState, tileset) {
    const visibility = this.style.layout.getDataConstValue(
      'visibility',
      this.tile.z
    )
    this.visibility = visibility
    if (visibility === 'none') return
  }

  /**
   * 从 commandList 属性获取绘图命令（DrawCommand）并加入 frameState.commandList，完成图层渲染对象到Cesium渲染管线的连接。该方法可以被子类重写或复用
   * @param {Cesium.FrameState} frameState
   * @param {VectorTileset} tileset
   * @returns
   */
  render(frameState, tileset) {
    const style = this.style,
      zoom = tileset.zoom
    if (
      this.visibility === 'none' ||
      zoom < style.minzoom ||
      zoom >= style.maxzoom
    ) {
      return
    }

    const commandList = this.commandList
    if (commandList && commandList.length) {
      for (const command of commandList) {
        frameState.commandList.push(command)
      }
    }
  }

  /**
   * 判断对象是否已销毁。基类的 destroy 会自动将该方法改写成返回值为true的版本，子类的 destroy 应通过 super.destory 调用基类的 destroy
   * @returns
   */
  isDestroyed() {
    return false
  }

  /**
   * 销毁渲染图层，释放资源。基类负责释放通用属性存储的数据，子类的 destroy 应通过 super.destory 调用基类的 destroy
   */
  destroy() {
    if (this.commandList) {
      this.commandList.length = 0
    }
    if (this.sourceFeatures) {
      this.sourceFeatures.length = 0
    }
    this.style = null
    this.offsets = null
    this.counts = null
    this.tile = null
    this.isDestroyed = function returnTrue() {
      return true
    }
  }
}
