import { shallowRef, onBeforeUnmount } from 'vue';
import * as Cesium from 'cesium';
import { CESIUM_TOKEN, HOME_BASE, HOME_BASE_NAME, ROUTE_HEIGHT } from '../utils/constants';

export function useCesium(containerId = 'cesiumContainer') {
  const viewerRef = shallowRef(null);

  const initCesium = async () => {
    try {
      Cesium.Ion.defaultAccessToken = CESIUM_TOKEN;

      let terrainProvider;
      try {
        terrainProvider = await Cesium.createWorldTerrainAsync();
      } catch (error) {
        console.warn('WorldTerrain 加载失败，降级为默认地形:', error);
        terrainProvider = new Cesium.EllipsoidTerrainProvider();
      }

      const viewer = new Cesium.Viewer(containerId, {
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
      resetCamera();
    } catch (error) {
      console.error('Cesium 初始化失败:', error);
      throw error;
    }
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

  const resetCamera = () => {
    if (!viewerRef.value) return;
    viewerRef.value.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(HOME_BASE[0], HOME_BASE[1], 1400),
      orientation: {
        heading: Cesium.Math.toRadians(0.0),
        pitch: Cesium.Math.toRadians(-45.0),
        roll: 0.0,
      },
    });
  };

  onBeforeUnmount(() => {
    if (viewerRef.value && !viewerRef.value.isDestroyed()) {
      viewerRef.value.destroy();
    }
  });

  return {
    viewerRef,
    initCesium,
    resetCamera,
    addHomeBaseMarker
  };
}
