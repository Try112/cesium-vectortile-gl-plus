import { VectorTileset } from '../Source/VectorTileset'
// import { VectorTileset } from "../dist/cvt-gl.js"

const viewer = new Cesium.Viewer(document.body, {
  creditContainer: document.createElement('div'),
  scene3DOnly: true,
  contextOptions: {
    requestWebgl1: true
  },
  infoBox: true
})
viewer.resolutionScale = devicePixelRatio
viewer.scene.globe.depthTestAgainstTerrain = false
viewer.scene.debugShowFramesPerSecond = true
viewer.postProcessStages.fxaa.enabled = true

//在添加矢量瓦片集之前添加贴地entity，
//验证贴地Entity的添加顺序是否影响贴合矢量瓦片的效果
viewer.entities.add({
  polyline: {
    clampToGround: true,
    positions: Cesium.Cartesian3.fromDegreesArray([
      -80.519, 40.6388, -124.1595, 46.2611
    ]),
    width: 2
  }
})

//矢量瓦片集添加到Cesium场景

const tileset = new VectorTileset({
  style: '/assets/demotiles/plain.json'
})
viewer.scene.primitives.add(tileset)

//在添加矢量瓦片集之后添加贴地entity，
//验证贴地Entity的添加顺序是否影响贴合矢量瓦片的效果
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
