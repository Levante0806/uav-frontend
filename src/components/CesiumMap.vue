<script setup>
import { onMounted, ref, shallowRef, watch } from 'vue';
import * as Cesium from 'cesium';
import axios from 'axios';
import { ElMessage } from 'element-plus';

// --------------------------------------------------------------------
// 1. 状态定义
// --------------------------------------------------------------------
const CESIUM_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJjODYwMjZkMi02YzAzLTRiZjgtYWQ4Yy1lYzkzMmFjOTBjZjAiLCJpZCI6MjkwMTU0LCJpYXQiOjE3NjUwMzQxOTR9.WMQF23KeDp9RCrIK_Zc0lH2G2yfgTNjypGuRahUL-0M';

const viewerRef = shallowRef(null);

const userInput = ref('一号机从理工楼取货，然后飞往南区运动场交接，取完货物再到北门去');
const loading = ref(false);
const taskList = ref([]);

const isFollowMode = ref(false); // 是否开启跟随模式
const droneEntities = ref([]); // 存储所有无人机实体，用于追踪

// 飞行速度
const DRONE_SPEED = 20.0;

// ✅ 统一把标记/路径/无人机抬高到 200m
const ROUTE_HEIGHT = 200.0;

// --------------------------------------------------------------------
// 2. 地图初始化
// --------------------------------------------------------------------
onMounted(async () => {
  Cesium.Ion.defaultAccessToken = CESIUM_TOKEN;

  const viewer = new Cesium.Viewer('cesiumContainer', {
    terrainProvider: await Cesium.createWorldTerrainAsync(),
    animation: true,
    timeline: true,
    infoBox: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    baseLayerPicker: false,
    navigationHelpButton: false,
    creditContainer: document.createElement('div'),
    shouldAnimate: true,
  });

  viewerRef.value = viewer;

  // 加载 OSM 白模
  try {
    const buildingsTileset = await Cesium.createOsmBuildingsAsync();
    viewer.scene.primitives.add(buildingsTileset);
  } catch (error) {
    console.error('❌ 建筑加载失败:', error);
  }

  // 初始视角
  resetCamera(viewer);
});

// 辅助：重置回上帝视角
const resetCamera = (viewer) => {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(113.938, 22.535, 1200),
    orientation: {
      heading: Cesium.Math.toRadians(0.0),
      pitch: Cesium.Math.toRadians(-45.0),
      roll: 0.0,
    },
  });
};

// --------------------------------------------------------------------
// 3. 核心业务逻辑
// --------------------------------------------------------------------
const handleSendCommand = async () => {
  if (!userInput.value) return;
  loading.value = true;

  try {
    const res = await axios.post('http://127.0.0.1:8000/api/parse_command', {
      query: userInput.value,
    });

    const tasks = res.data.tasks;
    taskList.value = tasks;
    ElMessage.success(`解析成功！准备起飞！`);

    runSimulation(tasks);
  } catch (error) {
    console.error(error);
    ElMessage.error('指令解析失败，请检查后端');
  } finally {
    loading.value = false;
  }
};

