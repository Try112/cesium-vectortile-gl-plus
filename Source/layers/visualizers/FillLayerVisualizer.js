import { VectorTileFeature, classifyRings } from '@mapbox/vector-tile'
import { IRenderLayer } from '../IRenderLayer'
import { ILayerVisualizer } from './ILayerVisualizer'
import { loadGeometry } from 'maplibre-gl/src/data/load_geometry'
import { EXTENT } from 'maplibre-gl/src/data/extent'
import { subdividePolygon } from 'maplibre-gl/src/render/subdivision'
import { granularitySettings } from '../../sources/granularitySettings'
import { warnOnce } from 'maplibre-gl/src/util/util'
import { VectorTileset } from '../../VectorTileset'

export class FillFeature {
  constructor() {
    this.featureId = 0
    this.fillColor = Cesium.Color.BLACK.clone()
    this.fillOpacity = 1
    this.coordinates = []
  }
}

export class FillLayerVisualizer extends ILayerVisualizer {
  constructor(layers, tile) {
    super(layers, tile)

    this.geometryInstances = []
    this.outlineGeometryInstances = []
    this.primitive = null
    this.commandsReady = false
  }

  /**
   * @param {VectorTileFeature[]} features
   * @param {IRenderLayer} layer
   * @param {Cesium.frameState} frameState
   * @param {VectorTileset} tileset
   */
  addLayer(features, layer, frameState, tileset) {
    const style = layer.style
    const { tile, geometryInstances } = this
    const granularity =
      granularitySettings.globe.line.getGranularityForZoomLevel(tile.z) / 2
    const scope = this
    let featureId = 0
    const promoteId = tileset.sources[layer.style.source].styleSource.promoteId

    for (const sourceFeature of features) {
      const featureType = VectorTileFeature.types[sourceFeature.type]
      const properties = sourceFeature.properties
      if (featureType !== 'Polygon') continue

      const fillPattern = style.paint.getDataValue(
        'fill-pattern',
        tile.z,
        sourceFeature
      )
      if (fillPattern) {
        warnOnce('fill图层：不支持纹理填充（fill-pattern）')
        continue
      }

      const sourceFeatureId = sourceFeature.id || properties[promoteId]
      //读取图层样式属性
      const fillColor = style.convertColor(
        style.paint.getDataValue('fill-color', tile.z, sourceFeature)
      )
      const fillOpacity = style.paint.getDataValue(
        'fill-opacity',
        tile.z,
        sourceFeature
      )

      const fillOutlineColor =
        style.convertColor(
          style.paint.getDataValue('fill-outline-color', tile.z, sourceFeature)
        ) || fillColor

      //关键：对投影坐标细分，而不是使用cesium内置的细分
      const vtCoords = loadGeometry(sourceFeature)
      const polygons = classifyRings(vtCoords)
      for (const coordinates of polygons) {
        if (coordinates.some(ring => ring.length < 3)) continue

        const batchId = geometryInstances.length
        if (featureId == 0) {
          layer.firstBatchId = batchId
        }
        layer.lastBatchId = batchId

        const fillFeature = {
          coordinates,
          featureId,
          fillColor,
          fillOpacity,
          fillOutlineColor,
          properties,
          //保存原始数据的要素id，后续可以用来支持 featureState 表达式，这个表达式可以实现选定要素高亮显示
          id: sourceFeatureId,
          //保存batchId，将矢量要素与几何顶点关联，后续可以实时更新图层样式
          batchId
        }

        scope.addFeature(fillFeature, granularity)
        layer.features.push(fillFeature)

        featureId++
      }
    }

    layer.offsets = []
    layer.counts = []

    this.layers.push(layer)
  }

