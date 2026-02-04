import type { GlobeConfig } from '#layers/dashboard/app/composables/useD3Globe'
import type { GeoPermissibleObjects, GeoProjection } from 'd3-geo'
import type { ComputedRef, Ref, ShallowRef } from 'vue'
import type { GeoJSONData, LocationData } from '@/types'
import { color as d3Color } from 'd3-color'
import { geoGraticule, geoPath } from 'd3-geo'
import { scaleSequentialSqrt } from 'd3-scale'
import { interpolateYlOrRd } from 'd3-scale-chromatic'
import { timer } from 'd3-timer'

export interface GlobeColors {
  globeFill: string
  globeStroke: string
  graticuleFill: string
  graticuleStroke: string
  countryStroke: string
}

export interface CountryColorTiers {
  noData: string
  noDataStroke: string
  tier1: string
  tier2: string
  tier3: string
}

export function useGlobeColors() {
  const colorMode = useColorMode()
  const isDark = computed(() => colorMode.value === 'dark')

  const arcColor = computed(() =>
    isDark.value ? 'oklch(0.85 0.15 70)' : 'oklch(0.8 0.12 65)',
  )

  const colors = computed<GlobeColors>(() => ({
    globeFill: isDark.value ? 'oklch(0.274 0.006 286.033)' : 'oklch(0.967 0.001 286.375)',
    globeStroke: isDark.value ? 'oklch(0.4 0.01 286 / 25%)' : 'oklch(0.8 0.005 286 / 20%)',
    graticuleFill: 'none',
    graticuleStroke: isDark.value ? 'oklch(0.35 0.01 286 / 30%)' : 'oklch(0.8 0.005 286 / 40%)',
    countryStroke: isDark.value ? 'oklch(0.5 0.005 286 / 30%)' : 'oklch(0.85 0.002 286 / 20%)',
  }))

  const countryColorTiers = computed<CountryColorTiers>(() => ({
    noData: isDark.value ? 'oklch(0.4 0.005 286)' : 'oklch(0.9 0.002 286)',
    noDataStroke: isDark.value ? 'oklch(0.5 0.005 286)' : 'oklch(0.85 0.002 286)',
    tier1: isDark.value ? 'oklch(0.723 0.219 149.579 / 35%)' : 'oklch(0.723 0.219 149.579 / 30%)',
    tier2: isDark.value ? 'oklch(0.723 0.219 149.579 / 55%)' : 'oklch(0.723 0.219 149.579 / 50%)',
    tier3: isDark.value ? 'oklch(0.723 0.219 149.579 / 75%)' : 'oklch(0.723 0.219 149.579 / 70%)',
  }))

  return {
    isDark,
    arcColor,
    colors,
    countryColorTiers,
  }
}

export interface GlobeRendererContext {
  canvasRef: Ref<HTMLCanvasElement | null>
  config: ComputedRef<GlobeConfig>
  countries: ShallowRef<GeoJSONData>
  locations: ShallowRef<LocationData[]>
  countryStats: ShallowRef<Map<string, number>>
  maxCountryVisits: ComputedRef<number>
  highest: ComputedRef<number>
  colors: ComputedRef<GlobeColors>
  countryColorTiers: ComputedRef<CountryColorTiers>
  getProjection: () => GeoProjection | null
  updateProjection: () => void
}

