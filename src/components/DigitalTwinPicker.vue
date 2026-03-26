<script setup>
import { onMounted, onBeforeUnmount, ref, shallowRef } from 'vue';
import * as Cesium from 'cesium';

// 使用原文的 Token
const CESIUM_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJjODYwMjZkMi02YzAzLTRiZjgtYWQ4Yy1lYzkzMmFjOTBjZjAiLCJpZCI6MjkwMTU0LCJpYXQiOjE3NjUwMzQxOTR9.WMQF23KeDp9RCrIK_Zc0lH2G2yfgTNjypGuRahUL-0M';
const HOME_BASE = [113.931615, 22.537516]; // 无人机中心站点

const viewerRef = shallowRef(null);
const pickedCoordinates = ref([]);

onMounted(async () => {
  try {
    Cesium.Ion.defaultAccessToken = CESIUM_TOKEN;

    // 1. 初始化地形 (很重要！有地形才能拿到真实的基础高度)
    let terrainProvider;
    try {
      terrainProvider = await Cesium.createWorldTerrainAsync();
    } catch (error) {
      console.warn('WorldTerrain 加载失败，降级为默认地形:', error);
      terrainProvider = new Cesium.EllipsoidTerrainProvider();
    }

    // 2. 创建 viewer
    const viewer = new Cesium.Viewer('cesiumContainer', {
      terrainProvider,
      animation: false,
      timeline: false,
      infoBox: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      baseLayerPicker: false,
      navigationHelpButton: false,
      creditContainer: document.createElement('div')
    });

    viewerRef.value = viewer;

    // 3. 开启深度检测，这样射线才能被 3D 白模或地形正确挡住
    viewer.scene.globe.depthTestAgainstTerrain = true;

    // 4. 加载 3D 建筑白模 (很重要！可以直接从白模顶部点击拾取获取楼顶高度)
    try {
      const buildingsTileset = await Cesium.createOsmBuildingsAsync();
      viewer.scene.primitives.add(buildingsTileset);
    } catch (error) {
      console.warn('OSM Buildings 加载失败:', error);
    }

    // 5. 将视角飞到你的中心点附近
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(HOME_BASE[0], HOME_BASE[1], 1000),
      orientation: {
        heading: Cesium.Math.toRadians(0.0),
        pitch: Cesium.Math.toRadians(-45.0),
        roll: 0.0,
      },
    });

    // ==========================================
    // 💥 核心功能：射线碰撞拾取 (ScreenSpaceEventHandler)
    // ==========================================
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    handler.setInputAction((movement) => {
      // a. 发射射线
      const ray = viewer.camera.getPickRay(movement.position);
      // 先尝试从地球表面(地形)交点拾取
      let cartesian = viewer.scene.globe.pick(ray, viewer.scene);

      // 如果点在了建筑模型上(3D Tiles)，用 pickPosition 或者 pick 拿真实表面坐标
      const pickObject = viewer.scene.pick(movement.position);
      if (viewer.scene.pickPositionSupported && pickObject) {
         const pos = viewer.scene.pickPosition(movement.position);
         if (pos) {
             cartesian = pos;
         }
      }

      if (cartesian) {
        // b. 将世界坐标 Cartesian3 转换为 地图常用的 Cartographic(经纬度弧度及高度米)
        const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
        
        // c. 将弧度转换为熟悉的经纬度度数 (WGS-84标准)
        const longitude = Number(Cesium.Math.toDegrees(cartographic.longitude).toFixed(6));
        const latitude = Number(Cesium.Math.toDegrees(cartographic.latitude).toFixed(6));
        const height = Number(cartographic.height.toFixed(2));

        // 存入列表在前端展示
        const newCoord = { lon: longitude, lat: latitude, alt: height };
        pickedCoordinates.value.push(newCoord);
        const currentIndex = pickedCoordinates.value.length;

        console.log("📍 精准 3D 坐标获取成功：", newCoord);

        // d. 在点击的位置画一个小红点，方便视觉反馈
        viewer.entities.add({
          position: cartesian,
          point: {
            pixelSize: 12,
            color: Cesium.Color.RED,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY // 确保点可见
          },
          label: {
            text: `${currentIndex}`,
            font: 'bold 16px sans-serif',
            fillColor: Cesium.Color.YELLOW,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -20),
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          }
        });
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  } catch (error) {
    console.error('Cesium 初始化失败:', error);
  }
});

onBeforeUnmount(() => {
  if (viewerRef.value && !viewerRef.value.isDestroyed()) {
    viewerRef.value.destroy();
  }
});

const clearCoordinates = () => {
  pickedCoordinates.value = [];
  if (viewerRef.value) {
    viewerRef.value.entities.removeAll();
  }
};
</script>

<template>
  <div class="picker-container">
    <div id="cesiumContainer"></div>
    
    <div class="side-panel">
      <h3>🎯 孪生坐标拾取器</h3>
      <p class="desc">
        请在右侧 3D 地图中点击地面或建筑表面，<br/>
        即可直接拾取由 3D 射线产生的无偏差 <strong>(经度, 纬度, 三维真实高度)</strong> 坐标。
      </p>

      <div class="action-bar">
        <button class="clear-btn" @click="clearCoordinates">清除所有点标</button>
      </div>

      <div class="coord-list" v-if="pickedCoordinates.length > 0">
        <div 
          v-for="(coord, index) in pickedCoordinates" 
          :key="index" 
          class="coord-item"
        >
          <div class="coord-index">点位 {{ index + 1 }}</div>
          <div class="coord-val">
            <span>Lon: {{ coord.lon }}</span>
            <span>Lat: {{ coord.lat }}</span>
            <span class="alt-val">Alt: {{ coord.alt }}m</span>
          </div>
        </div>
      </div>
      <div v-else class="empty-state">
        暂无点选坐标，请在地图上点击拾取。
      </div>
    </div>
  </div>
</template>

<style scoped>
.picker-container {
  display: flex;
  width: 100vw;
  height: 100vh;
  margin: 0;
  padding: 0;
  font-family: sans-serif;
  box-sizing: border-box;
}

#cesiumContainer {
  flex: 1;
  height: 100%;
}

.side-panel {
  width: 320px;
  background: #1e1e1e;
  color: #fff;
  padding: 20px;
  overflow-y: auto;
  border-left: 2px solid #333;
  display: flex;
  flex-direction: column;
}

.side-panel h3 {
  margin-top: 0;
  color: #409eff;
  margin-bottom: 10px;
}

.desc {
  font-size: 13px;
  color: #ccc;
  line-height: 1.5;
  margin-bottom: 20px;
}

.action-bar {
  margin-bottom: 15px;
}

.clear-btn {
  width: 100%;
  padding: 10px;
  background: #f56c6c;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: bold;
}
.clear-btn:hover {
  background: #f78989;
}

.coord-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.coord-item {
  background: #2a2a2a;
  padding: 10px;
  border-radius: 6px;
  border: 1px solid #444;
}

.coord-index {
  font-size: 12px;
  color: #8cc5ff;
  margin-bottom: 5px;
  font-weight: bold;
}

.coord-val {
  display: flex;
  flex-direction: column;
  font-size: 13px;
  font-family: monospace;
  color: #e5e5e5;
  gap: 4px;
}

.alt-val {
  color: #ebb563;
}

.empty-state {
  text-align: center;
  color: #666;
  font-size: 13px;
  margin-top: 40px;
}
</style>
