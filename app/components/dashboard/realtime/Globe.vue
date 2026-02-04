<script setup lang="ts">
import type { GeoPermissibleObjects } from 'd3-geo'
import type { GlobeConfig } from '@/composables/useD3Globe'
import type { AreaData, ColoData, CurrentLocation, GeoJSONData, LocationData } from '@/types'
import type { TrafficEventParams } from '@/utils/events'
import { useDebounceFn, useElementSize, watchDeep } from '@vueuse/core'
import { geoGraticule, geoPath } from 'd3-geo'
import { scaleSequentialSqrt } from 'd3-scale'
import { interpolateYlOrRd } from 'd3-scale-chromatic'
import { timer } from 'd3-timer'

const realtimeStore = useDashboardRealtimeStore()
const colorMode = useColorMode()

const countries = shallowRef<GeoJSONData>({ features: [] })
const locations = shallowRef<LocationData[]>([])
const colos = shallowRef<Record<string, ColoData>>({})
const currentLocation = ref<CurrentLocation>({})
const countryStats = shallowRef<Map<string, number>>(new Map())

const containerRef = useTemplateRef('containerRef')
const canvasRef = useTemplateRef('canvasRef')
const svgRef = useTemplateRef('svgRef')

const { width, height } = useElementSize(containerRef)

const globeConfig = computed<GlobeConfig>(() => ({
  width: width.value,
  height: height.value || width.value,
  sensitivity: 75,
  autoRotateSpeed: 0.3,
  initialRotation: [
    currentLocation.value.longitude ? -currentLocation.value.longitude : 0,
    currentLocation.value.latitude ? -currentLocation.value.latitude : -20,
  ],
}))

const globe = useD3Globe(svgRef, globeConfig)

// Color scheme based on theme
const isDark = computed(() => colorMode.value === 'dark')

// Country color tiers - all use chart-2 with different opacity levels
const countryColorTiers = computed(() => ({
  // No data - light gray
  noData: isDark.value ? 'oklch(0.4 0.005 286)' : 'oklch(0.9 0.002 286)',
  noDataStroke: isDark.value ? 'oklch(0.5 0.005 286)' : 'oklch(0.85 0.002 286)',
  // Tier 1 (low) - chart-2 with low opacity
  tier1: isDark.value ? 'oklch(0.723 0.219 149.579 / 35%)' : 'oklch(0.723 0.219 149.579 / 30%)',
  // Tier 2 (medium) - chart-2 with medium opacity
  tier2: isDark.value ? 'oklch(0.723 0.219 149.579 / 55%)' : 'oklch(0.723 0.219 149.579 / 50%)',
  // Tier 3 (high) - chart-2 with high opacity
  tier3: isDark.value ? 'oklch(0.723 0.219 149.579 / 75%)' : 'oklch(0.723 0.219 149.579 / 70%)',
}))

// Arc/Ripple color - light orange from YlOrRd palette
const arcColor = computed(() => isDark.value ? 'oklch(0.85 0.15 70)' : 'oklch(0.8 0.12 65)')

const colors = computed(() => ({
  // Globe background
  globeFill: isDark.value ? 'oklch(0.274 0.006 286.033)' : 'oklch(0.967 0.001 286.375)',
  globeStroke: isDark.value ? 'oklch(0.5 0.01 286 / 50%)' : 'oklch(0.7 0.005 286 / 40%)',
  // Graticule
  graticuleFill: 'none',
  graticuleStroke: isDark.value ? 'oklch(0.35 0.01 286 / 30%)' : 'oklch(0.8 0.005 286 / 40%)',
  // Country stroke
  countryStroke: isDark.value ? 'oklch(0.5 0.005 286 / 30%)' : 'oklch(0.85 0.002 286 / 20%)',
}))

const highest = computed(() => Math.max(...locations.value.map(l => l.count), 1))

const maxCountryVisits = computed(() => Math.max(...countryStats.value.values(), 1))

// Cache country groups by color tier - only rebuild when data or theme changes
const countryGroups = computed(() => {
  const groups = new Map<string, any[]>()
  const max = maxCountryVisits.value
  const tiers = countryColorTiers.value

  for (const feature of countries.value.features) {
    const props = (feature as any).properties
    const countryCode = props?.ISO_A2 || props?.iso_a2 || ''
    const count = countryStats.value.get(countryCode) || 0

    const ratio = count / max
    const fill = count === 0
      ? tiers.noData
      : ratio <= 0.33
        ? tiers.tier1
        : ratio <= 0.66
          ? tiers.tier2
          : tiers.tier3

    const group = groups.get(fill)
    if (group) {
      group.push(feature)
    }
    else {
      groups.set(fill, [feature])
    }
  }

  return groups
})

// Weight color scale - cached based on highest value
const weightColor = computed(() => {
  const domainMax = highest.value * 3
  return scaleSequentialSqrt(interpolateYlOrRd).domain([0, domainMax])
})

