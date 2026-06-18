/**
 * Worker 与主线程性能对比：先左侧主线程 15 秒，再右侧 Worker 15 秒，各 100 个 Box（边长 50000）加载与路径漫游，结果分开输出并对比。
 * 需在浏览器中打开 benchmark.html 运行。
 */
import { VectorTileset } from '../Source/VectorTileset'

const BENCH_DURATION_MS = 15_000
const BENCH_BOX_COUNT = 5000
const LONG_FRAME_MS = 50

/** 路径漫游：同一路径关键帧 (t 为 0..1) */
const FLY_PATH = [
  { t: 0, longitude: -100, latitude: 40, height: 5_000_000 },
  { t: 0.25, longitude: -96, latitude: 39.5, height: 3_500_000 },
  { t: 0.5, longitude: -92, latitude: 39, height: 2_000_000 },
  { t: 0.75, longitude: -94, latitude: 40, height: 3_500_000 },
  { t: 1, longitude: -98, latitude: 39, height: 5_000_000 }
]

/** 漫游时 Box 随机分布范围（与路径可见范围一致） */
const BOX_LON_MIN = -100
const BOX_LON_MAX = -92
const BOX_LAT_MIN = 38.5
const BOX_LAT_MAX = 41
const BOX_HEIGHT_MIN = 500
const BOX_HEIGHT_MAX = 2_000_000
/** Box 边长 50000 */
const BOX_DIMENSIONS = new Cesium.Cartesian3(50000, 50000, 50000)

const workerUrl =
  typeof import.meta.url !== 'undefined' &&
  import.meta.url.endsWith('benchmark.js')
    ? new URL('../Source/workers/VectorTileWorker.js', import.meta.url).href
    : new URL('../dist/cvt-gl-worker.js', import.meta.url).href

function createViewer(container) {
  const viewer = new Cesium.Viewer(container, {
    creditContainer: document.createElement('div'),
    scene3DOnly: true,
    contextOptions: { requestWebgl1: true },
    infoBox: false
  })
  return viewer
}

/** 根据 t in [0,1] 在 FLY_PATH 上线性插值得到 { longitude, latitude, height } */
function interpolatePath(t) {
  let i = 0
  for (; i < FLY_PATH.length - 1; i++) {
    if (t <= FLY_PATH[i + 1].t) break
  }
  const a = FLY_PATH[i]
  const b = FLY_PATH[Math.min(i + 1, FLY_PATH.length - 1)]
  const s = a.t === b.t ? 1 : (t - a.t) / (b.t - a.t)
  return {
    longitude: a.longitude + s * (b.longitude - a.longitude),
    latitude: a.latitude + s * (b.latitude - a.latitude),
    height: a.height + s * (b.height - a.height)
  }
}

function setCameraFromPath(viewer, t) {
  const pos = interpolatePath(t)
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(
      pos.longitude,
      pos.latitude,
      pos.height
    )
  })
}

/**
 * 生成随机分布的 Box 位置（经度、纬度、高度），漫游时左右两边使用相同序列。
 * @param {number} count
 * @returns {{ longitude: number, latitude: number, height: number }[]}
 */
function generateRandomBoxPositions(count) {
  const out = []
  for (let i = 0; i < count; i++) {
    out.push({
      longitude: BOX_LON_MIN + Math.random() * (BOX_LON_MAX - BOX_LON_MIN),
      latitude: BOX_LAT_MIN + Math.random() * (BOX_LAT_MAX - BOX_LAT_MIN),
      height: BOX_HEIGHT_MIN + Math.random() * (BOX_HEIGHT_MAX - BOX_HEIGHT_MIN)
    })
  }
  return out
}

/**
 * 向 viewer 添加一批 Box 实体。
 * @param {Cesium.Viewer} viewer
 * @param {{ longitude: number, latitude: number, height: number }[]} positions
 */
function addBoxesToViewer(viewer, positions) {
  for (const p of positions) {
    viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(
        p.longitude,
        p.latitude,
        p.height
      ),
      box: {
        dimensions: BOX_DIMENSIONS,
        material: Cesium.Color.CORNFLOWERBLUE.withAlpha(0.75)
      }
    })
  }
}