// --------------------------------------------------------------------
// 4. 仿真核心逻辑
// --------------------------------------------------------------------
const runSimulation = (tasks) => {
  const viewer = viewerRef.value;
  if (!viewer) return;

  viewer.entities.removeAll();
  droneEntities.value = [];
  isFollowMode.value = false;
  viewer.trackedEntity = undefined;

  const start = Cesium.JulianDate.now();
  let stop = Cesium.JulianDate.addSeconds(start, 3600, new Cesium.JulianDate());

  const taskEndTimeMap = {};

  tasks.forEach((task) => {
    if (!task.coordinates) return;

    // 起点任务：只打点
    if (!task.predecessor_id) {
      taskEndTimeMap[task.task_id] = start;
      addMarker(viewer, task.coordinates, task.location_name, task.task_type);
      return;
    }

    // 后续任务：找前驱点作为起点
    let startLocation = null;
    let startTime = start;

    const prevTask = tasks.find((t) => t.task_id === task.predecessor_id);
    if (prevTask && prevTask.coordinates) {
      startLocation = prevTask.coordinates;
      if (taskEndTimeMap[task.predecessor_id]) {
        startTime = taskEndTimeMap[task.predecessor_id];
      }
    }

    if (!startLocation) return;

    // ✅ 统一使用 200m 高度的点
    const startPoint = Cesium.Cartesian3.fromDegrees(startLocation[0], startLocation[1], ROUTE_HEIGHT);
    const endPoint = Cesium.Cartesian3.fromDegrees(task.coordinates[0], task.coordinates[1], ROUTE_HEIGHT);

    const distance = Cesium.Cartesian3.distance(startPoint, endPoint);
    const duration = distance / DRONE_SPEED;
    const stopTime = Cesium.JulianDate.addSeconds(startTime, duration, new Cesium.JulianDate());

    taskEndTimeMap[task.task_id] = stopTime;

    if (Cesium.JulianDate.compare(stopTime, stop) > 0) {
      stop = stopTime;
    }

    // ✅ 先画黄线：规划线（最直观）
    addPlannedLine(viewer, startPoint, endPoint, `${task.predecessor_id}->${task.task_id}`);

    // ✅ 再画青色线：路径底座（带 depthFailMaterial，尽量不被白膜挡住）
    addRouteLine(viewer, startPoint, endPoint, `${task.predecessor_id}->${task.task_id}`);

    // 创建无人机并保存到列表
    const drone = createDroneEntity(
      viewer,
      startTime,
      stopTime,
      startPoint,
      endPoint,
      task.task_id,
      task.task_type
    );
    droneEntities.value.push(drone);

    // 终点打点（同样 200m + 不遮挡）
    addMarker(viewer, task.coordinates, task.location_name, task.task_type);
  });

  viewer.clock.startTime = start.clone();
  viewer.clock.stopTime = stop.clone();
  viewer.clock.currentTime = start.clone();
  viewer.clock.clockRange = Cesium.ClockRange.LOOP_STOP;
  viewer.clock.multiplier = 5;
};

// --------------------------------------------------------------------
// 5. 视角切换逻辑
// --------------------------------------------------------------------
watch(isFollowMode, (val) => {
  const viewer = viewerRef.value;
  if (!viewer) return;

  if (val && droneEntities.value.length > 0) {
    viewer.trackedEntity = droneEntities.value[0];
    ElMessage.info('已切换至无人机跟随视角');
  } else {
    viewer.trackedEntity = undefined;
    // resetCamera(viewer); // 可选
  }
});

