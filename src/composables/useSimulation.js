import { ref } from 'vue';
import axios from 'axios';
import { ElMessage } from 'element-plus';
import { API_BASE } from '../utils/constants';

export function useSimulation(runSimulation) {
  const userInput = ref('一号机出发去北门取完外卖，先送到汇文楼去，再送到米兰斋去，最后送到元平体育馆去。');
  const scenario = ref('medium');
  const loading = ref(false);
  const taskList = ref([]);
  const chainSummaries = ref([]);

  const handleSendCommand = async () => {
    if (!userInput.value) return;
    loading.value = true;

    try {
      const res = await axios.post(`${API_BASE}/api/parse_command_with_resources`, {
        query: userInput.value,
        scenario: scenario.value,
      });

      const tasks = res.data.tasks || [];
      const summaries = res.data.chain_summaries || [];
      
      taskList.value = tasks;
      chainSummaries.value = summaries;
      
      ElMessage.success('解析成功，开始资源感知仿真');

      if (runSimulation) {
        runSimulation(tasks, summaries);
      }
    } catch (error) {
      console.error(error);
      ElMessage.error('指令解析失败，请检查前后端服务');
    } finally {
      loading.value = false;
    }
  };

  return {
    userInput,
    scenario,
    loading,
    taskList,
    chainSummaries,
    handleSendCommand,
  };
}
