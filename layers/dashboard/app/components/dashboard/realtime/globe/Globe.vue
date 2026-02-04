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
})

// Traffic events
const trafficEvent = useTrafficEvent({
  colos: globeData.colos,
  arcColor,
  globe,
})

// Resize handling
const debouncedResize = useDebounceFn(() => {
  renderer.updateCanvasSize()
  globe.updateProjection()
}, 100)

watch([width, height], debouncedResize)

function stopRotation() {
  globe.stopAutoRotate()
}

// Lifecycle
onMounted(async () => {
  await globeData.init()

  globe.init()
  renderer.updateCanvasSize()

  const { latitude, longitude } = globeData.currentLocation.value
  if (latitude != null && longitude != null) {
    globe.setPointOfView(latitude, longitude)
  }

  renderer.startRenderLoop()
  globe.startAutoRotate()

  trafficEventBus.on(trafficEvent.handleTrafficEvent)
})

onBeforeUnmount(() => {
  renderer.stopRenderLoop()
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