// Render timer for continuous updates
let renderTimer: ReturnType<typeof timer> | null = null

// Canvas size state - only update on resize
let canvasWidth = 0
let canvasHeight = 0
let canvasDpr = 1

// Pending timeouts for cleanup
const pendingTimeouts = new Set<ReturnType<typeof setTimeout>>()

// Graticule generator - reuse instance
const graticule = geoGraticule()

async function getGlobeJSON() {
  const data = await $fetch('/countries.geojson')
  countries.value = data as GeoJSONData
}

async function getColosJSON() {
  const data = await $fetch('/colos.json')
  colos.value = data as Record<string, ColoData>
}

async function getCurrentLocation() {
  const data = await useAPI<CurrentLocation>('/api/location')
  currentLocation.value = data
}

async function getCountryStats() {
  const result = await useAPI<{ data: AreaData[] }>('/api/stats/metrics', {
    query: {
      type: 'country',
      startAt: realtimeStore.timeRange.startAt,
      endAt: realtimeStore.timeRange.endAt,
      ...realtimeStore.filters,
    },
  })

  const statsMap = new Map<string, number>()
  if (Array.isArray(result.data)) {
    result.data.forEach((item) => {
      // API returns ISO_A2 codes (e.g. "US", "CN") which match GeoJSON ISO_A2 property
      statsMap.set(item.name, item.count)
    })
  }
  countryStats.value = statsMap
}

interface RawLocationData {
  latitude: number
  longitude: number
  count: string | number
}

async function getLiveLocations() {
  const result = await useAPI<{ data: RawLocationData[] }>('/api/logs/locations', {
    query: {
      startAt: realtimeStore.timeRange.startAt,
      endAt: realtimeStore.timeRange.endAt,
      ...realtimeStore.filters,
    },
  })

  locations.value = result.data?.map(e => ({
    lat: e.latitude,
    lng: e.longitude,
    count: +e.count,
  })) || []
}

function trafficEvent({ props }: TrafficEventParams, { delay = 2000 }: { delay?: number } = {}) {
  const projection = globe.getProjection()
  if (!projection)
    return

  const { item } = props
  if (item.latitude == null || item.longitude == null || !item.COLO) {
    console.warn('Missing location data for traffic event', item)
    return
  }

  const endLat = colos.value[item.COLO]?.lat
  const endLng = colos.value[item.COLO]?.lon

  if (endLat === undefined || endLng === undefined) {
    console.warn(`Missing COLO coordinates for ${item.COLO}`)
    return
  }

  // Skip if too close
  const isNear = Math.abs(endLat - item.latitude) < 5 && Math.abs(endLng - item.longitude) < 5
  if (isNear) {
    console.info(`from ${item.city} to ${item.COLO} is near, skip`)
    return
  }

  console.info(`from ${item.city}(${item.latitude}, ${item.longitude}) to ${item.COLO}(${endLat}, ${endLng})`)

  // Draw arc with light orange color
  globe.drawArc({
    startLat: item.latitude,
    startLng: item.longitude,
    endLat,
    endLng,
    color: arcColor.value,
  }, delay)

  // Draw start ripple (small)
  globe.drawRipple({
    lat: item.latitude,
    lng: item.longitude,
    maxRadius: 1.5,
    duration: delay * 0.6,
    color: arcColor.value,
  })

  // Draw end ripple after delay (larger) - track for cleanup
  const timeoutId = setTimeout(() => {
    pendingTimeouts.delete(timeoutId)
    globe.drawRipple({
      lat: endLat,
      lng: endLng,
      maxRadius: 3,
      duration: delay,
      color: arcColor.value,
    })
  }, delay)
  pendingTimeouts.add(timeoutId)
}

function updateCanvasSize() {
  const canvas = canvasRef.value
  if (!canvas)
    return

  const w = globeConfig.value.width
  const h = globeConfig.value.height
  const dpr = window.devicePixelRatio || 1

  // Only update if size actually changed
  if (canvasWidth === w && canvasHeight === h && canvasDpr === dpr)
    return

  canvasWidth = w
  canvasHeight = h
  canvasDpr = dpr

  canvas.width = w * dpr
  canvas.height = h * dpr
  canvas.style.width = `${w}px`
  canvas.style.height = `${h}px`
}

