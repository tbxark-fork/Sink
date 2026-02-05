<script setup lang="ts">
import { useDebounceFn, useElementSize } from '@vueuse/core'
import {
  createGlobeConfig,
  useGlobeData,
  useTrafficEvent,
} from './useGlobeData'
import { useGlobeColors, useGlobeRenderer } from './useGlobeRenderer'

// Traffic event bus (auto-imported from app/composables)
const trafficEventBus = useTrafficEventBus()

// Refs
const containerRef = useTemplateRef('containerRef')
const canvasRef = useTemplateRef('canvasRef')
const svgRef = useTemplateRef('svgRef')

const { width, height } = useElementSize(containerRef)

// Data layer
const globeData = useGlobeData()

// Config
const globeConfig = createGlobeConfig(width, height, globeData.currentLocation)

// D3 Globe (projection, interactions, animations)
const globe = useD3Globe(svgRef, globeConfig)

// Colors
const { arcColor, colors, countryColorTiers } = useGlobeColors()

// Worker for heavy computations
const globeWorker = useGlobeWorker()

// Renderer
const renderer = useGlobeRenderer({
  canvasRef,
  config: globeConfig,
  countries: globeData.countries,
  locations: globeData.locations,
  countryStats: globeData.countryStats,
  maxCountryVisits: globeData.maxCountryVisits,
  highest: globeData.highest,
  colors,
  countryColorTiers,
  getProjection: globe.getProjection,
  updateProjection: globe.updateProjection,
  getRotation: globe.getRotation,
  getScale: globe.getScale,
  getRadius: () => globe.radius.value,
})

// Traffic events
const trafficEvent = useTrafficEvent({
  colos: globeData.colos,
  arcColor,
  globe,
})

// Send data to worker for computation
function updateWorkerData() {
  if (globeData.locations.value.length === 0) {
    // Clear visible points when data is empty
    renderer.setVisiblePoints([])
    return
  }

  globeWorker.computeAsync({
    locations: globeData.locations.value,
    width: globeConfig.value.width,
    height: globeConfig.value.height,
    scale: globe.scale.value,
    rotation: globe.rotation.value,
    radius: globe.radius.value,
    highest: globeData.highest.value,
  })
}

// Watch for worker results and update renderer
watch(globeWorker.currentBuffer, (points) => {
  renderer.setVisiblePoints(points)
})

// Watch for data changes to trigger worker computation
watch([
  globeData.locations,
  globeData.highest,
], updateWorkerData)

// Watch for rotation/scale changes to update worker (throttled via worker busy state)
watch([globe.rotation, globe.scale], updateWorkerData)

// Watch for data/color changes to invalidate country path cache
watch([globeData.countryStats, countryColorTiers, colors], () => {
  renderer.invalidatePathCache()
})

// Resize handling
const debouncedResize = useDebounceFn(() => {
  renderer.updateCanvasSize()
  globe.updateProjection()
  updateWorkerData()
}, 100)

watch([width, height], debouncedResize)

function stopRotation() {
  globe.stopAutoRotate()
}

// Lifecycle
onMounted(async () => {
  // Initialize worker
  globeWorker.init()

  await globeData.init()

  globe.init()
  renderer.updateCanvasSize()

  const { latitude, longitude } = globeData.currentLocation.value
  if (latitude != null && longitude != null) {
    globe.setPointOfView(latitude, longitude)
  }

  // Initial worker computation
  updateWorkerData()

  renderer.startRenderLoop()
  globe.startAutoRotate()

  trafficEventBus.on(trafficEvent.handleTrafficEvent)
})

onBeforeUnmount(() => {
  renderer.stopRenderLoop()
  globeWorker.destroy()
  trafficEventBus.off(trafficEvent.handleTrafficEvent)
  globe.destroy()
  trafficEvent.cleanup()
})
</script>

<template>
  <div
    ref="containerRef"
    class="relative h-full w-full"
    :style="{ '--globe-glow-color': arcColor }"
    @mousedown="stopRotation"
    @touchstart="stopRotation"
  >
    <canvas ref="canvasRef" class="absolute inset-0" />
    <svg ref="svgRef" class="pointer-events-auto absolute inset-0" :width="width" :height="height || width" />
  </div>
</template>

<style>
.globe-arc {
  filter: drop-shadow(0 0 4px var(--globe-glow-color));
}

.globe-ripple {
  filter: drop-shadow(0 0 3px var(--globe-glow-color));
}
</style>
