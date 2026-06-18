import { VectorTileFeature } from '@mapbox/vector-tile'
import { IRenderLayer } from '../IRenderLayer'
import { ILayerVisualizer } from './ILayerVisualizer'
import { VectorTileset } from '../../VectorTileset'
import { subdivideVertexLine } from 'maplibre-gl/src/render/subdivision'
import { loadGeometry } from 'maplibre-gl/src/data/load_geometry'
import * as mvt from '@mapbox/vector-tile'
import { EXTENT } from 'maplibre-gl/src/data/extent'
import { granularitySettings } from '../../sources/granularitySettings'
import { warnOnce } from 'maplibre-gl/src/util/util'
import { LineRenderLayer } from '../LineRenderLayer'
const toGeoJSON = mvt.VectorTileFeature.prototype.toGeoJSON

export class LineFeature {
  constructor() {
    this.featureId = 0
    this.lineColor = Cesium.Color.BLACK.clone()
    this.lineWidth = 1
    this.lineOpacity = 1
    this.coordinates = []
  }
}

export class LineLayerVisualizer extends ILayerVisualizer {
  constructor(layers, tile) {
    super(layers, tile)

    this.geometryInstances = []
    this.primitive = null
    this.commandsReady = false
  }

  /**
   * @param {VectorTileFeature[]} features
   * @param {LineRenderLayer} layer
   * @param {Cesium.frameState} frameState
   * @param {VectorTileset} tileset
   */
  addLayer(features, layer, frameState, tileset) {
    const style = layer.style
    const { tile, geometryInstances } = this
    const granularity =
      granularitySettings.globe.line.getGranularityForZoomLevel(tile.z)
    const scope = this
    const promoteId = tileset.sources[layer.style.source].styleSource.promoteId
    let featureId = 0

    //支持虚线
    const dasharray = style.paint.getDataConstValue('line-dasharray', tile.z)
    if (dasharray && dasharray.length) {
      if (dasharray.length % 2 > 0) {
        dasharray.push(0)
      }
      layer.dashLength = 0
      for (let i = 0; i < dasharray.length; i++) {
        layer.dashLength += dasharray[i]
      }
      layer.dasharray = dasharray

      if (dasharray.length > 8) {
        warnOnce('line图层：line-dasharray 超过最大长度（8）')
      }
    }

    function addPolyline(
      coordinates,
      lineWidth,
      lineColor,
      lineOpacity,
      id,
      properties
    ) {
      if (coordinates.length < 2) return

      const batchId = geometryInstances.length
      if (featureId == 0) {
        layer.firstBatchId = batchId
      }
      layer.lastBatchId = batchId

      const lineFeature = {
        coordinates,
        featureId,
        lineColor,
        lineOpacity,
        lineWidth,
        properties,
        //保存原始数据的要素id，后续可以用来支持 featureState 表达式，这个表达式可以实现选定要素高亮显示
        id,
        //保存batchId，将矢量要素与几何顶点关联，后续可以实时更新图层样式
        batchId
      }

      scope.addFeature(lineFeature)
      layer.features.push(lineFeature)

      featureId++
    }

    for (const sourceFeature of features) {
      const featureType = VectorTileFeature.types[sourceFeature.type]
      if (featureType === 'Point' || featureType === 'Unknown') continue

      const properties = sourceFeature.properties

      //关键：使用 maplibre-gl 的 subdivideVertexLine 对投影坐标细分，
      //     如果转成经纬度之后使用cesium内置的细分，高纬度的线很难拟合地球椭球面
      const vtCoords = loadGeometry(sourceFeature)
      for (let i = 0; i < vtCoords.length; i++) {
        vtCoords[i] = subdivideVertexLine(vtCoords[i], granularity)
      }
      const feature = toGeoJSON.call(
        {
          extent: EXTENT,
          type: sourceFeature.type,
          properties,
          loadGeometry() {
            return vtCoords
          }
        },
        tile.x,
        tile.y,
        tile.z
      )
      if (!feature.geometry) continue

      const sourceFeatureId = sourceFeature.id || properties[promoteId]
      //读取图层样式属性
      const lineWidth = style.paint.getDataValue(
        'line-width',
        tile.z,
        sourceFeature
      )
      const lineColor = style.convertColor(
        style.paint.getDataValue('line-color', tile.z, sourceFeature)
      )
      const lineOpacity = style.paint.getDataValue(
        'line-opacity',
        tile.z,
        sourceFeature
      )
      const linePattern = style.paint.getDataValue(
        'line-pattern',
        tile.z,
        sourceFeature
      )
      if (linePattern) {
        warnOnce('line图层：不支持纹理填充（line-pattern）')
        continue
      }

      const lineJoin = style.paint.getDataValue(
        'line-join',
        tile.z,
        sourceFeature
      )
      const lineCap = style.paint.getDataValue(
        'line-cap',
        tile.z,
        sourceFeature
      )
      if (lineJoin !== 'miter') {
        warnOnce('line图层：line-join 仅支持 miter 模式')
      }
      if (lineCap !== 'butt') {
        warnOnce('line图层：line-cap 仅支持 butt 模式')
      }

      const geometryType = feature.geometry.type
      const coordinates = feature.geometry.coordinates
      if (geometryType == 'LineString') {
        addPolyline(
          coordinates,
          lineWidth,
          lineColor,
          lineOpacity,
          sourceFeatureId,
          properties
        )
      } else if (
        geometryType == 'MultiLineString' ||
        geometryType == 'Polygon'
      ) {
        for (const ring of coordinates) {
          addPolyline(
            ring,
            lineWidth,
            lineColor,
            lineOpacity,
            sourceFeatureId,
            properties
          )
        }
      } else if (geometryType == 'MultiPolygon') {
        for (const polygon of coordinates) {
          for (const ring of polygon) {
            addPolyline(
              ring,
              lineWidth,
              lineColor,
              lineOpacity,
              sourceFeatureId,
              properties
            )
          }
        }
      } else {
        warnOnce('line图层：不支持几何类型：' + geometryType)
      }
    }

    layer.offsets = []
    layer.counts = []

    this.layers.push(layer)
  }