  /**
   * 从 Web Worker 结果构建图层几何体（positions/normals/indices 已由 Worker 算好）
   * @param {object} workerLayerData - { layerId, source, sourceLayer, styleLayer, batches, firstBatchId, lastBatchId }
   * @param {IRenderLayer} layer
   * @param {Cesium.FrameState} frameState
   * @param {VectorTileset} tileset
   */
  addLayerFromWorkerResult(workerLayerData, layer, frameState, tileset) {
    const { batches, firstBatchId, lastBatchId } = workerLayerData
    const geometryInstances = this.geometryInstances
    const cartesian = new Cesium.Cartesian3()

    for (const batch of batches) {
      const { positions, normals, st, indices, colorBytes, id, properties } =
        batch
      const vertCount = positions.length / 3
      const geometry = new Cesium.Geometry({
        attributes: {
          position: {
            componentDatatype: Cesium.ComponentDatatype.DOUBLE,
            componentsPerAttribute: 3,
            normalize: false,
            values: positions
          },
          normal: {
            componentDatatype: Cesium.ComponentDatatype.FLOAT,
            componentsPerAttribute: 3,
            normalize: false,
            values: normals
          },
          st: {
            componentDatatype: Cesium.ComponentDatatype.FLOAT,
            componentsPerAttribute: 2,
            normalize: false,
            values: st
          }
        },
        primitiveType: Cesium.PrimitiveType.TRIANGLES,
        indices,
        boundingSphere: Cesium.BoundingSphere.fromVertices(positions)
      })
      const cartographic = Cesium.Cartographic.fromCartesian(
        geometry.boundingSphere.center
      )
      cartographic.height = 0
      const center = Cesium.Cartographic.toCartesian(
        cartographic,
        null,
        cartesian
      )
      const instance = new Cesium.GeometryInstance({
        geometry,
        attributes: {
          color: new Cesium.GeometryInstanceAttribute({
            componentDatatype: Cesium.ComponentDatatype.UNSIGNED_BYTE,
            componentsPerAttribute: 4,
            normalize: true,
            value: Array.from(colorBytes)
          })
        },
        id: new Cesium.Entity({
          position: center,
          id,
          properties
        })
      })
      geometryInstances.push(instance)
    }

    layer.firstBatchId = firstBatchId
    layer.lastBatchId = lastBatchId
    layer.offsets = []
    layer.counts = []
    this.layers.push(layer)
  }

