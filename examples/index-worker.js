/**
 * 启用 Web Worker 的示例：瓦片解析、坐标转换、几何构建在子线程执行，减轻主线程卡顿。
 * 开发：npm run dev 后打开 worker.html；Worker 脚本 URL 由 import.meta.url 相对路径解析。
 */
import { VectorTileset } from '../Source/VectorTileset'

// Worker 脚本 URL：开发时指向源码 Worker，否则指向构建产物（需先 npm run build）
const workerUrl =
  typeof import.meta.url !== 'undefined' &&
  import.meta.url.endsWith('index-worker.js')
    ? new URL('../Source/workers/VectorTileWorker.js', import.meta.url).href
    : new URL('../dist/cvt-gl-worker.js', import.meta.url).href

const viewer = new Cesium.Viewer(document.body, {
  creditContainer: document.createElement('div'),
  scene3DOnly: true,
  contextOptions: {
    requestWebgl2: true
  },
  infoBox: true
})
viewer.resolutionScale = devicePixelRatio
viewer.scene.globe.depthTestAgainstTerrain = false
viewer.scene.debugShowFramesPerSecond = true
viewer.postProcessStages.fxaa.enabled = true

viewer.entities.add({
  polyline: {
    clampToGround: true,
    positions: Cesium.Cartesian3.fromDegreesArray([
      -80.519, 40.6388, -124.1595, 46.2611
    ]),
    width: 2
  }
})

// 启用 Web Worker：仅对 vector 源生效，瓦片解析与几何计算在子线程执行
const tileset = new VectorTileset({
  style: '/assets/demotiles/style.json',
  workerUrl,
  maximumActiveTasks: 4
})
viewer.scene.primitives.add(tileset)

viewer.entities.add({
  position: Cesium.Cartesian3.fromDegrees(-80.519, 40.6388),
  polyline: {
    clampToGround: true,
    positions: Cesium.Cartesian3.fromDegreesArray([
      -70.519, 40.6388, -144.1595, 46.2611
    ]),
    material: Cesium.Color.DARKORANGE,
    width: 3
  },
  box: {
    dimensions: new Cesium.Cartesian3(500000, 500000, 500000)
  }
})

window.tileset = tileset
window.viewer = viewer
