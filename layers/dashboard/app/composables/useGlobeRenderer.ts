import type { GlobeConfig } from '#layers/dashboard/app/composables/useD3Globe'
import type { GeoPermissibleObjects, GeoProjection } from 'd3-geo'
import type { ComputedRef, Ref, ShallowRef } from 'vue'
import type { GeoJSONData, LocationData } from '@/types'
import { useColorMode } from '#imports'
import { color as d3Color } from 'd3-color'
import { geoGraticule, geoPath } from 'd3-geo'
import { scaleSequentialSqrt } from 'd3-scale'
import { interpolateYlOrRd } from 'd3-scale-chromatic'
import { computed } from 'vue'

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
  getRotation: () => [number, number]
  getScale: () => number
  getRadius: () => number
}

export function useGlobeRenderer(ctx: GlobeRendererContext) {
  // Canvas state
  let canvasWidth = 0
  let canvasHeight = 0
  let canvasDpr = 1
  let animationFrameId: number | null = null

  // Dirty flag for conditional rendering
  let isDirty = true

  // Graticule generator - reuse instance
  const graticule = geoGraticule()
  // Cache graticule GeoJSON - only regenerate when needed
  let cachedGraticuleGeoJSON: ReturnType<typeof graticule> | null = null

  // Path2D cache for static geometry
  let cachedSpherePath: Path2D | null = null
  let cachedGraticulePath: Path2D | null = null
  let cachedCountryPaths: Map<string, Path2D> | null = null
  let cachedCountryStrokePath: Path2D | null = null

  // Cache invalidation tracking
  let lastCacheRotation: [number, number] = [0, 0]
  let lastCacheScale = 0
  let lastCacheWidth = 0
  let lastCacheHeight = 0

  // Weight color scale for heatmap rendering
  const weightColor = computed(() => {
    // Ensure domain is valid (avoid [0,0] which causes NaN)
    const domainMax = ctx.highest.value > 0 ? ctx.highest.value * 3 : 1
    return scaleSequentialSqrt(interpolateYlOrRd).domain([0, domainMax])
  })

  // Cache country groups by color tier
  const countryGroups = computed(() => {
    const groups = new Map<string, GeoPermissibleObjects[]>()
    const max = ctx.maxCountryVisits.value
    const tiers = ctx.countryColorTiers.value

    for (const feature of ctx.countries.value.features) {
      const props = (feature as any).properties
      const countryCode = props?.ISO_A2 || props?.iso_a2 || ''
      const count = ctx.countryStats.value.get(countryCode) || 0

      let fill = tiers.noData
      if (count > 0) {
        const ratio = count / max
        if (ratio <= 0.33)
          fill = tiers.tier1
        else if (ratio <= 0.66)
          fill = tiers.tier2
        else
          fill = tiers.tier3
      }

      const group = groups.get(fill)
      if (group)
        group.push(feature as GeoPermissibleObjects)
      else
        groups.set(fill, [feature as GeoPermissibleObjects])
    }

    return groups
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

    // Invalidate caches on resize
    invalidatePathCache()
  }

  function invalidatePathCache() {
    cachedSpherePath = null
    cachedGraticulePath = null
    cachedCountryPaths = null
    cachedCountryStrokePath = null
    markDirty()
  }

  function shouldUpdateCache(): boolean {
    const rotation = ctx.getRotation()
    const scale = ctx.getScale()
    const w = ctx.config.value.width
    const h = ctx.config.value.height

    // Check if projection parameters changed significantly
    const rotationChanged = Math.abs(rotation[0] - lastCacheRotation[0]) > 0.01
      || Math.abs(rotation[1] - lastCacheRotation[1]) > 0.01
    const scaleChanged = Math.abs(scale - lastCacheScale) > 0.001
    const sizeChanged = w !== lastCacheWidth || h !== lastCacheHeight

    if (!rotationChanged && !scaleChanged && !sizeChanged)
      return false

    lastCacheRotation = [...rotation]
    lastCacheScale = scale
    lastCacheWidth = w
    lastCacheHeight = h
    return true
  }

  function buildPathCache(projection: GeoProjection) {
    // Initialize graticule GeoJSON once
    if (!cachedGraticuleGeoJSON) {
      cachedGraticuleGeoJSON = graticule()
    }

    // Create path generator (reused for building cache)
    const pathGen = geoPath(projection)

    // Build sphere path
    cachedSpherePath = new Path2D(pathGen({ type: 'Sphere' }) || '')

    // Build graticule path
    cachedGraticulePath = new Path2D(pathGen(cachedGraticuleGeoJSON) || '')

    // Build country paths grouped by fill color
    cachedCountryPaths = new Map()
    countryGroups.value.forEach((features, fill) => {
      const path = new Path2D()
      features.forEach((feature) => {
        const d = pathGen(feature)
        if (d)
          path.addPath(new Path2D(d))
      })
      cachedCountryPaths!.set(fill, path)
    })

    // Build country stroke path (all countries combined)
    cachedCountryStrokePath = new Path2D()
    ctx.countries.value.features.forEach((feature) => {
      const d = pathGen(feature as GeoPermissibleObjects)
      if (d)
        cachedCountryStrokePath!.addPath(new Path2D(d))
    })
  }

  function markDirty() {
    isDirty = true
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

    // Check if path cache needs update
    if (shouldUpdateCache() || !cachedSpherePath) {
      buildPathCache(projection)
    }

    // Clear and setup transform
    canvasCtx.setTransform(1, 0, 0, 1, 0, 0)
    canvasCtx.clearRect(0, 0, canvas.width, canvas.height)
    canvasCtx.scale(canvasDpr, canvasDpr)

    const currentColors = ctx.colors.value

    // Draw globe background (using cached Path2D)
    if (cachedSpherePath) {
      canvasCtx.fillStyle = currentColors.globeFill
      canvasCtx.fill(cachedSpherePath)
      canvasCtx.strokeStyle = currentColors.globeStroke
      canvasCtx.lineWidth = 1.5
      canvasCtx.stroke(cachedSpherePath)
    }

    // Draw graticule (using cached Path2D)
    if (cachedGraticulePath) {
      canvasCtx.strokeStyle = currentColors.graticuleStroke
      canvasCtx.lineWidth = 0.5
      canvasCtx.stroke(cachedGraticulePath)
    }

    // Draw countries (using cached Path2D)
    if (cachedCountryPaths && cachedCountryPaths.size > 0) {
      cachedCountryPaths.forEach((path, fill) => {
        canvasCtx.fillStyle = fill
        canvasCtx.fill(path)
      })

      if (cachedCountryStrokePath) {
        canvasCtx.strokeStyle = currentColors.countryStroke
        canvasCtx.lineWidth = 0.3
        canvasCtx.stroke(cachedCountryStrokePath)
      }
    }

    // Draw heatmap points
    if (ctx.locations.value.length > 0) {
      renderHeatmapPoints(canvasCtx, projection)
    }

    isDirty = false
  }

  function renderHeatmapPoints(
    canvasCtx: CanvasRenderingContext2D,
    projection: GeoProjection,
  ) {
    const degToRad = Math.PI / 180
    const rotation = ctx.getRotation()
    const centerLng = -rotation[0] * degToRad
    const centerLat = -rotation[1] * degToRad
    const sinCenterLat = Math.sin(centerLat)
    const cosCenterLat = Math.cos(centerLat)

    for (const loc of ctx.locations.value) {
      if (loc.count <= 0)
        continue

      const coords = projection([loc.lng, loc.lat])
      if (!coords || !Number.isFinite(coords[0]) || !Number.isFinite(coords[1]))
        continue

      // Visibility check using dot product
      const pointLat = loc.lat * degToRad
      const pointLng = loc.lng * degToRad
      const dot = sinCenterLat * Math.sin(pointLat)
        + cosCenterLat * Math.cos(pointLat) * Math.cos(pointLng - centerLng)

      if (dot <= 0)
        continue

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
    }
  }

  function startRenderLoop() {
    if (animationFrameId !== null)
      return

    function loop() {
      // Always render when in animation loop (rotation/drag updates projection)
      render()
      animationFrameId = requestAnimationFrame(loop)
    }

    animationFrameId = requestAnimationFrame(loop)
  }

  function stopRenderLoop() {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId)
      animationFrameId = null
    }
  }

  // Render once (for static updates)
  function renderOnce() {
    if (isDirty) {
      render()
    }
  }

  return {
    countryGroups,
    updateCanvasSize,
    render,
    renderOnce,
    startRenderLoop,
    stopRenderLoop,
    markDirty,
    invalidatePathCache,
  }
}