function render() {
  const canvas = canvasRef.value
  const projection = globe.getProjection()
  if (!canvas || !projection)
    return

  const w = globeConfig.value.width
  const h = globeConfig.value.height

  // Guard against zero size
  if (w < 2 || h < 2)
    return

  const ctx = canvas.getContext('2d')
  if (!ctx)
    return

  // Clear and set up transform
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.scale(canvasDpr, canvasDpr)

  const path = geoPath(projection, ctx)

  // Draw globe background (sphere)
  ctx.beginPath()
  path({ type: 'Sphere' })
  ctx.fillStyle = colors.value.globeFill
  ctx.fill()
  ctx.strokeStyle = colors.value.globeStroke
  ctx.lineWidth = 1.5
  ctx.stroke()

  // Draw graticule
  ctx.beginPath()
  path(graticule())
  ctx.strokeStyle = colors.value.graticuleStroke
  ctx.lineWidth = 0.5
  ctx.stroke()

  // Draw countries with dynamic colors based on visit data (using cached groups)
  if (countries.value.features.length > 0) {
    // Draw each group with single fillStyle
    countryGroups.value.forEach((features, fill) => {
      ctx.beginPath()
      features.forEach(feature => path(feature as GeoPermissibleObjects))
      ctx.fillStyle = fill
      ctx.fill()
    })

    // Draw all strokes in one pass
    ctx.beginPath()
    countries.value.features.forEach(feature => path(feature as GeoPermissibleObjects))
    ctx.strokeStyle = colors.value.countryStroke
    ctx.lineWidth = 0.3
    ctx.stroke()
  }

  // Draw heatmap points
  if (locations.value.length > 0) {
    // Pre-calculate globe center once per frame
    const center = projection.invert?.([w / 2, h / 2])
    const centerLat = center ? center[1] * Math.PI / 180 : 0
    const centerLng = center ? center[0] * Math.PI / 180 : 0
    const sinCenterLat = Math.sin(centerLat)
    const cosCenterLat = Math.cos(centerLat)

    locations.value.forEach((loc) => {
      const coords = projection([loc.lng, loc.lat])
      if (!coords)
        return

      // Check if point is on visible side of globe (optimized)
      if (center) {
        const pointLat = loc.lat * Math.PI / 180
        const pointLng = loc.lng * Math.PI / 180
        const distance = Math.acos(
          sinCenterLat * Math.sin(pointLat)
          + cosCenterLat * Math.cos(pointLat) * Math.cos(pointLng - centerLng),
        )
        if (distance > Math.PI / 2)
          return // Behind the globe
      }

      const [x, y] = coords
      const radius = Math.max(3, Math.min(12, Math.sqrt(loc.count) * 2))

      // Draw glow effect
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius * 2)
      const color = weightColor.value(loc.count)
      gradient.addColorStop(0, color)
      gradient.addColorStop(0.5, color.replace(')', ', 0.5)').replace('rgb', 'rgba'))
      gradient.addColorStop(1, 'transparent')

      ctx.beginPath()
      ctx.arc(x, y, radius * 2, 0, Math.PI * 2)
      ctx.fillStyle = gradient
      ctx.fill()

      // Draw solid center
      ctx.beginPath()
      ctx.arc(x, y, radius * 0.6, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
    })
  }
}

function startRenderLoop() {
  if (renderTimer)
    renderTimer.stop()

  renderTimer = timer(() => {
    globe.updateProjection()
    render()
  })
}

function stopRenderLoop() {
  if (renderTimer) {
    renderTimer.stop()
    renderTimer = null
  }
}

const debouncedResize = useDebounceFn(() => {
  updateCanvasSize()
  globe.updateProjection()
}, 100)

function stopRotation() {
  globe.stopAutoRotate()
}

watchDeep([() => realtimeStore.timeRange, () => realtimeStore.filters], () => {
  getLiveLocations()
  getCountryStats()
})

watch([width, height], debouncedResize)

onMounted(async () => {
  await Promise.all([
    getLiveLocations(),
    getCurrentLocation(),
    getGlobeJSON(),
    getColosJSON(),
    getCountryStats(),
  ])

  globe.init()
  updateCanvasSize()

  if (currentLocation.value.latitude && currentLocation.value.longitude) {
    globe.setPointOfView(currentLocation.value.latitude, currentLocation.value.longitude)
  }

  startRenderLoop()
  globe.startAutoRotate()

  globalTrafficEvent.on(trafficEvent)
})

onBeforeUnmount(() => {
  stopRenderLoop()
  globalTrafficEvent.off(trafficEvent)
  globe.destroy()

  // Clear all pending timeouts
  pendingTimeouts.forEach(id => clearTimeout(id))
  pendingTimeouts.clear()
})
</script>

<template>
  <div ref="containerRef" class="relative h-full w-full" @mousedown="stopRotation" @touchstart="stopRotation">
    <canvas ref="canvasRef" class="absolute inset-0" />
    <svg ref="svgRef" class="pointer-events-auto absolute inset-0" :width="width" :height="height || width" />
  </div>
</template>

<style>
.globe-arc {
  filter: drop-shadow(0 0 4px oklch(0.85 0.15 70));
}

.globe-ripple {
  filter: drop-shadow(0 0 3px oklch(0.85 0.15 70));
}
</style>
