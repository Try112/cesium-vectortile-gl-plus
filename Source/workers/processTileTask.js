/**
 * Worker 内瓦片任务：解析 PBF/MLT、按样式过滤要素、构建几何数据。
 * 不依赖 Cesium/WebGL，仅使用 @mapbox/vector-tile、maplibre 纯 JS。
 */
import {
  VectorTile,
  VectorTileFeature,
  classifyRings
} from '@mapbox/vector-tile'
import Pbf from 'pbf'
import { MLTVectorTile } from 'maplibre-gl/src/source/vector_tile_mlt'
import { featureFilter } from '@maplibre/maplibre-gl-style-spec'
import { EXTENT } from 'maplibre-gl/src/data/extent'
import { loadGeometry } from 'maplibre-gl/src/data/load_geometry'
import { subdividePolygon } from 'maplibre-gl/src/render/subdivision'
import { subdivideVertexLine } from 'maplibre-gl/src/render/subdivision'
import { granularitySettings } from '../sources/granularitySettings.js'
import { fromDegrees, normalize } from './ellipsoid.js'
import {
  evaluateFillPaint,
  evaluateLinePaint,
  evaluateCirclePaint,
  evaluateSymbolLayout,
  evaluateSymbolPaint,
  colorToBytes
} from './styleEvaluator.js'

/**
 * 解析瓦片 buffer 为 VectorTile 或 MLTVectorTile
 * @param {ArrayBuffer} buffer
 * @param {string} encoding - 'mvt' | 'mlt'
 * @returns {import('@mapbox/vector-tile').VectorTile|import('maplibre-gl/src/source/vector_tile_mlt').MLTVectorTile}
 */
function parseTile(buffer, encoding) {
  if (encoding === 'mlt') {
    return new MLTVectorTile(buffer)
  }
  return new VectorTile(new Pbf(buffer))
}

/**
 * 处理单瓦片任务：解析 + 过滤；后续步骤在此扩展几何构建。
 * @param {object} parameters
 * @param {Record<string,{buffer:ArrayBuffer,encoding:string}>} parameters.sources
 * @param {number} parameters.x
 * @param {number} parameters.y
 * @param {number} parameters.z
 * @param {number} [parameters.extent]
 * @param {Array<{id:string,type:string,source:string,sourceLayer?:string,filter?:object,paint?:object,layout?:object}>} parameters.styleLayers
 * @returns {{ fill: Array, line: Array, symbol: Array, parsedSources?: object }}
 */
export function processTileTask(parameters) {
  const {
    sources = {},
    x,
    y,
    z,
    extent = EXTENT,
    styleLayers = []
  } = parameters

  const parsedSources = {}
  for (const sourceId in sources) {
    const { buffer, encoding } = sources[sourceId]
    if (buffer) {
      parsedSources[sourceId] = parseTile(buffer, encoding || 'mvt')
    }
  }

  const result = { fill: [], line: [], circle: [], symbol: [] }

  for (const layerSpec of styleLayers) {
    if (layerSpec.type === 'background') continue
    const vt = parsedSources[layerSpec.source]
    if (!vt) continue
    const layerName = layerSpec.sourceLayer ?? layerSpec['source-layer']
    const vectorLayer = vt.layers[layerName]
    if (!vectorLayer) continue

    const filter = layerSpec.filter ? featureFilter(layerSpec.filter) : null
    const features = []
    const featureCount = vectorLayer.length
    for (let i = 0; i < featureCount; i++) {
      const feature = vectorLayer.feature(i)
      if (filter && !filter.filter({ zoom: z }, feature)) continue
      features.push({ index: i, feature, layerSpec })
    }

    const type = layerSpec.type
    if (type === 'fill' || type === 'line' || type === 'symbol' || type === 'circle') {
      result[type].push({
        layerId: layerSpec.id,
        source: layerSpec.source,
        sourceLayer: layerName,
        styleLayer: layerSpec,
        extent,
        x,
        y,
        z,
        features
      })
    }
  }

  // 几何构建在 Worker 内完成，只把可序列化数据 + transferable buffers 传回主线程；
  // 此处先做解析+过滤，几何构建在 buildGeometryInWorker 中扩展
  return buildGeometryResult(result, extent, x, y, z)
}

/**
 * 瓦片坐标 → 经纬度（度），与 VectorTileLOD.transformPoint 一致
 */
function transformPoint(x, y, size, x0, y0, out) {
  out[0] = ((x + x0) * 360) / size - 180
  out[1] =
    (360 / Math.PI) *
      Math.atan(Math.exp((1 - ((y + y0) * 2) / size) * Math.PI)) -
    90
  return out
}

