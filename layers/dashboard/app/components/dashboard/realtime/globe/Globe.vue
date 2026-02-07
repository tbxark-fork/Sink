<script setup lang="ts">
import { useGlobeColors } from '#layers/dashboard/app/composables/useGlobeColors'
import { useWebGLGlobe } from '#layers/dashboard/app/composables/useWebGLGlobe'
import { useDebounceFn, useElementSize } from '@vueuse/core'

const trafficEventBus = useTrafficEventBus()

const containerRef = useTemplateRef('containerRef')
const canvasRef = useTemplateRef('canvasRef')
const { width, height } = useElementSize(containerRef)

const globeData = useGlobeData()
const { arcColor, colors, countryColorTiers, heatmapColorTiers } = useGlobeColors()

const globe = useWebGLGlobe({
  canvasRef,
  width,
  height,
  countries: globeData.countries,
  locations: globeData.locations,
  countryStats: globeData.countryStats,
  maxCountryVisits: globeData.maxCountryVisits,
  highest: globeData.highest,
  colors,
  countryColorTiers,
  heatmapColorTiers,
})

const trafficEvent = useTrafficEvent({
  colos: globeData.colos,
  arcColor,
  globe: {
    isReady: () => globe.isReady.value,
    drawArc: globe.drawArc,
    drawRipple: globe.drawRipple,
  },
})

// Rebuild texture when data/colors change
watch([globeData.countryStats, countryColorTiers, heatmapColorTiers, colors, globeData.countries, globeData.locations], () => {
  globe.updateCountryTexture()
})

const handleResize = useDebounceFn(() => {
  globe.updateCanvasSize()
}, 100)
watch([width, height], handleResize)

onMounted(async () => {
  await globeData.init()

  const glInitialized = await globe.init()
  if (!glInitialized) {
    console.error('Failed to initialize WebGL')
    return
  }

  globe.updateCanvasSize()
  await globe.updateCountryTexture()

  const { latitude, longitude } = globeData.currentLocation.value
  if (latitude != null && longitude != null) {
    globe.setPointOfView(latitude, longitude, true)
  }
  else {
    globe.startAutoRotate()
  }

  globe.startRenderLoop()
  trafficEventBus.on(trafficEvent.handleTrafficEvent)
})

onBeforeUnmount(() => {
  globe.stopRenderLoop()
  globe.destroy()
  trafficEventBus.off(trafficEvent.handleTrafficEvent)
  trafficEvent.cleanup()
})
</script>

<template>
  <div
    ref="containerRef"
    class="relative h-full w-full"
    @mousedown="globe.stopAutoRotate"
    @touchstart="globe.stopAutoRotate"
  >
    <canvas ref="canvasRef" class="absolute inset-0" />
  </div>
</template>
