import * as Cesium from 'cesium';
import { ref, watch } from 'vue';
import { DRONE_COLORS, DRONE_SPEED, ROUTE_HEIGHT, HOME_BASE } from '../utils/constants';

export function useDrones(viewerRef, addHomeBaseMarker) {
  const droneEntities = ref([]);
  const isFollowMode = ref(false);
  let clockTickHandler = null;

  const addSeconds = (time, seconds) => Cesium.JulianDate.addSeconds(time, seconds, new Cesium.JulianDate());

  const getDroneColor = (droneId, mode = 'direct') => {
    if (mode === 'infeasible' || !droneId) {
      return Cesium.Color.GRAY;
    }
    const match = String(droneId).match(/(\d+)/);
    const index = match ? Number(match[1]) - 1 : 0;
    return DRONE_COLORS[index % DRONE_COLORS.length];
  };

  const getChainVisualIdentity = (chain, taskMap) => {
    const firstSortie = Array.isArray(chain?.sorties)
      ? chain.sorties.find((sortie) => Array.isArray(sortie.task_ids) && sortie.task_ids.length > 0)
      : null;
    const firstTask = firstSortie ? taskMap.get(firstSortie.task_ids[0]) : null;
    const label = firstTask?.assigned_drone_id || firstTask?.task_id || chain?.chain_root_task_id || '任务链';

    return {
      label,
      color: getDroneColor(label, 'direct'),
    };
  };

  const getActiveDroneEntity = (time) => {
    return droneEntities.value.find((entity) => entity.availability?.contains(time));
  };

  const syncTrackedEntity = (viewer) => {
    if (!viewer || !isFollowMode.value) {
      if (viewer) viewer.trackedEntity = undefined;
      return;
    }

    viewer.trackedEntity = getActiveDroneEntity(viewer.clock.currentTime);
  };

  const ensureClockTickListener = (viewer) => {
    if (!viewer || clockTickHandler) return;

    clockTickHandler = () => {
      syncTrackedEntity(viewer);
    };

    viewer.clock.onTick.addEventListener(clockTickHandler);
  };

  const removeClockTickListener = (viewer) => {
    if (!viewer || !clockTickHandler) return;
    viewer.clock.onTick.removeEventListener(clockTickHandler);
    clockTickHandler = null;
  };

  const clearEntities = () => {
    const viewer = viewerRef.value;
    if (!viewer) return;
    removeClockTickListener(viewer);
    viewer.entities.removeAll();
    droneEntities.value = [];
    isFollowMode.value = false;
    viewer.trackedEntity = undefined;
    addHomeBaseMarker(viewer);
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

  const addPlannedLine = (viewer, startPoint, endPoint, id, color) => {
    const material = new Cesium.ColorMaterialProperty(color.withAlpha(0.95));

    viewer.entities.add({
      name: `planned-${id}`,
      polyline: { positions: [startPoint, endPoint], width: 5, material, depthFailMaterial: material, arcType: Cesium.ArcType.NONE },
    });
  };

  const addReturnLine = (viewer, startPoint, endPoint, id, color) => {
    const material = new Cesium.PolylineDashMaterialProperty({ color: color.withAlpha(0.9), dashLength: 14 });

    viewer.entities.add({
      name: `return-${id}`,
      polyline: { positions: [startPoint, endPoint], width: 5, material, depthFailMaterial: material, arcType: Cesium.ArcType.NONE },
    });
  };

  const addFlownLine = (viewer, startPoint, endPoint, id, startTime, stopTime) => {
    const positions = new Cesium.CallbackProperty(() => {
      const currentTime = viewer.clock.currentTime;

      if (Cesium.JulianDate.compare(currentTime, startTime) < 0) {
        return [];
      }

      if (Cesium.JulianDate.compare(currentTime, stopTime) >= 0) {
        return [startPoint, endPoint];
      }

      const totalSeconds = Cesium.JulianDate.secondsDifference(stopTime, startTime);
      if (totalSeconds <= 0) {
        return [startPoint, endPoint];
      }

      const elapsedSeconds = Cesium.JulianDate.secondsDifference(currentTime, startTime);
      const progress = Cesium.Math.clamp(elapsedSeconds / totalSeconds, 0, 1);
      const currentPoint = Cesium.Cartesian3.lerp(startPoint, endPoint, progress, new Cesium.Cartesian3());
      return [startPoint, currentPoint];
    }, false);

    const material = new Cesium.ColorMaterialProperty(Cesium.Color.WHITE.withAlpha(0.98));

    viewer.entities.add({
      name: `flown-${id}`,
      polyline: {
        positions,
        width: 3.6,
        material,
        depthFailMaterial: material,
        arcType: Cesium.ArcType.NONE,
      },
    });
  };

  const addRecoveryEventLabel = (viewer, text, laneIndex = 1) => {
    const position = Cesium.Cartesian3.fromDegrees(HOME_BASE[0], HOME_BASE[1], ROUTE_HEIGHT + 20);

    viewer.entities.add({
      position,
      label: {
        text: `⚠️ ${text}`,
        font: '14px sans-serif',
        fillColor: Cesium.Color.ORANGE,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        outlineWidth: 2,
        outlineColor: Cesium.Color.BLACK,
        pixelOffset: new Cesium.Cartesian2(0, -30 * laneIndex),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  };

  const createDroneEntity = (viewer, startTime, stopTime, startPoint, endPoint, id, color) => {
    const positionProperty = new Cesium.SampledPositionProperty();
    positionProperty.addSample(startTime, startPoint);
    positionProperty.addSample(stopTime, endPoint);
    positionProperty.setInterpolationOptions({
      interpolationAlgorithm: Cesium.LinearApproximation,
      interpolationDegree: 1,
    });

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

  const drawTaskChain = (viewer, chainTasks, start, homePoint, globalStopRef) => {
    const executableTasks = chainTasks.filter((task) => task.coordinates && task.execution_mode !== 'infeasible');
    if (executableTasks.length === 0) return false;

    let currentTime = start;
    let currentStartPoint = homePoint;

    const droneId = executableTasks[0].assigned_drone_id || executableTasks[0].task_id;
    const chainColor = getDroneColor(droneId, executableTasks[0].execution_mode);

    executableTasks.forEach((task, index) => {
      const endPoint = Cesium.Cartesian3.fromDegrees(task.coordinates[0], task.coordinates[1], ROUTE_HEIGHT);
      const distance = Cesium.Cartesian3.distance(currentStartPoint, endPoint);
      const duration = distance / DRONE_SPEED;
      const stopTime = addSeconds(currentTime, duration);

      addPlannedLine(viewer, currentStartPoint, endPoint, `${task.task_id}`, chainColor);
      addFlownLine(viewer, currentStartPoint, endPoint, `${task.task_id}`, currentTime, stopTime);

      const drone = createDroneEntity(viewer, currentTime, stopTime, currentStartPoint, endPoint, droneId, chainColor);
      droneEntities.value.push(drone);

      currentTime = stopTime;
      currentStartPoint = endPoint;

      if (index === executableTasks.length - 1) {
        const returnDistance = Cesium.Cartesian3.distance(currentStartPoint, homePoint);
        const returnDuration = returnDistance / DRONE_SPEED;
        const returnStopTime = addSeconds(currentTime, returnDuration);

        addReturnLine(viewer, currentStartPoint, homePoint, `${task.task_id}-return`, chainColor);
        addFlownLine(viewer, currentStartPoint, homePoint, `${task.task_id}-return`, currentTime, returnStopTime);

        const returnDrone = createDroneEntity(viewer, currentTime, returnStopTime, currentStartPoint, homePoint, `${droneId}-返航`, chainColor);
        droneEntities.value.push(returnDrone);

        if (Cesium.JulianDate.compare(returnStopTime, globalStopRef.value) > 0) {
          globalStopRef.value = returnStopTime;
        }
      } else if (Cesium.JulianDate.compare(currentTime, globalStopRef.value) > 0) {
        globalStopRef.value = currentTime;
      }
    });

    return true;
  };

  const runSimulation = (tasks, chainSummaries = []) => {
    const viewer = viewerRef.value;
    if (!viewer) return;

    clearEntities();

    const start = Cesium.JulianDate.now();
    const globalStopRef = { value: addSeconds(start, 3600) };
    const homePoint = Cesium.Cartesian3.fromDegrees(HOME_BASE[0], HOME_BASE[1], ROUTE_HEIGHT);
    const taskMap = new Map(tasks.map((task) => [task.task_id, task]));

    tasks.forEach((task) => {
      if (!task.coordinates) return;
      const executionMode = task.static_execution_mode || task.execution_mode || 'direct';
      const isFailed = task.final_status === 'failed_even_with_recovery' || (!task.final_status && executionMode === 'infeasible');
      const droneColor = isFailed ? Cesium.Color.GRAY : getDroneColor(task.assigned_drone_id, 'direct');
      const markerName = isFailed
        ? `${task.location_name}（不可执行）`
        : `${task.location_name}（${task.assigned_drone_id || '未分配'}）`;

      addMarker(viewer, task.coordinates, markerName, droneColor);
    });

    if (chainSummaries && chainSummaries.length > 0) {
      chainSummaries.forEach((chain) => {
        if (!Array.isArray(chain.sorties) || chain.final_status === 'failed_even_with_recovery') return;

        let currentTime = start;
        let currentStartPoint = homePoint;
        const chainVisual = getChainVisualIdentity(chain, taskMap);

        chain.sorties.forEach((sortie) => {
          if (!Array.isArray(sortie.task_ids) || sortie.task_ids.length === 0) return;

          const firstTask = taskMap.get(sortie.task_ids[0]);
          if (!firstTask) return;

          const droneId = chainVisual.label;
          const chainColor = chainVisual.color;
          const executionMode = chain.dynamic_recovery_mode || firstTask.dynamic_recovery_mode || firstTask.execution_mode || 'direct';

          if (sortie.start_from_home !== false) {
            currentStartPoint = homePoint;
          }

          if (firstTask.recovery_event_summary && firstTask.recovery_action_before_task !== 'none') {
            addRecoveryEventLabel(viewer, firstTask.recovery_event_summary, Number(firstTask.sortie_id || 1));
          }

          sortie.task_ids.forEach((taskId, index) => {
            const task = taskMap.get(taskId);
            if (!task || !task.coordinates) return;

            const endPoint = Cesium.Cartesian3.fromDegrees(task.coordinates[0], task.coordinates[1], ROUTE_HEIGHT);
            const distance = Cesium.Cartesian3.distance(currentStartPoint, endPoint);
            const duration = distance / DRONE_SPEED;
            const stopTime = addSeconds(currentTime, duration);

            addPlannedLine(viewer, currentStartPoint, endPoint, `${task.task_id}`, chainColor);
            addFlownLine(viewer, currentStartPoint, endPoint, `${task.task_id}`, currentTime, stopTime);

            const drone = createDroneEntity(viewer, currentTime, stopTime, currentStartPoint, endPoint, droneId, chainColor);
            droneEntities.value.push(drone);

            currentTime = stopTime;
            currentStartPoint = endPoint;

            if (index === sortie.task_ids.length - 1) {
              const returnDistance = Cesium.Cartesian3.distance(currentStartPoint, homePoint);
              const returnDuration = returnDistance / DRONE_SPEED;
              const returnStopTime = addSeconds(currentTime, returnDuration);

              addReturnLine(viewer, currentStartPoint, homePoint, `${task.task_id}-return`, chainColor);
              addFlownLine(viewer, currentStartPoint, homePoint, `${task.task_id}-return`, currentTime, returnStopTime);

              const returnDrone = createDroneEntity(viewer, currentTime, returnStopTime, currentStartPoint, homePoint, `${droneId}-返航`, chainColor);
              droneEntities.value.push(returnDrone);

              currentTime = returnStopTime;
              currentStartPoint = homePoint;

              if (Cesium.JulianDate.compare(returnStopTime, globalStopRef.value) > 0) {
                globalStopRef.value = returnStopTime;
              }
            } else if (Cesium.JulianDate.compare(currentTime, globalStopRef.value) > 0) {
              globalStopRef.value = currentTime;
            }
          });
        });
      });
    }

    if (droneEntities.value.length === 0) {
      const chains = getTaskChains(tasks);
      chains.forEach((chain) => {
        drawTaskChain(viewer, chain, start, homePoint, globalStopRef);
      });
    }

    viewer.clock.startTime = start.clone();
    viewer.clock.stopTime = globalStopRef.value.clone();
    viewer.clock.currentTime = start.clone();
    viewer.clock.clockRange = Cesium.ClockRange.LOOP_STOP;
    viewer.clock.multiplier = 5;
    viewer.clock.shouldAnimate = true;
    if (viewer.timeline) {
      viewer.timeline.zoomTo(start, globalStopRef.value);
    }
    ensureClockTickListener(viewer);
    syncTrackedEntity(viewer);
  };

  watch(isFollowMode, (val) => {
    const viewer = viewerRef.value;
    if (!viewer) return;

    if (val) {
      ensureClockTickListener(viewer);
      syncTrackedEntity(viewer);
    } else {
      viewer.trackedEntity = undefined;
    }
  });

  return {
    droneEntities,
    isFollowMode,
    runSimulation,
    clearEntities,
  };
}