/**
 * 根据解析+过滤结果构建几何数据（positions/normals/indices 等），仅返回可 transfer 的数据
 */
function buildGeometryResult(layerResult, extent, x, y, z) {
  const out = { fill: [], line: [], symbol: [] }
  const size = extent * Math.pow(2, z)
  const x0 = extent * x
  const y0 = extent * y
  const canonical = { x, y, z }

  for (const item of layerResult.fill || []) {
    const batches = buildFillBatches(item, extent, size, x0, y0, canonical)
    out.fill.push({
      layerId: item.layerId,
      source: item.source,
      sourceLayer: item.sourceLayer,
      styleLayer: item.styleLayer,
      batches,
      firstBatchId: 0,
      lastBatchId: batches.length - 1
    })
  }

  for (const item of layerResult.line || []) {
    const batches = buildLineBatches(item, extent, size, x0, y0)
    out.line.push({
      layerId: item.layerId,
      source: item.source,
      sourceLayer: item.sourceLayer,
      styleLayer: item.styleLayer,
      batches,
      firstBatchId: 0,
      lastBatchId: batches.length - 1
    })
  }

  for (const item of layerResult.circle || []) {
    const points = buildCirclePoints(item, extent, size, x0, y0)
    out.circle.push({
      layerId: item.layerId,
      source: item.source,
      sourceLayer: item.sourceLayer,
      styleLayer: item.styleLayer,
      points,
      firstBatchId: 0,
      lastBatchId: points.length - 1
    })
  }

  for (const item of layerResult.symbol || []) {
    const placements = buildSymbolPlacements(item, extent, size, x0, y0)
    out.symbol.push({
      layerId: item.layerId,
      source: item.source,
      sourceLayer: item.sourceLayer,
      styleLayer: item.styleLayer,
      placements,
      firstBatchId: 0,
      lastBatchId: 0
    })
  }

  return out
}

/**
 * Symbol 图层：输出每个符号的 placement（coord, text, style 等），主线程用其创建 Cesium.Label
 */
function buildSymbolPlacements(item, extent, size, x0, y0) {
  const { features, styleLayer, z } = item
  const coordDeg = [0, 0]
  const placements = []

  for (const { feature } of features) {
    const type = VectorTileFeature.types[feature.type]
    if (type !== 'Point' && type !== 'Unknown') continue
    const vtCoords = loadGeometry(feature)
    if (!vtCoords.length || !vtCoords[0].length) continue
    const layout = evaluateSymbolLayout(styleLayer, z, feature)
    if (!layout.text) continue
    const paint = evaluateSymbolPaint(styleLayer, z, feature)
    const textColorBytes = colorToBytes(paint.textColor)
    const outlineColorBytes = colorToBytes(paint.outlineColor)
    const firstRing = vtCoords[0]
    for (let pi = 0; pi < firstRing.length; pi++) {
      const p = firstRing[pi]
      transformPoint(p.x, p.y, size, x0, y0, coordDeg)
      placements.push({
        coord: [coordDeg[0], coordDeg[1]],
        text: layout.text,
        font: layout.font,
        textSize: layout.textSize,
        textColorBytes: Array.from(textColorBytes),
        outlineWidth: paint.outlineWidth,
        outlineColorBytes: Array.from(outlineColorBytes),
        textOffset: layout.textOffset,
        textAnchor: layout.textAnchor,
        id: feature.id ?? feature.properties?.id ?? null,
        properties: feature.properties || {}
      })
    }
  }
  return placements
}

/**
 * Fill 图层几何：每个 polygon 一个 batch（positions, normals, st, indices, colorBytes）
 */
