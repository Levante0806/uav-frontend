<script setup>
import { onMounted } from 'vue';
import { useCesium } from '../composables/useCesium';
import { useDrones } from '../composables/useDrones';
import { useSimulation } from '../composables/useSimulation';

import ControlPanel from './simulation/ControlPanel.vue';
import TaskList from './simulation/TaskList.vue';

// 1. 初始化 Cesium 基础场景
const { viewerRef, initCesium, addHomeBaseMarker } = useCesium('cesiumContainer');

// 2. 初始化无人机实体与航线逻辑
const { droneEntities, isFollowMode, runSimulation } = useDrones(viewerRef, addHomeBaseMarker);

// 3. 初始化仿真业务状态与 API 调用逻辑
const { userInput, scenario, loading, taskList, handleSendCommand } = useSimulation(runSimulation);

onMounted(() => {
  initCesium();
});
</script>

<template>
  <div class="container">
    <div id="cesiumContainer"></div>

    <div class="control-panel">
      <!-- 控制面板 UI -->
      <ControlPanel
        v-model:userInput="userInput"
        v-model:scenario="scenario"
        v-model:isFollowMode="isFollowMode"
        :loading="loading"
        :hasDrones="droneEntities.length > 0"
        @startSimulation="handleSendCommand"
      />

      <!-- 任务列表 UI -->
      <TaskList :taskList="taskList" />
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
  width: 360px;
  max-height: calc(100vh - 40px);
  overflow-y: hidden;
  display: flex;
  flex-direction: column;
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
</style>
