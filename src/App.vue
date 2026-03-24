<script setup>
import CesiumMap from './components/CesiumMap.vue'
</script>

<template>
  <main>
    <CesiumMap />
  </main>
</template>

<style>
/* 全局重置样式，去掉浏览器默认边距 */
body, html, #app {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
}
</style>

//const CESIUM_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJjODYwMjZkMi02YzAzLTRiZjgtYWQ4Yy1lYzkzMmFjOTBjZjAiLCJpZCI6MjkwMTU0LCJpYXQiOjE3NjUwMzQxOTR9.WMQF23KeDp9RCrIK_Zc0lH2G2yfgTNjypGuRahUL-0M';


