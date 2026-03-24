<script setup>
import { onMounted, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import * as Cesium from 'cesium';
import axios from 'axios';
import { ElMessage } from 'element-plus';

// --------------------------------------------------------------------
// 1. 状态定义
// --------------------------------------------------------------------
const CESIUM_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJjODYwMjZkMi02YzAzLTRiZjgtYWQ4Yy1lYzkzMmFjOTBjZjAiLCJpZCI6MjkwMTU0LCJpYXQiOjE3NjUwMzQxOTR9.WMQF23KeDp9RCrIK_Zc0lH2G2yfgTNjypGuRahUL-0M';
const API_BASE = 'http://127.0.0.1:8000';

const HOME_BASE = [113.931615, 22.537516];
const HOME_BASE_NAME = '无人机中心站点';

const viewerRef = shallowRef(null);

const userInput = ref(
  '一号机从北门出发取完货物，送到汇文楼去，同时二号机从立言门取完货物，送到田径运动场去'
);
const loading = ref(false);
const taskList = ref([]);

const scenario = ref('medium');
const isFollowMode = ref(false);
const droneEntities = ref([]);

const DRONE_SPEED = 20.0;
const ROUTE_HEIGHT = 200.0;

const DRONE_COLORS = [
  Cesium.Color.LIME,
  Cesium.Color.DODGERBLUE,
  Cesium.Color.MEDIUMORCHID,
  Cesium.Color.ORANGE,
  Cesium.Color.CYAN,
  Cesium.Color.HOTPINK,
  Cesium.Color.GOLD,
];

// --------------------------------------------------------------------
// 2. 地图初始化
// --------------------------------------------------------------------
onMounted(async () => {
  try {
    Cesium.Ion.defaultAccessToken = CESIUM_TOKEN;

    let terrainProvider;
    try {
      terrainProvider = await Cesium.createWorldTerrainAsync();
    } catch (error) {
      console.warn('WorldTerrain 加载失败，降级为默认地形:', error);
      terrainProvider = new Cesium.EllipsoidTerrainProvider();
    }

    const viewer = new Cesium.Viewer('cesiumContainer', {
      terrainProvider,
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

    try {
      const buildingsTileset = await Cesium.createOsmBuildingsAsync();
      viewer.scene.primitives.add(buildingsTileset);
    } catch (error) {
      console.warn('OSM Buildings 加载失败，跳过白模:', error);
    }

    addHomeBaseMarker(viewer);
    resetCamera(viewer);
  } catch (error) {
    console.error('Cesium 初始化失败:', error);
    ElMessage.error('Cesium 地图初始化失败，请检查 Token');
  }
});

onBeforeUnmount(() => {
  if (viewerRef.value && !viewerRef.value.isDestroyed()) {
    viewerRef.value.destroy();
  }
});

const resetCamera = (viewer) => {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(HOME_BASE[0], HOME_BASE[1], 1400),
    orientation: {
      heading: Cesium.Math.toRadians(0.0),
      pitch: Cesium.Math.toRadians(-45.0),
      roll: 0.0,
    },
  });
};

// --------------------------------------------------------------------
// 3. 工具函数
// --------------------------------------------------------------------
const getModeLabel = (mode) => {
  if (mode === 'direct') return '直接执行';
  if (mode === 'after_swap') return '换电后执行';
  if (mode === 'infeasible') return '不可执行';
  return '未知';
};

const getModeTagType = (mode) => {
  if (mode === 'direct') return 'success';
  if (mode === 'after_swap') return 'warning';
  if (mode === 'infeasible') return 'danger';
  return 'info';
};

const getDroneColor = (droneId, mode = 'direct') => {
  if (mode === 'infeasible' || !droneId) {
    return Cesium.Color.GRAY;
  }

  const match = String(droneId).match(/(\d+)/);
  const index = match ? Number(match[1]) - 1 : 0;
  return DRONE_COLORS[index % DRONE_COLORS.length];
};

const getTaskChains = (tasks) => {
  const taskMap = new Map(tasks.map((task) => [task.task_id, task]));
  const childrenMap = new Map();

  tasks.forEach((task) => {
    if (task.predecessor_id && taskMap.has(task.predecessor_id)) {
      if (!childrenMap.has(task.predecessor_id)) {
        childrenMap.set(task.predecessor_id, []);
      }
      childrenMap.get(task.predecessor_id).push(task);
    }
  });

  const roots = tasks.filter((task) => !task.predecessor_id || !taskMap.has(task.predecessor_id));
  const visited = new Set();
  const chains = [];

  const walk = (task, chain) => {
    if (visited.has(task.task_id)) return;
    visited.add(task.task_id);
    chain.push(task);

    const children = childrenMap.get(task.task_id) || [];
    children.forEach((child) => walk(child, chain));
  };

  roots.forEach((root) => {
    const chain = [];
    walk(root, chain);
    if (chain.length > 0) chains.push(chain);
  });

  tasks.forEach((task) => {
    if (!visited.has(task.task_id)) {
      chains.push([task]);
    }
  });

  return chains;
};

// --------------------------------------------------------------------
// 4. 核心业务逻辑
// --------------------------------------------------------------------
const handleSendCommand = async () => {
  if (!userInput.value) return;
  loading.value = true;

  try {
    const res = await axios.post(`${API_BASE}/api/parse_command_with_resources`, {
      query: userInput.value,
      scenario: scenario.value,
    });

    const tasks = res.data.tasks || [];
    taskList.value = tasks;
    ElMessage.success('解析成功，开始资源感知仿真');

    runSimulation(tasks);
  } catch (error) {
    console.error(error);
    ElMessage.error('指令解析失败，请检查前后端服务');
  } finally {
    loading.value = false;
  }
};

// --------------------------------------------------------------------
// 5. 仿真核心逻辑
// --------------------------------------------------------------------
const runSimulation = (tasks) => {
  const viewer = viewerRef.value;
  if (!viewer) return;

  viewer.entities.removeAll();
  droneEntities.value = [];
  isFollowMode.value = false;
  viewer.trackedEntity = undefined;

  addHomeBaseMarker(viewer);

  const start = Cesium.JulianDate.now();
  let globalStop = Cesium.JulianDate.addSeconds(start, 3600, new Cesium.JulianDate());

  const chains = getTaskChains(tasks);

  chains.forEach((chain) => {
    const executableTasks = chain.filter(
      (task) => task.coordinates && task.execution_mode !== 'infeasible'
    );

    chain.forEach((task) => {
      if (!task.coordinates) return;

      const droneColor = getDroneColor(task.assigned_drone_id, task.execution_mode);

      if (task.execution_mode === 'infeasible') {
        addMarker(
          viewer,
          task.coordinates,
          `${task.location_name}（不可执行）`,
          droneColor
        );
      } else {
        addMarker(
          viewer,
          task.coordinates,
          `${task.location_name}（${task.assigned_drone_id || '未分配'}）`,
          droneColor
        );
      }
    });

    if (executableTasks.length === 0) return;

    let currentTime = start;
    let currentStartPoint = Cesium.Cartesian3.fromDegrees(
      HOME_BASE[0],
      HOME_BASE[1],
      ROUTE_HEIGHT
    );

    const droneId = executableTasks[0].assigned_drone_id || executableTasks[0].task_id;
    const chainColor = getDroneColor(droneId, executableTasks[0].execution_mode);

    executableTasks.forEach((task, index) => {
      const endPoint = Cesium.Cartesian3.fromDegrees(
        task.coordinates[0],
        task.coordinates[1],
        ROUTE_HEIGHT
      );

      const distance = Cesium.Cartesian3.distance(currentStartPoint, endPoint);
      const duration = distance / DRONE_SPEED;
      const stopTime = Cesium.JulianDate.addSeconds(currentTime, duration, new Cesium.JulianDate());

      addPlannedLine(
        viewer,
        currentStartPoint,
        endPoint,
        `${task.task_id}`,
        chainColor,
        task.execution_mode
      );

      addRouteLine(
        viewer,
        currentStartPoint,
        endPoint,
        `${task.task_id}`,
        chainColor,
        task.execution_mode
      );

      const drone = createDroneEntity(
        viewer,
        currentTime,
        stopTime,
        currentStartPoint,
        endPoint,
        droneId,
        chainColor
      );
      droneEntities.value.push(drone);

      currentTime = stopTime;
      currentStartPoint = endPoint;

      if (index === executableTasks.length - 1) {
        const homePoint = Cesium.Cartesian3.fromDegrees(
          HOME_BASE[0],
          HOME_BASE[1],
          ROUTE_HEIGHT
        );

        const returnDistance = Cesium.Cartesian3.distance(currentStartPoint, homePoint);
        const returnDuration = returnDistance / DRONE_SPEED;
        const returnStopTime = Cesium.JulianDate.addSeconds(
          currentTime,
          returnDuration,
          new Cesium.JulianDate()
        );

        addReturnLine(
          viewer,
          currentStartPoint,
          homePoint,
          `${task.task_id}-return`,
          chainColor,
          task.execution_mode
        );

        const returnDrone = createDroneEntity(
          viewer,
          currentTime,
          returnStopTime,
          currentStartPoint,
          homePoint,
          `${droneId}-返航`,
          chainColor
        );
        droneEntities.value.push(returnDrone);

        if (Cesium.JulianDate.compare(returnStopTime, globalStop) > 0) {
          globalStop = returnStopTime;
        }
      } else {
        if (Cesium.JulianDate.compare(stopTime, globalStop) > 0) {
          globalStop = stopTime;
        }
      }
    });
  });

  viewer.clock.startTime = start.clone();
  viewer.clock.stopTime = globalStop.clone();
  viewer.clock.currentTime = start.clone();
  viewer.clock.clockRange = Cesium.ClockRange.LOOP_STOP;
  viewer.clock.multiplier = 5;
};

// --------------------------------------------------------------------
// 6. 视角切换逻辑
// --------------------------------------------------------------------
watch(isFollowMode, (val) => {
  const viewer = viewerRef.value;
  if (!viewer) return;

  if (val && droneEntities.value.length > 0) {
    viewer.trackedEntity = droneEntities.value[0];
    ElMessage.info('已切换至无人机跟随视角');
  } else {
    viewer.trackedEntity = undefined;
  }
});

// --------------------------------------------------------------------
// 7. 实体创建/绘制函数
// --------------------------------------------------------------------
const createDroneEntity = (viewer, startTime, stopTime, startPoint, endPoint, id, color) => {
  const positionProperty = new Cesium.SampledPositionProperty();
  positionProperty.addSample(startTime, startPoint);
  positionProperty.addSample(stopTime, endPoint);

  return viewer.entities.add({
    availability: new Cesium.TimeIntervalCollection([
      new Cesium.TimeInterval({ start: startTime, stop: stopTime }),
    ]),
    position: positionProperty,
    orientation: new Cesium.VelocityOrientationProperty(positionProperty),
    model: {
      uri: '/drone.glb',
      minimumPixelSize: 64,
      maximumScale: 200,
      runAnimations: true,
    },
    path: {
      resolution: 1,
      material: new Cesium.PolylineGlowMaterialProperty({
        glowPower: 0.2,
        taperPower: 0.5,
        color,
      }),
      width: 8,
      leadTime: 0,
      trailTime: 60,
    },
    label: {
      text: `${id}`,
      font: '14px monospace',
      pixelOffset: new Cesium.Cartesian2(0, -25),
      fillColor: color,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      outlineWidth: 2,
      outlineColor: Cesium.Color.BLACK,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
};

const addHomeBaseMarker = (viewer) => {
  const position = Cesium.Cartesian3.fromDegrees(HOME_BASE[0], HOME_BASE[1], ROUTE_HEIGHT);

  viewer.entities.add({
    position,
    point: {
      pixelSize: 14,
      color: Cesium.Color.DEEPSKYBLUE,
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 3,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: {
      text: HOME_BASE_NAME,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(0, -12),
      fillColor: Cesium.Color.WHITE,
      showBackground: true,
      backgroundColor: new Cesium.Color(0, 0.2, 0.5, 0.75),
      font: '13px sans-serif',
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
};

const addMarker = (viewer, coords, name, color) => {
  const position = Cesium.Cartesian3.fromDegrees(coords[0], coords[1], ROUTE_HEIGHT);

  viewer.entities.add({
    position,
    point: {
      pixelSize: 9,
      color,
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
      backgroundColor: new Cesium.Color(0, 0, 0, 0.55),
      font: '12px sans-serif',
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
};

const addPlannedLine = (viewer, startPoint, endPoint, id, color, mode) => {
  const material =
    mode === 'after_swap'
      ? new Cesium.PolylineDashMaterialProperty({
          color: color.withAlpha(0.95),
          dashLength: 18,
        })
      : new Cesium.ColorMaterialProperty(color.withAlpha(0.95));

  viewer.entities.add({
    name: `planned-${id}`,
    polyline: {
      positions: [startPoint, endPoint],
      width: 4,
      material,
      depthFailMaterial: material,
      arcType: Cesium.ArcType.NONE,
    },
  });
};

const addRouteLine = (viewer, startPoint, endPoint, id, color, mode) => {
  const material =
    mode === 'after_swap'
      ? new Cesium.PolylineDashMaterialProperty({
          color: color.withAlpha(0.8),
          dashLength: 14,
        })
      : new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.2,
          taperPower: 0.5,
          color: color.withAlpha(0.85),
        });

  viewer.entities.add({
    name: `route-${id}`,
    polyline: {
      positions: [startPoint, endPoint],
      width: 6,
      material,
      depthFailMaterial: material,
      arcType: Cesium.ArcType.NONE,
    },
  });
};

const addReturnLine = (viewer, startPoint, endPoint, id, color, mode) => {
  const material =
    mode === 'after_swap'
      ? new Cesium.PolylineDashMaterialProperty({
          color: color.withAlpha(0.55),
          dashLength: 10,
        })
      : new Cesium.PolylineDashMaterialProperty({
          color: color.withAlpha(0.45),
          dashLength: 20,
        });

  viewer.entities.add({
    name: `return-${id}`,
    polyline: {
      positions: [startPoint, endPoint],
      width: 3,
      material,
      depthFailMaterial: material,
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

      <div class="mb-2">
        <el-alert
          title="当前采用中心站点起降模式"
          type="info"
          :closable="false"
          show-icon
        />
      </div>

      <div class="mb-2">
        <el-select v-model="scenario" placeholder="选择资源场景" style="width: 100%">
          <el-option label="高电量场景" value="high" />
          <el-option label="中等电量场景" value="medium" />
          <el-option label="低电量场景" value="low" />
        </el-select>
      </div>

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
        :rows="4"
        placeholder="请输入自然语言指令..."
        class="mb-2"
      />

      <div class="actions">
        <el-button
          type="primary"
          :loading="loading"
          @click="handleSendCommand"
          style="width: 100%"
        >
          🚀 生成并仿真
        </el-button>
      </div>

      <div v-if="taskList.length > 0" class="task-list">
        <div v-for="t in taskList" :key="t.task_id" class="task-item">
          <div class="task-main">
            <el-tag size="small" :type="t.predecessor_id ? 'warning' : 'success'">
              {{ t.task_id }}
            </el-tag>

            <el-tag size="small" :type="getModeTagType(t.execution_mode)">
              {{ getModeLabel(t.execution_mode) }}
            </el-tag>

            <el-tag v-if="t.assigned_drone_id" size="small" type="info">
              {{ t.assigned_drone_id }}
            </el-tag>

            <span class="task-location">{{ t.location_name }}</span>
          </div>

          <div class="task-meta">
            <span v-if="t.estimated_total_time_min != null">
              链总耗时：{{ t.estimated_total_time_min.toFixed(2) }} min
            </span>

            <span
              v-if="t.return_margin_min != null"
              class="task-meta-item"
            >
              返航余量：{{ t.return_margin_min.toFixed(2) }} min
            </span>
          </div>

          <div v-if="t.infeasible_reason" class="task-error">
            原因：{{ t.infeasible_reason }}
          </div>
        </div>
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
  width: 340px;
  max-height: calc(100vh - 40px);
  overflow-y: auto;
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
  max-height: 260px;
  overflow-y: auto;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  padding-top: 10px;
}

.task-item {
  margin: 8px 0;
  padding: 8px 0;
  color: #ccc;
  font-size: 13px;
  border-bottom: 1px dashed rgba(255, 255, 255, 0.08);
}

.task-main {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.task-location {
  color: #f5f7fa;
}

.task-meta {
  margin-top: 6px;
  font-size: 12px;
  color: #999;
}

.task-meta-item {
  margin-left: 8px;
}

.task-error {
  margin-top: 6px;
  font-size: 12px;
  color: #f56c6c;
}
</style>
