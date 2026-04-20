<script setup>
import { HOME_BASE_NAME } from '../../utils/constants';

const props = defineProps({
  taskList: {
    type: Array,
    default: () => [],
  },
});

const getModeLabel = (mode) => {
  if (mode === 'direct') return '直接执行';
  if (mode === 'after_swap') return '换电后执行';
  if (mode === 'infeasible') return '不可执行';
  return mode || '未知';
};

const getModeTagType = (mode) => {
  if (mode === 'direct') return 'success';
  if (mode === 'after_swap') return 'warning';
  if (mode === 'infeasible') return 'danger';
  return 'info';
};

const getStaticModeLabel = (mode) => {
  if (mode === 'direct') return '静态可直接执行';
  if (mode === 'after_swap') return '静态需执行前换电';
  if (mode === 'infeasible') return '静态不可执行';
  return mode || '未知';
};

const getDynamicRecoveryLabel = (mode) => {
  if (mode === 'none') return '无需动态恢复';
  if (mode === 'swap_recovery') return '换电恢复';
  if (mode === 'handoff_recovery') return '换机接力';
  if (mode === 'mixed_recovery') return '混合恢复';
  return mode || '未知';
};

const getFinalStatusLabel = (status) => {
  if (status === 'completed_directly') return '直接完成';
  if (status === 'completed_after_swap_recovery') return '换电后完成';
  if (status === 'completed_after_handoff_recovery') return '换机后完成';
  if (status === 'completed_after_mixed_recovery') return '混合恢复后完成';
  if (status === 'failed_even_with_recovery') return '恢复后仍失败';
  return status || '未知';
};

const getFinalStatusTagType = (status) => {
  if (status && status.startsWith('completed')) return 'success';
  if (status === 'failed_even_with_recovery') return 'danger';
  return 'info';
};

const formatMeters = (value) => {
  if (value == null) return '--';
  return `${value.toFixed(1)} m`;
};

const formatMinutes = (value) => {
  if (value == null) return '--';
  return `${value.toFixed(2)} min`;
};

const formatPercent = (value) => {
  if (value == null) return '--';
  return `${value.toFixed(1)}%`;
};

const isSortieEndTask = (task) => {
  const children = props.taskList.filter((item) => item.predecessor_id === task.task_id);
  if (children.length === 0) return true;
  return children.every((child) => child.sortie_id !== task.sortie_id);
};
</script>

