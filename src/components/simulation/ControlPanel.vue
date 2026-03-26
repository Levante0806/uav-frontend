<script setup>
import { computed } from 'vue';

const props = defineProps({
  userInput: String,
  scenario: String,
  loading: Boolean,
  isFollowMode: Boolean,
  hasDrones: Boolean
});

const emit = defineEmits([
  'update:userInput',
  'update:scenario',
  'update:isFollowMode',
  'startSimulation'
]);

const localUserInput = computed({
  get: () => props.userInput,
  set: (val) => emit('update:userInput', val)
});

const localScenario = computed({
  get: () => props.scenario,
  set: (val) => emit('update:scenario', val)
});

const localIsFollowMode = computed({
  get: () => props.isFollowMode,
  set: (val) => emit('update:isFollowMode', val)
});
</script>

<template>
  <div class="control-panel-header">
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
      <el-select v-model="localScenario" placeholder="选择资源场景" style="width: 100%">
        <el-option label="高电量场景" value="high" />
        <el-option label="中等电量场景" value="medium" />
        <el-option label="低电量场景" value="low" />
      </el-select>
    </div>

    <div class="view-controls mb-2" v-if="hasDrones">
      <el-switch
        v-model="localIsFollowMode"
        active-text="跟随视角"
        inactive-text="上帝视角"
        inline-prompt
        style="--el-switch-on-color: #13ce66; --el-switch-off-color: #409eff"
      />
    </div>

    <el-input
      v-model="localUserInput"
      type="textarea"
      :rows="4"
      placeholder="请输入自然语言指令..."
      class="mb-2"
    />

    <div class="actions">
      <el-button
        type="primary"
        :loading="loading"
        @click="$emit('startSimulation')"
        style="width: 100%"
      >
        🚀 生成并仿真
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.control-panel-header h3 {
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
</style>