  /**
   * 从 Web Worker 结果构建图层几何体（positions 已由 Worker 算好）
   * @param {object} workerLayerData - { layerId, source, sourceLayer, styleLayer, batches, firstBatchId, lastBatchId }
   * @param {LineRenderLayer} layer
   * @param {Cesium.FrameState} frameState
   * @param {VectorTileset} tileset
   */
  addLayerFromWorkerResult(workerLayerData, layer, frameState, tileset) {
    const { batches, firstBatchId, lastBatchId } = workerLayerData
    const geometryInstances = this.geometryInstances

    for (const batch of batches) {
      const { positions, colorBytes, lineWidth, id, properties } = batch
      const posArray = []
      for (let i = 0; i < positions.length; i += 3) {
        posArray.push(
          new Cesium.Cartesian3(
            positions[i],
            positions[i + 1],
            positions[i + 2]
          )
        )
      }
      const boundingSphere = Cesium.BoundingSphere.fromPoints(posArray)
      const cartographic = Cesium.Cartographic.fromCartesian(
        boundingSphere.center
      )
      cartographic.height = 0
      const center = Cesium.Cartographic.toCartesian(
        cartographic,
        null,
        new Cesium.Cartesian3()
      )
      const instance = new Cesium.GeometryInstance({
        geometry: new Cesium.PolylineGeometry({
          positions: posArray,
          width: lineWidth
        }),
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
   * @param {LineFeature} feature
   */
  addFeature(feature) {
    const geometryInstances = this.geometryInstances
    const { coordinates, lineColor, lineWidth, lineOpacity } = feature
    const colorBytes = lineColor.toBytes()
    colorBytes[3] = Math.floor(colorBytes[3] * lineOpacity)

    const positions = coordinates.map(coord =>
      Cesium.Cartesian3.fromDegrees(coord[0], coord[1])
    )

    const boundingSphere = Cesium.BoundingSphere.fromPoints(positions)
    const cartographic = Cesium.Cartographic.fromCartesian(
      boundingSphere.center
    )
    cartographic.height = 0 //包围盒中心可能高于或者低于地面，需要避免双击锁定视角时进入地下
    const center = Cesium.Cartographic.toCartesian(
      cartographic,
      null,
      new Cesium.Cartesian3()
    )

    const instance = new Cesium.GeometryInstance({
      geometry: new Cesium.PolylineGeometry({
        positions,
        width: lineWidth
      }),
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
  }

  createPrimitive() {
    const primitive = new Cesium.Primitive({
      geometryInstances: this.geometryInstances,
      asynchronous: true,
      appearance: new Cesium.PolylineMaterialAppearance({
        flat: true,
        translucent: false,
        vertexShaderSource: /*glsl*/ `
${Cesium._shadersPolylineCommon}
 
in vec4 color;
out vec4 v_color;
in vec3 position3DHigh;
in vec3 position3DLow;
in vec3 prevPosition3DHigh;
in vec3 prevPosition3DLow;
in vec3 nextPosition3DHigh;
in vec3 nextPosition3DLow;
in vec2 expandAndWidth;
in vec2 st;
in float batchId;

out float v_width;
out vec2 v_st;
out float v_polylineAngle;

void main()
{
    float expandDir = expandAndWidth.x;
    float width = abs(expandAndWidth.y) + 0.5;
    bool usePrev = expandAndWidth.y < 0.0;

    vec4 p = czm_computePosition();
    vec4 prev = czm_computePrevPosition();
    vec4 next = czm_computeNextPosition();

    float angle;
    vec4 positionWC = getPolylineWindowCoordinates(p, prev, next, expandDir, width, usePrev, angle);
    gl_Position = czm_viewportOrthographic * positionWC;

    v_width = width;
    v_st.s = st.s;
    v_st.t = czm_writeNonPerspective(st.t, gl_Position.w);
    v_polylineAngle = angle;
    v_color = color;
}
                `,
        fragmentShaderSource: /*glsl*/ ` 
in vec2 v_st;

uniform vec4 tileId;
uniform sampler2D tileIdTexture;

void main()
{
    vec2 id_st = gl_FragCoord.xy / czm_viewport.zw; 
    vec4 bgId = texture(tileIdTexture, id_st);
    if (all(equal(bgId, tileId)) == false)
    {
       discard;
    }

    czm_materialInput materialInput;

    vec2 st = v_st;
    st.t = czm_readNonPerspective(st.t, gl_FragCoord.w);

    materialInput.s = st.s;
    materialInput.st = st;
    materialInput.str = vec3(st, 0.0);

    czm_material material = czm_getMaterial(materialInput);
    out_FragColor = vec4(material.diffuse + material.emission, material.alpha);

    czm_writeLogDepth();
}
                `,
        material: new Cesium.Material({
          fabric: {
            //cesium不支持数组类型的uniform，我们在分配图层绘图命令的时候修改uniformMap
            // uniforms: {
            //     dashLength: 16,
            //     arrayLength: 0,
            //     dasharray: []
            // },
            source: /*glsl*/ `
const int maxArrayLength = 8;

in float v_width;
in vec4 v_color;
uniform float dashLength;
uniform float arrayLength;
uniform float dasharray[maxArrayLength];
in float v_polylineAngle;

mat2 rotate(float rad) {
    float c = cos(rad);
    float s = sin(rad);
    return mat2(
        c, s,
        -s, c
    );
}

czm_material czm_getMaterial(czm_materialInput materialInput)
{
    czm_material material = czm_getDefaultMaterial(materialInput);

    vec2 pos = rotate(v_polylineAngle) * gl_FragCoord.xy;

    // Get the relative position within the dash from 0 to 1
    float dashPosition = fract(pos.x / (v_width * dashLength * czm_pixelRatio));

    float currDashPos = 0.;
    for (int i = 0; i < maxArrayLength; i += 2) {
        if(float(i) >= arrayLength) break;

        float gapStart = currDashPos + dasharray[i] / dashLength;
        float gapEnd = gapStart + dasharray[i + 1] / dashLength;

        if(dashPosition > gapStart && dashPosition < gapEnd) {
            discard;
            break;
        }

        currDashPos = gapEnd;
    }
    
    vec4 fragColor = v_color;
    fragColor = czm_gammaCorrect(fragColor);
    material.emission = fragColor.rgb;
    material.alpha = fragColor.a;
    return material;
}                        
                        `
          }
        })
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

  /**
   * 使用合批后的 drawCommand 创建副本，为渲染图层分配 drawCommand
   * @param {Cesium.DrawCommand[]} batchedCommandList
   * @param {VectorTileset} tileset
   */
  createLayerCommands(batchedCommandList, tileset) {
    const renderState = Cesium.RenderState.fromCache({
      id: 'line',
      blending: Cesium.BlendingState.ALPHA_BLEND,
      depthMask: false,
      depthTest: {
        enabled: true
      },
      cull: {
        enabled: true
      },
      colorMask: {
        red: true,
        green: true,
        blue: true,
        alpha: true
      }
    })
    const tileId = this.tile.tileId

    function modifyUniformMap(uniformMap, layer) {
      uniformMap = {
        ...uniformMap
      }
      uniformMap.tileIdTexture = function () {
        return tileset.tileIdTexture
      }
      uniformMap.tileId = function () {
        return tileId.color
      }
      uniformMap.dasharray = function () {
        return layer.dasharray
      }
      uniformMap.dashLength = function () {
        return layer.dashLength
      }
      uniformMap.arrayLength = function () {
        return layer.dasharray.length
      }
      return uniformMap
    }

    for (let i = 0; i < this.layers.length; i++) {
      const layer = this.layers[i]
      const layerCommandList = (layer.commandList = [])

      for (let pass = 0; pass < batchedCommandList.length; pass++) {
        const offset = layer.offsets[pass],
          count = layer.counts[pass]
        if (typeof offset !== 'number' || typeof count !== 'number') {
          continue
        }
        const command = batchedCommandList[pass]
        //通过副本的 offset 和 count 指定图层的绘制范围
        const layerCommand = Cesium.DrawCommand.shallowClone(command)
        layerCommand.pass = Cesium.Pass.CESIUM_3D_TILE
        layerCommand.uniformMap = modifyUniformMap(
          layerCommand.uniformMap,
          layer
        )
        layerCommand.renderState = renderState
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
    }

    if (this.primitive && this.state !== 'done' && this.state !== 'error') {
      //先保存系统的 commandList
      const preCommandList = frameState.commandList
      //临时覆盖 frameState.commandList，用于获取合批之后的drawCommand
      const batchedCommandList = (frameState.commandList = [])

      //执行 primitive 的 update ，直到生成了合批后的drawCommand
      try {
        this.primitive.update(frameState)
      } catch (err) {
        //如果报错，下一帧就不要再执行 update 了，以免重复打印错误信息
        this.geometryInstances = []
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

      if (this.primitive._state === Cesium.PrimitiveState.FAILED) {
        this.setState('error')
      }

      this.geometryInstances = []
    }

    if (this.primitive && frameState.camera.pitch > -1.309) {
      warnOnce('line图层：不支持透视，建议保持相机俯仰角（pitch）小于 -75 度')
    }

    if (this._batchTable && this._batchTable._batchValuesDirty) {
      this._batchTable.update(frameState)
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