/**
 * 采集帧时间（仅主线程或仅 Worker 一侧有瓦片负载时使用）
 * @param {number} durationMs
 * @param {(dt: number, elapsed: number) => void} onFrame - 每帧回调，可用来驱动相机
 * @returns {Promise<number[]>}
 */
function collectFrameTimes(durationMs, onFrame = null) {
  const frameTimes = []
  let last = performance.now()
  let elapsed = 0

  return new Promise(resolve => {
    function tick() {
      const now = performance.now()
      const dt = now - last
      frameTimes.push(dt)
      last = now
      elapsed += dt
      if (onFrame) onFrame(dt, elapsed)
      if (elapsed >= durationMs) {
        resolve(frameTimes)
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

function stats(frameTimes) {
  if (frameTimes.length === 0)
    return { avg: 0, max: 0, p95: 0, p99: 0, longFrames: 0, fps: 0 }
  const sorted = [...frameTimes].sort((a, b) => a - b)
  const sum = frameTimes.reduce((a, b) => a + b, 0)
  const avg = sum / frameTimes.length
  const max = Math.max(...frameTimes)
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0
  const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0
  const longFrames = frameTimes.filter(t => t >= LONG_FRAME_MS).length
  const fps = frameTimes.length / (sum / 1000)
  return { avg, max, p95, p99, longFrames, fps, count: frameTimes.length }
}

function formatReport(label, s) {
  return [
    `${label}`,
    `  帧数: ${s.count}`,
    `  平均帧时间: ${s.avg.toFixed(2)} ms`,
    `  最大帧时间: ${s.max.toFixed(2)} ms`,
    `  P95: ${s.p95.toFixed(2)} ms, P99: ${s.p99.toFixed(2)} ms`,
    `  长帧(≥${LONG_FRAME_MS}ms): ${s.longFrames}`,
    `  平均 FPS: ${s.fps.toFixed(1)}`
  ].join('\n')
}

function getReportEl() {
  return document.getElementById('report')
}

function getLogEl() {
  const reportEl = getReportEl()
  return document.getElementById('log') || reportEl
}

function log(msg, reportEl = null) {
  const el = reportEl || getLogEl()
  console.log(msg)
  if (el) el.textContent += msg + '\n'
}

/**
 * 先跑左侧 15 秒，再跑右侧 15 秒，分别采集帧时间，输出分开的结果并对比。
 * @param {boolean} [swap=false] - 为 true 时左侧用 Worker、右侧用主线程
 */
async function runBenchmark(swap = false) {
  const containerMain = document.getElementById('viewer-main')
  const containerWorker = document.getElementById('viewer-worker')
  const reportEl = getReportEl()
  if (!containerMain || !containerWorker || !reportEl) {
    console.error('缺少 #viewer-main / #viewer-worker / #report')
    return
  }

  const leftLabel = swap ? 'Worker' : '主线程'
  const rightLabel = swap ? '主线程' : 'Worker'
  reportEl.textContent =
    '准备中：各 ' +
    BENCH_BOX_COUNT +
    ' 个 Box（边长 50000），15 秒加载与路径漫游，先左侧后右侧…'
  const logEl = getLogEl()
  if (logEl) logEl.textContent = ''

  const append = msg => {
    if (logEl) logEl.textContent += msg + '\n'
    console.log(msg)
  }

  try {
    const boxPositions = generateRandomBoxPositions(BENCH_BOX_COUNT)

    append(
      `测试：各 ${BENCH_DURATION_MS / 1000} 秒，${BENCH_BOX_COUNT} 个 Box（边长 50000）加载与路径漫游。左侧=${leftLabel}，右侧=${rightLabel}。\n`
    )

    /* 左侧：swap 时用 Worker，否则用主线程 */
    append('左侧（' + leftLabel + '）采集中…')
    reportEl.textContent = '左侧（' + leftLabel + '）采集中…'
    const viewerLeft = createViewer(containerMain)
    viewerLeft.resolutionScale = Math.min(devicePixelRatio, 2)
    viewerLeft.scene.globe.depthTestAgainstTerrain = false
    viewerLeft.scene.debugShowFramesPerSecond = false
    const tilesetLeft = new VectorTileset(
      swap
        ? {
            style: '/assets/demotiles/style.json',
            workerUrl,
            maximumActiveTasks: 4
          }
        : { style: '/assets/demotiles/style.json' }
    )
    viewerLeft.scene.primitives.add(tilesetLeft)
    addBoxesToViewer(viewerLeft, boxPositions)
    setCameraFromPath(viewerLeft, 0)

    const leftFrameTimes = await collectFrameTimes(
      BENCH_DURATION_MS,
      (dt, elapsed) => {
        const t = Math.min(1, elapsed / BENCH_DURATION_MS)
        setCameraFromPath(viewerLeft, t)
      }
    )

    viewerLeft.scene.primitives.remove(tilesetLeft)
    tilesetLeft.destroy()
    viewerLeft.entities.removeAll()
    viewerLeft.destroy()

    const leftStats = stats(leftFrameTimes)
    append(formatReport('左侧（' + leftLabel + '）', leftStats))

    /* 右侧：swap 时用主线程，否则用 Worker */
    append('\n右侧（' + rightLabel + '）采集中…')
    reportEl.textContent = '右侧（' + rightLabel + '）采集中…'
    await new Promise(r => setTimeout(r, 500))

    const viewerRight = createViewer(containerWorker)
    viewerRight.resolutionScale = Math.min(devicePixelRatio, 2)
    viewerRight.scene.globe.depthTestAgainstTerrain = false
    viewerRight.scene.debugShowFramesPerSecond = false
    const tilesetRight = new VectorTileset(
      swap
        ? { style: '/assets/demotiles/style.json' }
        : {
            style: '/assets/demotiles/style.json',
            workerUrl,
            maximumActiveTasks: 4
          }
    )
    viewerRight.scene.primitives.add(tilesetRight)
    addBoxesToViewer(viewerRight, boxPositions)
    setCameraFromPath(viewerRight, 0)

    const rightFrameTimes = await collectFrameTimes(
      BENCH_DURATION_MS,
      (dt, elapsed) => {
        const t = Math.min(1, elapsed / BENCH_DURATION_MS)
        setCameraFromPath(viewerRight, t)
      }
    )

    viewerRight.scene.primitives.remove(tilesetRight)
    tilesetRight.destroy()
    viewerRight.entities.removeAll()
    viewerRight.destroy()

    const rightStats = stats(rightFrameTimes)
    append(formatReport('右侧（' + rightLabel + '）', rightStats))

    /* 对比：始终以主线程为基准，Worker 相对主线程 */
    const mainStats = swap ? rightStats : leftStats
    const workerStats = swap ? leftStats : rightStats
    const diffPct = (a, b) => (b === 0 ? '0' : (((a - b) / b) * 100).toFixed(1))
    append('\n--- 对比 ---')
    append(
      `平均帧时间: Worker 相对主线程 ${diffPct(workerStats.avg, mainStats.avg)}%`
    )
    append(
      `长帧(≥${LONG_FRAME_MS}ms): 主线程 ${mainStats.longFrames} vs Worker ${workerStats.longFrames}`
    )
    append(
      `平均 FPS: 主线程 ${mainStats.fps.toFixed(1)} vs Worker ${workerStats.fps.toFixed(1)}`
    )

    reportEl.innerHTML = [
      '<pre>',
      formatReport('左侧（' + leftLabel + '）', leftStats),
      '',
      formatReport('右侧（' + rightLabel + '）', rightStats),
      '',
      '--- 对比 ---',
      `平均帧时间: Worker 相对主线程 ${diffPct(workerStats.avg, mainStats.avg)}%`,
      `长帧(≥${LONG_FRAME_MS}ms): 主线程 ${mainStats.longFrames} vs Worker ${workerStats.longFrames}`,
      `平均 FPS: 主线程 ${mainStats.fps.toFixed(1)} vs Worker ${workerStats.fps.toFixed(1)}`,
      '</pre>'
    ].join('\n')
  } catch (err) {
    reportEl.textContent = '错误: ' + (err.message || err)
    log('错误: ' + (err.message || err))
    console.error(err)
  }
}

export { runBenchmark }