  /**
   * 创建一个多边形的几何体实例
   * @param {FillFeature} feature
   * @param {number} granularity
   */
  addFeature(feature, granularity) {
    const geometryInstances = this.geometryInstances
    const outlineGeometryInstances = this.outlineGeometryInstances
    const { coordinates, fillColor, fillOpacity, fillOutlineColor } = feature
    const colorBytes = fillColor.toBytes()
    colorBytes[3] = Math.floor(colorBytes[3] * fillOpacity)
    const outlineColorBytes = fillOutlineColor.toBytes()
    outlineColorBytes[3] = Math.floor(outlineColorBytes[3] * fillOpacity)

    // 使用 maplibre-gl 的 subdividePolygon 基于投影坐标进行细分，
    // 而不是在转成世界坐标后再使用 Cesium.PolygonGeometry 构建，这样才能避免出现自相交、破面等现象。
    // 商业版性能优化：将此过程移到 Web Worker ，多线程加速，同时避免主线程阻塞

    const subdivisionRes = subdividePolygon(
      coordinates,
      this.tile,
      granularity,
      true
    )
    const verticesFlattened = subdivisionRes.verticesFlattened
    const coordDeg = [0, 0],
      cartesian = new Cesium.Cartesian3()
    const vertCount = verticesFlattened.length / 2
    const positions = new Float64Array(vertCount * 3)
    const normals = new Float32Array(vertCount * 3)
    const sts = new Float32Array(vertCount * 2)

    for (let i = 0, j = 0; i < verticesFlattened.length; i += 2, j++) {
      const x = verticesFlattened[i],
        y = verticesFlattened[i + 1]
      const coord = this.tile.transformPoint(x, y, coordDeg)
      const position = Cesium.Cartesian3.fromDegrees(
        coord[0],
        coord[1],
        0,
        null,
        cartesian
      )
      positions[j * 3] = position.x
      positions[j * 3 + 1] = position.y
      positions[j * 3 + 2] = position.z

      const normal = Cesium.Cartesian3.normalize(position, position)
      normals[j * 3] = normal.x
      normals[j * 3 + 1] = normal.y
      normals[j * 3 + 2] = normal.z

      sts[j * 2] = x / EXTENT
      sts[j * 2 + 1] = y / EXTENT
    }

    const indices = new (
      vertCount > 65535
        ? Uint32Array
        : vertCount > 255
          ? Uint16Array
          : Uint8Array
    )(subdivisionRes.indicesTriangles)

    const outlineIndices = new (
      vertCount > 65535
        ? Uint32Array
        : vertCount > 255
          ? Uint16Array
          : Uint8Array
    )(subdivisionRes.indicesLineList.flat(3))

    const geometry = new Cesium.Geometry({
      attributes: {
        position: {
          componentDatatype: Cesium.ComponentDatatype.DOUBLE,
          componentsPerAttribute: 3,
          normalize: false,
          values: positions
        },
        normal: {
          componentDatatype: Cesium.ComponentDatatype.FLOAT,
          componentsPerAttribute: 3,
          normalize: false,
          values: normals
        },
        st: {
          componentDatatype: Cesium.ComponentDatatype.FLOAT,
          componentsPerAttribute: 2,
          normalize: false,
          values: sts
        }
      },
      primitiveType: Cesium.PrimitiveType.TRIANGLES,
      indices: indices,
      boundingSphere: Cesium.BoundingSphere.fromVertices(positions)
    })
    const outlineGeometry = new Cesium.Geometry({
      attributes: {
        position: {
          componentDatatype: Cesium.ComponentDatatype.DOUBLE,
          componentsPerAttribute: 3,
          normalize: false,
          values: positions
        }
      },
      primitiveType: Cesium.PrimitiveType.LINES,
      indices: outlineIndices,
      boundingSphere: Cesium.BoundingSphere.fromVertices(positions)
    })

    const cartographic = Cesium.Cartographic.fromCartesian(
      geometry.boundingSphere.center
    )
    cartographic.height = 0 //包围盒中心可能高于或者低于地面，需要避免双击锁定视角时进入地下
    const center = Cesium.Cartographic.toCartesian(
      cartographic,
      null,
      cartesian
    )

    const instance = new Cesium.GeometryInstance({
      geometry,
      attributes: {
        color: new Cesium.GeometryInstanceAttribute({
          componentDatatype: Cesium.ComponentDatatype.UNSIGNED_BYTE,
          componentsPerAttribute: 4,
          normalize: true,
          value: colorBytes
        })
      },
      //通过entity的形式暴露给Cesium pickEntity，这样点击时系统自带的inforbox可以弹出
      id: new Cesium.Entity({
        position: center,
        id: feature.id,
        properties: feature.properties
      })
    })
    geometryInstances.push(instance)

    const outlineInstance = new Cesium.GeometryInstance({
      geometry: outlineGeometry,
      attributes: {
        color: new Cesium.GeometryInstanceAttribute({
          componentDatatype: Cesium.ComponentDatatype.UNSIGNED_BYTE,
          componentsPerAttribute: 4,
          normalize: true,
          value: outlineColorBytes
        })
      },
      //通过entity的形式暴露给Cesium pickEntity，这样点击时系统自带的inforbox可以弹出
      id: new Cesium.Entity({
        position: center,
        id: feature.id,
        properties: feature.properties
      })
    })
    outlineGeometryInstances.push(outlineInstance)
  }

