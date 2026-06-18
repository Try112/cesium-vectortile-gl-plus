/**
 * WGS84 椭球经纬度 → 世界坐标（不依赖 Cesium），供 Worker 内几何构建使用。
 */
const A = 6378137
const E2 = 6.694379990141316e-2 // 2*f - f*f, f = 1/298.257223563

/**
 * 经纬度(度) + 高度 → 笛卡尔坐标 [x, y, z]
 * @param {number} lonDeg - 经度（度）
 * @param {number} latDeg - 纬度（度）
 * @param {number} height - 高度（米）
 * @param {Float64Array} [out] - 可选，长度至少 3
 * @returns {Float64Array}
 */
export function fromDegrees(lonDeg, latDeg, height, out) {
  const lon = (lonDeg * Math.PI) / 180
  const lat = (latDeg * Math.PI) / 180
  const sinLat = Math.sin(lat)
  const cosLat = Math.cos(lat)
  const n = A / Math.sqrt(1 - E2 * sinLat * sinLat)
  const x = (n + height) * cosLat * Math.cos(lon)
  const y = (n + height) * cosLat * Math.sin(lon)
  const z = (n * (1 - E2) + height) * sinLat
  const result = out || new Float64Array(3)
  result[0] = x
  result[1] = y
  result[2] = z
  return result
}

/**
 * 向量归一化，写回原数组
 * @param {Float64Array} v - 长度至少 3
 * @returns {Float64Array}
 */
export function normalize(v) {
  const x = v[0]
  const y = v[1]
  const z = v[2]
  const len = Math.sqrt(x * x + y * y + z * z)
  if (len > 0) {
    v[0] = x / len
    v[1] = y / len
    v[2] = z / len
  }
  return v
}
