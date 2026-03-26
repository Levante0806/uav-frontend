# CesiumMap模块化重构方案

目前 [CesiumMap.vue](file:///d:/SZU-project/uav-frontend/src/components/CesiumMap.vue) 承担了所有的工作：地图初始化、经纬度计算、后端请求、任务链解析、漫游路线绘制、无人机动画、前端复杂 UI 的渲染。随着代码量增加，这会导致逻辑极难维护。

根据 Vue 3 的**组合式 API (Composition API)** 最佳实践，我建议将这近 800 行的“巨石”组件拆分为“**逻辑层 (Composables)**”和“**视图层 (Components)**”。

## Proposed Changes

### 1. 逻辑层拆分 (Composables)
将不涉及 DOM 渲染的纯逻辑抽取到独立的 [.js](file:///d:/SZU-project/uav-frontend/src/main.js)（或 `.ts`）文件中，让地图逻辑与 Vue 组件解耦。

#### [NEW] `src/composables/useCesium.js`
- **职责**：负责 Cesium Viewer 的初始化、相机视角的重置、WorldTerrain 地形和 OSM 建筑模型的加载、中心基站的绘制。
- **产出**：暴露出 `viewerRef`、`initCesium`、[resetCamera](file:///d:/SZU-project/uav-frontend/src/components/CesiumMap.vue#87-97) 等方法。

#### [NEW] `src/composables/useDrones.js`
- **职责**：专门管理所有的 Entity（实体）。包括：
  - 绘制任务节点 Marker
  - 绘制规划路线 (Planned Line)、实际飞行路线 (Route Line) 和返航路线 (Return Line)
  - 创建并驱动 3D 无人机沿着轨迹带有动画的移动 (实体跟随、时间采样插值)
- **产出**：暴露出 `drawRoutes`、`clearEntities`、`focusOnDrone`（跟随视角切换）等方法。

#### [NEW] `src/composables/useSimulation.js`
- **职责**：负责核心业务数据流。包括发送 Axios 请求到 `parse_command_with_resources`，解析复杂的 `tasks` 数据结构（前置任务、树状任务链），管理全局状态（如 `loading`, `scenario`, `taskList`）。

---

### 2. 视图层拆分 (UI Components)
将左侧悬浮的复杂控制面板抽离出去，让主页面只负责“拼装”。

#### [NEW] `src/components/simulation/ControlPanel.vue`
- **职责**：承载最上方的“无人机指挥终端”控制区（场景选择器、跟随视角开关、自然语言输入框、生成并仿真按钮）。它只负责把用户的输入 `emit` 给父组件。

#### [NEW] `src/components/simulation/TaskList.vue`
- **职责**：专门用于渲染原代码中长达几百行的 `<div v-for="t in taskList">` 列表。包含标签页、耗时计算、电量展示等复杂的纯 UI 渲染。

#### [MODIFY] [src/components/CesiumMap.vue](file:///d:/SZU-project/uav-frontend/src/components/CesiumMap.vue) (或重命名为 `CesiumSimulation.vue`)
- **职责**：作为主容器（Orchestrator）。
- **代码结构**：
  ```vue
  <template>
    <div class="container">
      <div id="cesiumContainer"></div>
      
      <!-- 复杂的 UI 被极简的标签替代 -->
      <div class="side-panel">
        <ControlPanel @start-simulation="handleSimulation" />
        <TaskList :tasks="taskList" />
      </div>
    </div>
  </template>
  
  <script setup>
  // 引入逻辑 Hook
  const { initCesium, viewerRef } = useCesium()
  const { drawRoutes } = useDrones(viewerRef)
  const { fetchTasks, taskList } = useSimulation()
  
  // 组装逻辑...
  </script>
  ```

## 优势
1. **彻底解耦**：Cesium 核心图形逻辑和 Vue UI 组件结构完全分离，找 Bug 更快。
2. **复用性强**：如果你以后需要一个只看地图不提供操作面板的纯展示页面，直接调用 `useCesium.js` 即可。
3. **团队协作**：如果之后有人负责调特效，有人负责写前端数据图表，两者可以修改各自的文件，不会出现 Git 冲突。

## User Review Required
> [!IMPORTANT]
> 此重构动作涉及到对现有 [CesiumMap.vue](file:///d:/SZU-project/uav-frontend/src/components/CesiumMap.vue) 文件的完全重写。虽然不会改变任何现有的业务逻辑和页面外观，但我需要你的确认：**是否喜欢这个模块化拆分的方案，并准备好让我开始执行代码重构？**