  createPrimitive() {
    const primitive = new Cesium.Primitive({
      geometryInstances: this.geometryInstances,
      asynchronous: !(
        this.geometryInstances[0].geometry instanceof Cesium.Geometry
      ),
      appearance: new Cesium.PerInstanceColorAppearance({
        flat: true,
        translucent: false,
        renderState: {
          //这里设置是没有用的，只要 translucent 为 false，
          //Cesium 内部都会覆盖成 true，所以我们需要在 DrawCommand 创建完成后再设置
          depthMask: false
        },
        fragmentShaderSource: /*glsl*/ ` 
in vec4 v_color;

uniform vec4 tileId;
uniform sampler2D tileIdTexture;

void main()
{
    vec2 id_st = gl_FragCoord.xy / czm_viewport.zw; 
    vec4 bgId = texture(tileIdTexture, id_st);
    if (!all(equal(bgId, tileId)))
    {
       discard;
    }
    out_FragColor = v_color;
}
                `
      })
    })

    //通过定义 Primitive 私有变量 _geometries、_batchTable 的 setter 和 getter，
    //监听合批几何体和批次表的创建：
    //1、几何体创建完成后，根据 batchId 和 featureId，计算每个图层几何体的起始索引（offset）和索引数量（count）
    //2、批次表创建完成后，保存备用
    let scope = this
    Object.defineProperties(primitive, {
      _geometries: {
        get() {
          return this._geometries_
        },
        set(geometries) {
          this._geometries_ = geometries
          if (geometries) {
            scope.onGeometriesLoaded(geometries)
          } else {
            scope = null
          }
        }
      },
      _batchTable: {
        get() {
          return this._batchTable_
        },
        set(batchTable) {
          this._batchTable_ = batchTable
          if (batchTable) {
            scope.onBatchTableCreated(batchTable)
          }
        }
      }
    })

    this.primitive = primitive
  }

  /**
   * 根据 batchId 和 featureId，计算每个图层几何体的起始索引（offset）和索引数量（count）
   * @param {Cesium.Geometry[]} geometries
   */
  onGeometriesLoaded(geometries) {
    //Cesium 几何体合批结果可能是多个几何体，对应多个 DrawCommand
    for (let pass = 0; pass < geometries.length; pass++) {
      const batches = {}
      const geometry = geometries[pass]
      const batchIds = geometry.attributes.batchId.values
      const indices = geometry.indices

      //提取每个批次的起始和结束索引
      let currBatchId = -1
      let currBatch = null
      for (let i = 0; i < indices.length; i++) {
        const vertIndex = indices[i]
        const batchId = batchIds[vertIndex]
        if (currBatchId !== batchId) {
          currBatchId = batchId
          currBatch = batches[currBatchId] = {
            begin: i,
            end: i
          }
        }
        currBatch.end = i
      }

      //根据图层批次范围，提取图层几何体索引范围，即起始索引（offset）和索引数量（count）
      for (const layer of this.layers) {
        const { firstBatchId, lastBatchId } = layer
        if (firstBatchId === -1 || lastBatchId === -1) {
          continue
        }

        let begin = -1,
          end = -1
        for (let batchId = firstBatchId; batchId <= lastBatchId; batchId++) {
          const batch = batches[batchId]
          if (batch) {
            if (begin === -1) begin = batch.begin
            end = batch.end
          }
        }

        if (begin === -1 || end === -1) {
          continue
        }

        //起始和结束索引，索引数量需要加1
        layer.offsets[pass] = begin
        layer.counts[pass] = end - begin + 1
      }
    }
  }

  /**
   * 保存 Cesium Primitive 创建的批次表。图层样式变化时，通过更新批次表传递到GPU，同步更新渲染效果
   * @param {Cesium.BatchTable} batchTable
   */
  onBatchTableCreated(batchTable) {
    this._batchTable = batchTable
    for (const layer of this.layers) {
      layer._batchTable = batchTable
    }
  }