<template>
  <div v-if="taskList.length > 0" class="task-list">
    <div v-for="t in taskList" :key="t.task_id" class="task-item">
      <div class="task-main">
        <el-tag size="small" :type="t.predecessor_id ? 'warning' : 'success'">
          {{ t.task_id }}
        </el-tag>

        <el-tag size="small" :type="t.final_status ? getFinalStatusTagType(t.final_status) : getModeTagType(t.static_execution_mode || t.execution_mode)">
          {{ t.final_status ? getFinalStatusLabel(t.final_status) : getModeLabel(t.static_execution_mode || t.execution_mode) }}
        </el-tag>

        <el-tag v-if="t.assigned_drone_id" size="small" type="info">
          {{ t.assigned_drone_id }}
        </el-tag>

        <el-tag v-if="t.sortie_id" size="small" effect="dark" color="#409eff" style="border:none;">
          {{ t.sortie_id }}
        </el-tag>

        <span class="task-location">{{ t.location_name }}</span>
      </div>

      <div class="task-step" v-if="t.chain_step_index != null && t.total_tasks_in_chain != null">
        步骤 {{ t.chain_step_index }}/{{ t.total_tasks_in_chain }}
      </div>

      <div v-if="t.show_chain_summary" class="chain-summary">
        <div class="summary-title">链级摘要 / 动态恢复分析</div>

        <div class="summary-row" v-if="t.static_execution_mode">
          <span>静态预期：</span>
          <span :class="t.static_execution_mode === 'infeasible' ? 'text-danger' : 'text-success'">
            {{ getStaticModeLabel(t.static_execution_mode) }}
          </span>
        </div>

        <div class="summary-row" v-if="t.dynamic_recovery_mode">
          <span>动态恢复策略：</span>
          <span class="text-warning">{{ getDynamicRecoveryLabel(t.dynamic_recovery_mode) }}</span>
        </div>

        <div class="summary-row" v-if="t.final_status">
          <span>最终完成状态：</span>
          <span :class="t.final_status === 'failed_even_with_recovery' ? 'text-danger' : 'text-success'">
            {{ getFinalStatusLabel(t.final_status) }}
          </span>
        </div>

        <div class="summary-row" v-if="t.chain_total_completion_time_min != null">
          <span>全链总耗时：</span>
          <span>{{ formatMinutes(t.chain_total_completion_time_min) }}</span>
        </div>

        <div class="summary-row" v-if="t.swap_count != null">
          <span>总换电 / 换机次数：</span>
          <span>换电 {{ t.swap_count }} 次 / 换机 {{ t.handoff_count || 0 }} 次</span>
        </div>

        <div class="summary-row" v-if="t.battery_before_min != null && t.chain_total_completion_time_min == null">
          <span>起始可用电量：</span>
          <span>{{ formatMinutes(t.battery_before_min) }}</span>
        </div>

        <div class="summary-row" v-if="t.estimated_total_time_min != null && t.chain_total_completion_time_min == null">
          <span>链总耗时：</span>
          <span>{{ formatMinutes(t.estimated_total_time_min) }}</span>
        </div>

        <div class="summary-row" v-if="t.return_margin_min != null">
          <span>最终返航余量：</span>
          <span>{{ formatMinutes(t.return_margin_min) }}</span>
        </div>

        <div class="summary-row">
          <span>风向风速预估：</span>
          <span>东南风 3.5 m/s (预估)</span>
        </div>
      </div>

      <div v-if="t.recovery_event_summary" class="recovery-event">
        ⚠️ {{ t.recovery_event_summary }}
      </div>

      <div class="node-metrics">
        <div class="metric-row" v-if="t.segment_from_name">
          <span>当前段：</span>
          <span>{{ t.segment_from_name }} -> {{ t.location_name }}</span>
        </div>

        <div class="metric-row" v-if="t.segment_distance_m != null || t.segment_time_min != null">
          <span>本段距离 / 耗时：</span>
          <span>{{ formatMeters(t.segment_distance_m) }} / {{ formatMinutes(t.segment_time_min) }}</span>
        </div>

        <div class="metric-row" v-if="t.task_exec_time_min != null">
          <span>节点执行耗时：</span>
          <span>{{ formatMinutes(t.task_exec_time_min) }}</span>
        </div>

        <div class="metric-row" v-if="t.cumulative_time_min != null">
          <span>累计已用时间：</span>
          <span>{{ formatMinutes(t.cumulative_time_min) }}</span>
        </div>

        <div
          class="metric-row"
          v-if="t.battery_remaining_after_task_min != null || t.battery_remaining_after_task_pct != null"
        >
          <span>执行后剩余电量：</span>
          <span>
            {{ formatMinutes(t.battery_remaining_after_task_min) }}
            <template v-if="t.battery_remaining_after_task_pct != null">
              ({{ formatPercent(t.battery_remaining_after_task_pct) }})
            </template>
          </span>
        </div>

        <div
          class="metric-row"
          v-if="t.return_distance_from_here_m != null || t.return_time_from_here_min != null"
        >
          <span>当前点返航需求：</span>
          <span>
            {{ formatMeters(t.return_distance_from_here_m) }} / {{ formatMinutes(t.return_time_from_here_min) }}
          </span>
        </div>
      </div>

      <div
        v-if="isSortieEndTask(t) && (t.return_distance_from_here_m != null || t.return_time_from_here_min != null)"
        class="return-segment"
      >
        <div class="metric-row">
          <span>返航段：</span>
          <span>{{ t.location_name }} -> {{ HOME_BASE_NAME }}</span>
        </div>
        <div class="metric-row">
          <span>返航距离 / 耗时：</span>
          <span>{{ formatMeters(t.return_distance_from_here_m) }} / {{ formatMinutes(t.return_time_from_here_min) }}</span>
        </div>
      </div>

      <div v-if="t.infeasible_reason" class="task-error">
        原因：{{ t.infeasible_reason }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.task-list {
  margin-top: 15px;
  max-height: 52vh;
  overflow-y: auto;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  padding-top: 10px;
}

.task-item {
  margin: 10px 0;
  padding: 10px 0;
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

.task-step {
  margin-top: 6px;
  font-size: 12px;
  color: #c0c4cc;
}

.chain-summary {
  margin-top: 8px;
  padding: 8px 10px;
  background: rgba(64, 158, 255, 0.12);
  border: 1px solid rgba(64, 158, 255, 0.25);
  border-radius: 8px;
}

.summary-title {
  margin-bottom: 6px;
  font-size: 12px;
  color: #8cc5ff;
  font-weight: 600;
}

.summary-row,
.metric-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  line-height: 1.5;
}

.text-danger {
  color: #f56c6c;
}

.text-success {
  color: #67c23a;
}

.text-warning {
  color: #e6a23c;
}

.recovery-event,
.return-segment {
  margin-top: 8px;
  padding: 6px;
  border-radius: 4px;
  font-size: 12px;
}

.recovery-event {
  background: rgba(230, 162, 60, 0.15);
  border: 1px dotted #e6a23c;
  color: #e6a23c;
}

.return-segment {
  background: rgba(64, 158, 255, 0.12);
  border: 1px dotted rgba(64, 158, 255, 0.45);
  color: #dbeafe;
}

.node-metrics {
  margin-top: 8px;
  font-size: 12px;
  color: #d0d3d8;
}

.task-error {
  margin-top: 8px;
  font-size: 12px;
  color: #f56c6c;
}
</style>