function buildFillBatches(item, extent, size, x0, y0, canonical) {
  const { features, styleLayer, z } = item
  const granularity =
    granularitySettings.globe.line.getGranularityForZoomLevel(z) / 2
  const coordDeg = [0, 0]
  const posScratch = new Float64Array(3)
  const batches = []
  let batchId = 0

  for (const { feature } of features) {
    if (VectorTileFeature.types[feature.type] !== 'Polygon') continue
    const paint = evaluateFillPaint(styleLayer, z, feature)
    const fillColor = paint.fillColor
    const fillOpacity = paint.fillOpacity
    const colorBytes = colorToBytes(fillColor, fillOpacity)

    const vtCoords = loadGeometry(feature)
    const polygons = classifyRings(vtCoords)
    for (const coordinates of polygons) {
      if (coordinates.some(ring => ring.length < 3)) continue
      const subdivisionRes = subdividePolygon(
        coordinates,
        canonical,
        granularity,
        false
      )
      const verticesFlattened = subdivisionRes.verticesFlattened
      const vertCount = verticesFlattened.length / 2
      const positions = new Float64Array(vertCount * 3)
      const normals = new Float32Array(vertCount * 3)
      const st = new Float32Array(vertCount * 2)

      for (let i = 0, j = 0; i < verticesFlattened.length; i += 2, j++) {
        const vx = verticesFlattened[i]
        const vy = verticesFlattened[i + 1]
        transformPoint(vx, vy, size, x0, y0, coordDeg)
        fromDegrees(coordDeg[0], coordDeg[1], 0, posScratch)
        positions[j * 3] = posScratch[0]
        positions[j * 3 + 1] = posScratch[1]
        positions[j * 3 + 2] = posScratch[2]
        normalize(posScratch)
        normals[j * 3] = posScratch[0]
        normals[j * 3 + 1] = posScratch[1]
        normals[j * 3 + 2] = posScratch[2]
        st[j * 2] = vx / extent
        st[j * 2 + 1] = vy / extent
      }

      const indices = new (
        vertCount > 65535
          ? Uint32Array
          : vertCount > 255
            ? Uint16Array
            : Uint8Array
      )(subdivisionRes.indicesTriangles)

      batches.push({
        batchId: batchId++,
        positions,
        normals,
        st,
        indices,
        colorBytes,
        id: feature.id ?? feature.properties?.id ?? null,
        properties: feature.properties || {}
      })
    }
  }
  return batches
}

/**
 * Line 图层几何：每条线一个 batch（positions, colorBytes, lineWidth）
 */
function buildLineBatches(item, extent, size, x0, y0) {
  const { features, styleLayer, z } = item
  const granularity =
    granularitySettings.globe.line.getGranularityForZoomLevel(z)
  const coordDeg = [0, 0]
  const posScratch = new Float64Array(3)
  const batches = []
  let batchId = 0

  for (const { feature } of features) {
    const featureType = VectorTileFeature.types[feature.type]
    if (featureType === 'Point' || featureType === 'Unknown') continue
    const paint = evaluateLinePaint(styleLayer, z, feature)
    const colorBytes = colorToBytes(paint.lineColor, paint.lineOpacity)

    const vtCoords = loadGeometry(feature)
    for (let ri = 0; ri < vtCoords.length; ri++) {
      const ring = subdivideVertexLine(vtCoords[ri], granularity, false)
      if (ring.length < 2) continue
      const positions = new Float64Array(ring.length * 3)
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i]
        transformPoint(p.x, p.y, size, x0, y0, coordDeg)
        fromDegrees(coordDeg[0], coordDeg[1], 0, posScratch)
        positions[i * 3] = posScratch[0]
        positions[i * 3 + 1] = posScratch[1]
        positions[i * 3 + 2] = posScratch[2]
      }
      batches.push({
        batchId: batchId++,
        positions,
        colorBytes,
        lineWidth: paint.lineWidth,
        id: feature.id ?? feature.properties?.id ?? null,
        properties: feature.properties || {}
      })
    }
  }
  return batches
}

function buildCirclePoints(item, extent, size, x0, y0) {
  const { features, styleLayer, z } = item
  const coordDeg = [0, 0]
  const points = []
  for (const { feature } of features) {
    const featureType = VectorTileFeature.types[feature.type]
    if (featureType !== 'Point' && featureType !== 'Unknown') continue
    const paint = evaluateCirclePaint(styleLayer, z, feature)
    const colorBytes = colorToBytes(paint.circleColor, paint.circleOpacity)
    const strokeColorBytes = colorToBytes(paint.circleStrokeColor, 1)
    const vtCoords = loadGeometry(feature)
    if (!vtCoords.length || !vtCoords[0].length) continue
    const firstRing = vtCoords[0]
    for (let pi = 0; pi < firstRing.length; pi++) {
      const p = firstRing[pi]
      transformPoint(p.x, p.y, size, x0, y0, coordDeg)
      points.push({
        coord: [coordDeg[0], coordDeg[1]],
        id: feature.id ?? feature.properties?.id ?? null,
        properties: feature.properties || {},
        colorBytes: Array.from(colorBytes),
        radius: paint.circleRadius,
        opacity: paint.circleOpacity,
        strokeColorBytes: Array.from(strokeColorBytes),
        strokeWidth: paint.circleStrokeWidth
      })
    }
  }
  return points
}