export function useGlobeRenderer(ctx: GlobeRendererContext) {
  // Canvas state
  let canvasWidth = 0
  let canvasHeight = 0
  let canvasDpr = 1
  let renderTimer: ReturnType<typeof timer> | null = null

  // Graticule generator - reuse instance
  const graticule = geoGraticule()

  // Cache country groups by color tier
  const countryGroups = computed(() => {
    const groups = new Map<string, GeoPermissibleObjects[]>()
    const max = ctx.maxCountryVisits.value
    const tiers = ctx.countryColorTiers.value

    for (const feature of ctx.countries.value.features) {
      const props = (feature as any).properties
      const countryCode = props?.ISO_A2 || props?.iso_a2 || ''
      const count = ctx.countryStats.value.get(countryCode) || 0

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
        group.push(feature as GeoPermissibleObjects)
      }
      else {
        groups.set(fill, [feature as GeoPermissibleObjects])
      }
    }

    return groups
  })

  // Weight color scale
  const weightColor = computed(() => {
    const domainMax = ctx.highest.value * 3
    return scaleSequentialSqrt(interpolateYlOrRd).domain([0, domainMax])
  })

  function updateCanvasSize() {
    const canvas = ctx.canvasRef.value
    if (!canvas)
      return

    const w = ctx.config.value.width
    const h = ctx.config.value.height
    const dpr = window.devicePixelRatio || 1

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
    const canvas = ctx.canvasRef.value
    const projection = ctx.getProjection()
    if (!canvas || !projection)
      return

    const w = ctx.config.value.width
    const h = ctx.config.value.height

    if (w < 2 || h < 2)
      return

    const canvasCtx = canvas.getContext('2d')
    if (!canvasCtx)
      return

    canvasCtx.setTransform(1, 0, 0, 1, 0, 0)
    canvasCtx.clearRect(0, 0, canvas.width, canvas.height)
    canvasCtx.scale(canvasDpr, canvasDpr)

    const path = geoPath(projection, canvasCtx)
    const currentColors = ctx.colors.value

    // Draw globe background
    canvasCtx.beginPath()
    path({ type: 'Sphere' })
    canvasCtx.fillStyle = currentColors.globeFill
    canvasCtx.fill()
    canvasCtx.strokeStyle = currentColors.globeStroke
    canvasCtx.lineWidth = 1.5
    canvasCtx.stroke()

    // Draw graticule
    canvasCtx.beginPath()
    path(graticule())
    canvasCtx.strokeStyle = currentColors.graticuleStroke
    canvasCtx.lineWidth = 0.5
    canvasCtx.stroke()

    // Draw countries
    if (ctx.countries.value.features.length > 0) {
      countryGroups.value.forEach((features, fill) => {
        canvasCtx.beginPath()
        features.forEach(feature => path(feature))
        canvasCtx.fillStyle = fill
        canvasCtx.fill()
      })

      canvasCtx.beginPath()
      ctx.countries.value.features.forEach(feature => path(feature as GeoPermissibleObjects))
      canvasCtx.strokeStyle = currentColors.countryStroke
      canvasCtx.lineWidth = 0.3
      canvasCtx.stroke()
    }

    // Draw heatmap points
    if (ctx.locations.value.length > 0) {
      renderHeatmapPoints(canvasCtx, projection, w, h)
    }
  }

  function renderHeatmapPoints(
    canvasCtx: CanvasRenderingContext2D,
    projection: GeoProjection,
    w: number,
    h: number,
  ) {
    const center = projection.invert?.([w / 2, h / 2])
    const centerLat = center ? center[1] * Math.PI / 180 : 0
    const centerLng = center ? center[0] * Math.PI / 180 : 0
    const sinCenterLat = Math.sin(centerLat)
    const cosCenterLat = Math.cos(centerLat)

    ctx.locations.value.forEach((loc) => {
      // Skip points with no count
      if (loc.count <= 0)
        return

      const coords = projection([loc.lng, loc.lat])
      if (!coords || !Number.isFinite(coords[0]) || !Number.isFinite(coords[1]))
        return

      // Check visibility
      if (center) {
        const pointLat = loc.lat * Math.PI / 180
        const pointLng = loc.lng * Math.PI / 180
        const dot = sinCenterLat * Math.sin(pointLat)
          + cosCenterLat * Math.cos(pointLat) * Math.cos(pointLng - centerLng)
        const distance = Math.acos(Math.min(1, Math.max(-1, dot)))
        if (distance > Math.PI / 2)
          return
      }

      const [x, y] = coords
      const radius = Math.max(3, Math.min(12, Math.sqrt(loc.count) * 2))

      // Draw glow effect
      const gradient = canvasCtx.createRadialGradient(x, y, 0, x, y, radius * 2)
      const color = weightColor.value(loc.count)
      const colorWithAlpha = d3Color(color)
      gradient.addColorStop(0, color)
      if (colorWithAlpha) {
        colorWithAlpha.opacity = 0.5
        gradient.addColorStop(0.5, colorWithAlpha.formatRgb())
      }
      else {
        gradient.addColorStop(0.5, 'rgba(255, 200, 100, 0.5)')
      }
      gradient.addColorStop(1, 'transparent')

      canvasCtx.beginPath()
      canvasCtx.arc(x, y, radius * 2, 0, Math.PI * 2)
      canvasCtx.fillStyle = gradient
      canvasCtx.fill()

      // Draw solid center
      canvasCtx.beginPath()
      canvasCtx.arc(x, y, radius * 0.6, 0, Math.PI * 2)
      canvasCtx.fillStyle = color
      canvasCtx.fill()
    })
  }

  function startRenderLoop() {
    if (renderTimer)
      renderTimer.stop()

    // Only render - projection updates are handled by useD3Globe (drag/zoom/autoRotate)
    renderTimer = timer(() => {
      render()
    })
  }

  function stopRenderLoop() {
    if (renderTimer) {
      renderTimer.stop()
      renderTimer = null
    }
  }

  return {
    countryGroups,
    weightColor,
    updateCanvasSize,
    render,
    startRenderLoop,
    stopRenderLoop,
  }
}