  createOutlinePrimitive() {
    const primitive = new Cesium.Primitive({
      geometryInstances: this.outlineGeometryInstances,
      asynchronous: !(
        this.outlineGeometryInstances[0].geometry instanceof Cesium.Geometry
      ),
      appearance: new Cesium.PerInstanceColorAppearance({
        flat: true,
        translucent: false,
        renderState: {
          //这里设置是没有用的，只要 translucent 为 false，
          //Cesium 内部都会覆盖成 true，所以我们需要在 DrawCommand 创建完成后再设置
          depthMask: false
        },
        fragmentShaderSource: /*glsl*/ ` 
in vec4 v_color;

uniform vec4 tileId;
uniform sampler2D tileIdTexture;

void main()
{
    vec2 id_st = gl_FragCoord.xy / czm_viewport.zw; 
    vec4 bgId = texture(tileIdTexture, id_st);
    if (!all(equal(bgId, tileId)))
    {
       discard;
    }
    out_FragColor = v_color;
}
                `
      })
    })

    //通过定义 Primitive 私有变量 _geometries、_batchTable 的 setter 和 getter，
    //监听合批几何体和批次表的创建：
    //1、几何体创建完成后，根据 batchId 和 featureId，计算每个图层几何体的起始索引（offset）和索引数量（count）
    //2、批次表创建完成后，保存备用
    let scope = this
    Object.defineProperties(primitive, {
      _geometries: {
        get() {
          return this._geometries_
        },
        set(geometries) {
          this._geometries_ = geometries
          if (geometries) {
            scope.onOutlineGeometriesLoaded(geometries)
          } else {
            scope = null
          }
        }
      },
      _batchTable: {
        get() {
          return this._batchTable_
        },
        set(batchTable) {
          this._batchTable_ = batchTable
          if (batchTable) {
            scope.onOutlineBatchTableCreated(batchTable)
          }
        }
      }
    })

    this.outlinePrimitive = primitive
  }
  /**
   * 根据 batchId 和 featureId，计算每个图层几何体的起始索引（offset）和索引数量（count）
   * @param {Cesium.Geometry[]} geometries
   */
  onOutlineGeometriesLoaded(geometries) {
    //Cesium 几何体合批结果可能是多个几何体，对应多个 DrawCommand
    for (let pass = 0; pass < geometries.length; pass++) {
      const batches = {}
      const geometry = geometries[pass]
      const batchIds = geometry.attributes.batchId.values
      const indices = geometry.indices

      //提取每个批次的起始和结束索引
      let currBatchId = -1
      let currBatch = null
      for (let i = 0; i < indices.length; i++) {
        const vertIndex = indices[i]
        const batchId = batchIds[vertIndex]
        if (currBatchId !== batchId) {
          currBatchId = batchId
          currBatch = batches[currBatchId] = {
            begin: i,
            end: i
          }
        }
        currBatch.end = i
      }

      //根据图层批次范围，提取图层几何体索引范围，即起始索引（offset）和索引数量（count）
      for (const layer of this.layers) {
        const { firstBatchId, lastBatchId } = layer
        if (firstBatchId === -1 || lastBatchId === -1) {
          continue
        }

        let begin = -1,
          end = -1
        for (let batchId = firstBatchId; batchId <= lastBatchId; batchId++) {
          const batch = batches[batchId]
          if (batch) {
            if (begin === -1) begin = batch.begin
            end = batch.end
          }
        }

        if (begin === -1 || end === -1) {
          continue
        }

        //起始和结束索引，索引数量需要加1
        layer.outlineOffsets[pass] = begin
        layer.outlineCounts[pass] = end - begin + 1
      }
    }
  }
  /**
   * 保存 Cesium Primitive 创建的批次表。图层样式变化时，通过更新批次表传递到GPU，同步更新渲染效果
   * @param {Cesium.BatchTable} batchTable
   */
  onOutlineBatchTableCreated(batchTable) {
    this._outlineBatchTable = batchTable
    for (const layer of this.layers) {
      layer._outlineBatchTable = batchTable
    }
  }

