<script setup lang="ts">
import { useDebounceFn, useElementSize } from '@vueuse/core'

const trafficEventBus = useTrafficEventBus()

const containerRef = useTemplateRef('containerRef')
const canvasRef = useTemplateRef('canvasRef')
const svgRef = useTemplateRef('svgRef')
const { width, height } = useElementSize(containerRef)

const globeData = useGlobeData()
const globeConfig = createGlobeConfig(width, height, globeData.currentLocation)
const globe = useD3Globe(svgRef, globeConfig)
const { arcColor, colors, countryColorTiers } = useGlobeColors()

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
  getRadius: globe.getRadius,
})

const trafficEvent = useTrafficEvent({
  colos: globeData.colos,
  arcColor,
  globe,
})

// Smart render loop: only continuous render when animating
const needsContinuousRender = computed(() =>
  globe.isAutoRotating.value
  || globe.isInertiaActive.value
  || globe.isInteracting.value
  || globe.hasActiveAnimations.value,
)

watch(needsContinuousRender, (needsLoop) => {
  if (needsLoop) {
    renderer.startRenderLoop()
  }
  else {
    renderer.stopRenderLoop()
    renderer.renderOnce()
  }
})

function renderOnceIfIdle() {
  if (!needsContinuousRender.value)
    renderer.renderOnce()
}

function invalidatePathCacheAndRender() {
  renderer.invalidatePathCache()
  renderOnceIfIdle()
}

function markDirtyAndRender() {
  renderer.markDirty()
  renderOnceIfIdle()
}

watch([globeData.countryStats, countryColorTiers, colors], invalidatePathCacheAndRender)
watch(globeData.countries, invalidatePathCacheAndRender)
watch(globeData.locations, markDirtyAndRender)

const handleResize = useDebounceFn(() => {
  renderer.updateCanvasSize()
  globe.updateProjection()
}, 100)
watch([width, height], handleResize)

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
    @mousedown="globe.stopAutoRotate"
    @touchstart="globe.stopAutoRotate"
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
