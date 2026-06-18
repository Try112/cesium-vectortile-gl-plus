/**
 * Vector tile Web Worker: 解析、过滤、坐标转换、几何数据构建。
 * 遵循 Cesium TaskProcessor 协议：收到 { id, parameters }，回复 { id, result }, transferList。
 */
import { processTileTask } from './processTileTask.js'

self.onmessage = function (e) {
  const { id, parameters } = e.data
  const transferList = []

  try {
    const result = processTileTask(parameters)
    collectTransferables(result, transferList)
    self.postMessage({ id, result }, transferList)
  } catch (err) {
    self.postMessage({ id, result: { error: String(err.message || err) } }, [])
  }
}

/**
 * 从 result 中收集可 transfer 的 ArrayBuffer，用于 postMessage 的 transferList
 * @param {object} result - { fill: [{ batches: [...] }], line: [{ batches: [...] }], symbol: [...] }
 * @param {ArrayBuffer[]} transferList
 */
function collectTransferables(result, transferList) {
  if (!result) return
  for (const key of ['fill', 'line']) {
    const arr = result[key]
    if (!Array.isArray(arr)) continue
    for (const layer of arr) {
      const batches = layer.batches
      if (!Array.isArray(batches)) continue
      for (const batch of batches) {
        if (batch.positions?.buffer) transferList.push(batch.positions.buffer)
        if (batch.normals?.buffer) transferList.push(batch.normals.buffer)
        if (batch.st?.buffer) transferList.push(batch.st.buffer)
        if (batch.indices?.buffer) transferList.push(batch.indices.buffer)
      }
    }
  }
}