  /**
   * 使用合批后的 drawCommand 创建副本，为渲染图层分配 drawCommand
   * @param {Cesium.DrawCommand[]} batchedCommandList
   * @param {VectorTileset} tileset
   */
  createLayerCommands(batchedCommandList, tileset) {
    const renderState = Cesium.RenderState.fromCache({
      id: 'fill',
      blending: Cesium.BlendingState.ALPHA_BLEND,
      depthMask: false,
      depthTest: {
        enabled: true
      },
      cull: {
        enabled: true
      }
    })
    const tileId = this.tile.tileId
    this.renderState = renderState

    for (let i = 0; i < this.layers.length; i++) {
      const layer = this.layers[i]
      const layerCommandList = (layer.commandList = [])
      const passes = {
        fill: 0,
        outline: 0
      }

      for (let i = 0; i < batchedCommandList.length; i++) {
        const command = batchedCommandList[i]
        let pass, offsets, counts
        if (command.primitiveType == Cesium.PrimitiveType.LINES) {
          pass = passes.outline++
          offsets = layer.outlineOffsets
          counts = layer.outlineCounts
        } else {
          pass = passes.fill++
          offsets = layer.offsets
          counts = layer.counts
        }

        const offset = offsets[pass],
          count = counts[pass]
        if (typeof offset !== 'number' || typeof count !== 'number') {
          continue
        }
        command.uniformMap.tileIdTexture = function () {
          return tileset.tileIdTexture
        }
        command.uniformMap.tileId = function () {
          return tileId.color
        }
        command.pass = Cesium.Pass.CESIUM_3D_TILE
        //通过副本的 offset 和 count 指定图层的绘制范围
        const layerCommand = Cesium.DrawCommand.shallowClone(command)
        layerCommand.pass = Cesium.Pass.CESIUM_3D_TILE
        layerCommand.renderState = renderState
        layerCommand.layerType = 'fill'
        layerCommand.offset = offset
        layerCommand.count = count
        layerCommandList.push(layerCommand)
      }

      layer.state = 'done'
    }

    //标记 drawCommand 创建完成
    this.state = 'done'
  }

  update(frameState, tileset) {
    if (!this.geometryInstances) {
      return
    }

    super.update(frameState, tileset)

    if (!this.primitive && this.geometryInstances.length) {
      this.createPrimitive()
      this.createOutlinePrimitive()
    }

    if (this.primitive && this.state !== 'done' && this.state !== 'error') {
      //先保存系统的 commandList
      const preCommandList = frameState.commandList
      //临时覆盖 frameState.commandList，用于获取合批之后的drawCommand
      const batchedCommandList = (frameState.commandList = [])

      //执行 primitive 的 update ，直到生成了合批后的drawCommand
      try {
        this.primitive.update(frameState)
        this.outlinePrimitive.update(frameState)
      } catch (err) {
        //如果报错，下一帧就不要再执行 update 了，以免重复打印错误信息
        this.geometryInstances = []
        this.outlineGeometryInstances = []
        this.setState('error')
        if (err.stack) console.trace(err.stack)
        else console.error(err)
        return
      } finally {
        //恢复系统的 commandList
        frameState.commandList = preCommandList
      }

      //使用合批后的 drawCommand 创建副本，为渲染图层分配 drawCommand
      if (batchedCommandList.length > 0) {
        this.createLayerCommands(batchedCommandList, tileset)
      }

      if (
        this.primitive._state === Cesium.PrimitiveState.FAILED ||
        this.outlinePrimitive._state === Cesium.PrimitiveState.FAILED
      ) {
        this.setState('error')
      }

      this.geometryInstances = []
    }

    if (this._batchTable && this._batchTable._batchValuesDirty) {
      this._batchTable.update(frameState)
    }
    if (this._outlineBatchTable && this._outlineBatchTable._batchValuesDirty) {
      this._outlineBatchTable.update(frameState)
    }
  }

  destroy() {
    this.primitive = this.primitive && this.primitive.destroy()
    this._batchTable = null
    this.geometryInstances = null

    super.destroy()
  }

  isDestroyed() {
    return false
  }
}
