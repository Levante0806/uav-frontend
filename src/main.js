
import { createApp } from 'vue'
import App from './App.vue'

// ✅ 引入 Element Plus 及其样式
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'

const app = createApp(App)

app.use(ElementPlus) // 注册组件库
app.mount('#app')