// --------------------------------------------------------------------
// 6. 实体创建/绘制函数
// --------------------------------------------------------------------
const createDroneEntity = (viewer, startTime, stopTime, startPoint, endPoint, id, type) => {
  const positionProperty = new Cesium.SampledPositionProperty();
  positionProperty.addSample(startTime, startPoint);
  positionProperty.addSample(stopTime, endPoint);

  const entity = viewer.entities.add({
    availability: new Cesium.TimeIntervalCollection([new Cesium.TimeInterval({ start: startTime, stop: stopTime })]),
    position: positionProperty,
    orientation: new Cesium.VelocityOrientationProperty(positionProperty),
    model: {
      uri: '/drone.glb',
      minimumPixelSize: 64,
      maximumScale: 200,
      runAnimations: true,
    },
    // ✅ 尾迹仍保留（你原来的效果）
    // 说明：PathGraphics 本身没有 depthFailMaterial 参数；
    // 但因为我们把高度抬到 200m + 另画了 routeLine 底座，整体可视化会明显改善
    path: {
      resolution: 1,
      material: new Cesium.PolylineGlowMaterialProperty({
        glowPower: 0.2,
        taperPower: 0.5,
        color: Cesium.Color.CYAN,
      }),
      width: 8,
      leadTime: 0,
      trailTime: 60,
    },
    label: {
      text: `${id}`,
      font: '14px monospace',
      pixelOffset: new Cesium.Cartesian2(0, -25),
      fillColor: Cesium.Color.YELLOW,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      outlineWidth: 2,
      outlineColor: Cesium.Color.BLACK,

      // ✅ 无人机编号也不被白膜遮挡（顺手优化）
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });

  return entity;
};

// ✅ 标记点：抬高 + 强制不被遮挡
const addMarker = (viewer, coords, name, type) => {
  const position = Cesium.Cartesian3.fromDegrees(coords[0], coords[1], ROUTE_HEIGHT);

  viewer.entities.add({
    position,
    point: {
      pixelSize: 8,
      color: Cesium.Color.RED,
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: {
      text: name,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(0, -10),
      fillColor: Cesium.Color.WHITE,
      showBackground: true,
      backgroundColor: new Cesium.Color(0, 0, 0, 0.5),
      font: '12px sans-serif',
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
};

// ✅ 规划黄线：先把两点连起来（最直观）
const addPlannedLine = (viewer, startPoint, endPoint, id) => {
  const yellow = new Cesium.ColorMaterialProperty(Cesium.Color.YELLOW.withAlpha(0.95));

  viewer.entities.add({
    name: `planned-${id}`,
    polyline: {
      positions: [startPoint, endPoint],
      width: 4,
      material: yellow,
      depthFailMaterial: yellow, // ✅ 被建筑挡住也能显示
      arcType: Cesium.ArcType.NONE, // ✅ 直线连接（更像无人机飞行）
    },
  });
};

// ✅ 路径底座（青色）：帮助“运行轨迹”不被白膜挡住
const addRouteLine = (viewer, startPoint, endPoint, id) => {
  const cyanGlow = new Cesium.PolylineGlowMaterialProperty({
    glowPower: 0.2,
    taperPower: 0.5,
    color: Cesium.Color.CYAN.withAlpha(0.8),
  });

  viewer.entities.add({
    name: `route-${id}`,
    polyline: {
      positions: [startPoint, endPoint],
      width: 6,
      material: cyanGlow,
      depthFailMaterial: cyanGlow, // ✅ 被建筑挡住也能显示
      arcType: Cesium.ArcType.NONE,
    },
  });
};
</script>

<template>
  <div class="container">
    <div id="cesiumContainer"></div>

    <div class="control-panel">
      <h3>🚁 无人机指挥终端</h3>

      <div class="view-controls mb-2" v-if="droneEntities.length > 0">
        <el-switch
          v-model="isFollowMode"
          active-text="跟随视角"
          inactive-text="上帝视角"
          inline-prompt
          style="--el-switch-on-color: #13ce66; --el-switch-off-color: #409eff"
        />
      </div>

      <el-input
        v-model="userInput"
        type="textarea"
        :rows="3"
        placeholder="请输入自然语言指令..."
        class="mb-2"
      />

      <div class="actions">
        <el-button type="primary" :loading="loading" @click="handleSendCommand" style="width: 100%">
          🚀 生成并仿真
        </el-button>
      </div>

      <div v-if="taskList.length > 0" class="task-list">
        <p v-for="t in taskList" :key="t.task_id" class="task-item">
          <el-tag size="small" :type="t.predecessor_id ? 'warning' : 'success'">
            {{ t.task_id }}
          </el-tag>
          <span style="margin-left: 5px">{{ t.location_name }}</span>
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.container {
  position: relative;
  width: 100%;
  height: 100vh;
  overflow: hidden;
}

#cesiumContainer {
  width: 100%;
  height: 100%;
}

.control-panel {
  position: absolute;
  top: 20px;
  left: 20px;
  width: 320px;
  background: rgba(30, 30, 30, 0.85);
  backdrop-filter: blur(10px);
  padding: 20px;
  border-radius: 10px;
  color: white;
  z-index: 100;
  border: 1px solid rgba(255, 255, 255, 0.2);
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5);
  transition: all 0.3s ease;
}

.control-panel:hover {
  background: rgba(30, 30, 30, 0.95);
}

.control-panel h3 {
  margin-top: 0;
  margin-bottom: 15px;
  font-size: 18px;
  color: #409eff;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.view-controls {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 15px;
}

.mb-2 {
  margin-bottom: 15px;
}

.task-list {
  margin-top: 15px;
  max-height: 200px;
  overflow-y: auto;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  padding-top: 10px;
}

.task-item {
  margin: 5px 0;
  color: #ccc;
  display: flex;
  align-items: center;
  font-size: 13px;
}
</style>
