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
  style: '/assets/demotiles/style.json'
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

//样式修改示例
tileset.readyEvent.addEventListener(() => {
  // 1、修改绘制属性（颜色、透明度），不会触发强制刷新，实时变化
  tileset.setPaintProperty('background', 'background-color', 'skyblue')
  tileset.setPaintProperty('geolines', 'line-color', 'green')
  tileset.setPaintProperty('us_states:fill', 'fill-color', 'red')
  tileset.setPaintProperty('countries-label', 'text-color', 'blue')

  // 2、修改布局属性，除 visibility 外，都会触发强制刷新
  setTimeout(() => {
    // 2.1、布局属性修改：图层显隐，不会触发强制刷新
    tileset.setLayoutProperty('coastline', 'visibility', 'none')
    // 2.2、布局属性修改（非visibility）：字体大小修改，会触发强制刷新
    tileset.setLayoutProperty('countries-label', 'text-size', {
      stops: [
        [2, 12],
        [4, 16],
        [6, 20]
      ]
    })
  }, 5000)

  // 3、修改过滤器。
  setTimeout(() => {
    //和setLayoutProperty一样（visibility例外）会触发强制刷新
    tileset.setFilter('geolines', null)
  }, 10000)
})

window.tileset = tileset
window.viewer = viewer
