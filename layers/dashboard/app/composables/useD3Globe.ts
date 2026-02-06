import type { D3DragEvent } from 'd3-drag'
import type { GeoPath, GeoPermissibleObjects, GeoProjection } from 'd3-geo'
import type { Timer } from 'd3-timer'
import type { Ref } from 'vue'
import { drag } from 'd3-drag'
import { easeCubicOut } from 'd3-ease'
import { geoCircle, geoInterpolate, geoOrthographic, geoPath } from 'd3-geo'
import { select } from 'd3-selection'
import { timer } from 'd3-timer'
import { zoom, zoomIdentity } from 'd3-zoom'
import { computed, ref } from 'vue'
import 'd3-transition'

export interface GlobeConfig {
  width: number
  height: number
  sensitivity?: number
  autoRotateSpeed?: number
  initialRotation?: [number, number]
  minScale?: number
  maxScale?: number
  inertia?: number
  friction?: number
}

export interface ArcData {
  startLat: number
  startLng: number
  endLat: number
  endLng: number
  color?: string
}

export interface RippleData {
  lat: number
  lng: number
  maxRadius?: number
  duration?: number
  color?: string
}

// Arc state with index-based rendering (reduced slice allocation)
interface ArcState {
  timer: Timer
  element: any
  points: [number, number][]
  pointIndex: number // Current end index (avoids slice)
  numPoints: number
}

// Ripple state
interface RippleState {
  timer: Timer
  element: any
  center: [number, number]
  currentRadius: number
  circleGenerator: ReturnType<typeof geoCircle> // Reuse generator
}

export function useD3Globe(
  svgRef: Ref<SVGSVGElement | null>,
  config: Ref<GlobeConfig>,
) {
  const sensitivity = computed(() => config.value.sensitivity ?? 75)
  const autoRotateSpeed = computed(() => config.value.autoRotateSpeed ?? 0.3)
  const minScale = computed(() => config.value.minScale ?? 0.5)
  const maxScale = computed(() => config.value.maxScale ?? 8)
  const inertia = computed(() => config.value.inertia ?? 0.9)
  const friction = computed(() => config.value.friction ?? 0.95)

  const clampLatitude = (value: number) => Math.max(-90, Math.min(90, value))

  // Projection state
  const rotation = ref<[number, number]>(config.value.initialRotation ?? [0, -20])
  const scale = ref(1)
  const isAutoRotating = ref(true)
  const isInertiaActive = ref(false)
  const isInteracting = ref(false)

  // Reactive animation counter (Map.size is not reactive)
  const activeAnimationCount = ref(0)

  // Velocity for inertia
  let velocityX = 0
  let velocityY = 0
  let inertiaTimer: Timer | null = null

  // Internal state
  let projection: GeoProjection | null = null
  let pathGenerator: GeoPath<any, GeoPermissibleObjects> | null = null
  let rotationTimer: Timer | null = null

  // Optimized: use index-based arc state to reduce slice() allocations
  const activeArcs = new Map<symbol, ArcState>()
  // Optimized: reuse geoCircle generator per ripple
  const activeRipples = new Map<symbol, RippleState>()

  // Reusable GeoJSON object for arc rendering (avoids allocation per frame)
  const reusableLineString: GeoJSON.LineString = {
    type: 'LineString',
    coordinates: [],
  }

  // Computed radius based on container size
  const radius = computed(() => Math.min(config.value.width, config.value.height) / 2.2)

  // Initialize projection
  function initProjection() {
    projection = geoOrthographic()
      .scale(radius.value * scale.value)
      .translate([config.value.width / 2, config.value.height / 2])
      .clipAngle(90)
      .rotate(rotation.value)

    pathGenerator = geoPath(projection)
  }

  function updateProjection() {
    if (!projection)
      return

    projection
      .scale(radius.value * scale.value)
      .translate([config.value.width / 2, config.value.height / 2])
      .rotate(rotation.value)

    if (!pathGenerator)
      return

    const currentPathGenerator = pathGenerator

    // Update active arcs to follow globe rotation (using index; slice only for drawing)
    activeArcs.forEach(({ element, points, pointIndex }) => {
      if (pointIndex >= 2) {
        // Reuse LineString object, just update coordinates reference
        reusableLineString.coordinates = points.slice(0, pointIndex)
        element.attr('d', currentPathGenerator(reusableLineString))
      }
    })

    // Update active ripples to follow globe rotation (reusing circleGenerator)
    activeRipples.forEach(({ element, circleGenerator, currentRadius }) => {
      circleGenerator.radius(currentRadius)
      element.attr('d', currentPathGenerator(circleGenerator()))
    })
  }

  function setRotation(lambda: number, phi: number) {
    rotation.value = [lambda, clampLatitude(phi)]
    updateProjection()
  }

  // Setup drag behavior with inertia
  function setupDrag() {
    if (!svgRef.value)
      return

    const dragBehavior = drag<SVGSVGElement, unknown>()
      .on('start', () => {
        isInteracting.value = true
        stopAutoRotate()
        stopInertia()
        velocityX = 0
        velocityY = 0
      })
      .on('drag', (event: D3DragEvent<SVGSVGElement, unknown, unknown>) => {
        if (!projection)
          return

        const k = sensitivity.value / projection.scale()
        const [lambda, phi] = rotation.value

        // Calculate velocity for inertia
        velocityX = event.dx * k * inertia.value
        velocityY = -event.dy * k * inertia.value

        setRotation(
          lambda + event.dx * k,
          phi - event.dy * k,
        )
      })
      .on('end', () => {
        // Start inertia animation
        startInertia()
        isInteracting.value = false
      })

    select(svgRef.value).call(dragBehavior as any)
  }

  // Inertia animation
  function startInertia() {
    if (inertiaTimer)
      inertiaTimer.stop()

    isInertiaActive.value = true
    inertiaTimer = timer(() => {
      // Apply friction
      velocityX *= friction.value
      velocityY *= friction.value

      // Stop when velocity is very small
      if (Math.abs(velocityX) < 0.01 && Math.abs(velocityY) < 0.01) {
        stopInertia()
        return
      }

      const [lambda, phi] = rotation.value
      setRotation(
        lambda + velocityX,
        phi + velocityY,
      )
    })
  }

  function stopInertia() {
    isInertiaActive.value = false
    if (inertiaTimer) {
      inertiaTimer.stop()
      inertiaTimer = null
    }
  }

  // Setup zoom behavior
  function setupZoom() {
    if (!svgRef.value)
      return

    const zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([minScale.value, maxScale.value])
      .on('start', () => {
        isInteracting.value = true
        stopAutoRotate()
        stopInertia()
      })
      .on('zoom', (event) => {
        scale.value = event.transform.k
        updateProjection()
      })
      .on('end', () => {
        isInteracting.value = false
      })

    select(svgRef.value)
      .call(zoomBehavior as any)
      .call(zoomBehavior.transform as any, zoomIdentity)
  }

  // Auto rotation (stops after one full revolution)
  function startAutoRotate() {
    if (rotationTimer)
      rotationTimer.stop()
    isAutoRotating.value = true

    let totalRotation = 0
    const fullRevolution = 360

    rotationTimer = timer(() => {
      if (!isAutoRotating.value)
        return

      const [lambda, phi] = rotation.value
      setRotation(lambda - autoRotateSpeed.value, phi)
      totalRotation += autoRotateSpeed.value

      // Stop after one full revolution
      if (totalRotation >= fullRevolution) {
        stopAutoRotate()
      }
    })
  }

  function stopAutoRotate() {
    isAutoRotating.value = false
    if (rotationTimer) {
      rotationTimer.stop()
      rotationTimer = null
    }
  }

  // Set point of view (rotate to specific location)
  function setPointOfView(lat: number, lng: number) {
    rotation.value = [-lng, -lat]
    updateProjection()
  }

  // Draw arc animation between two points
  function drawArc(arcData: ArcData, duration = 2000): symbol {
    if (!svgRef.value || !pathGenerator)
      return Symbol('empty-arc')

    const id = Symbol('arc')
    const svg = select(svgRef.value)
    const start: [number, number] = [arcData.startLng, arcData.startLat]
    const end: [number, number] = [arcData.endLng, arcData.endLat]
    const interpolator = geoInterpolate(start, end)

    // Pre-generate arc points for caching
    const numPoints = 50
    const arcPoints: [number, number][] = []
    for (let i = 0; i <= numPoints; i++) {
      arcPoints.push(interpolator(i / numPoints))
    }

    const arcPath = svg.append('path')
      .attr('class', 'globe-arc')
      .attr('fill', 'none')
      .attr('stroke', arcData.color ?? 'var(--chart-2)')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '6,4')
      .attr('stroke-linecap', 'round')
      .attr('opacity', 0.9)

    // Store arc data for projection updates (using pointIndex instead of progress)
    const arcState: ArcState = {
      timer: null as unknown as Timer,
      element: arcPath,
      points: arcPoints,
      pointIndex: 0,
      numPoints,
    }

    let startTime: number | null = null

    const arcTimer = timer((elapsed) => {
      if (startTime === null)
        startTime = elapsed

      const rawProgress = Math.min((elapsed - startTime) / duration, 1)
      const easedProgress = easeCubicOut(rawProgress)

      // Update stored pointIndex for projection updates (reduces slice work)
      const pointIndex = Math.floor(easedProgress * numPoints) + 1
      arcState.pointIndex = pointIndex

      if (pointIndex >= 2) {
        // Reuse LineString, update coordinates by slicing only here during animation
        reusableLineString.coordinates = arcPoints.slice(0, pointIndex)
        arcPath.attr('d', pathGenerator!(reusableLineString))
      }

      if (rawProgress >= 1) {
        // Fade out - delay removal from activeArcs until transition ends
        arcPath.transition()
          .duration(500)
          .attr('opacity', 0)
          .on('end', () => {
            arcPath.remove()
            activeArcs.delete(id)
            activeAnimationCount.value--
          })

        arcTimer.stop()
      }
    })

    arcState.timer = arcTimer
    activeArcs.set(id, arcState)
    activeAnimationCount.value++
    return id
  }

  // Draw ripple animation at a point
  function drawRipple(rippleData: RippleData): symbol {
    if (!svgRef.value || !pathGenerator)
      return Symbol('empty-ripple')

    const id = Symbol('ripple')
    const svg = select(svgRef.value)
    const center: [number, number] = [rippleData.lng, rippleData.lat]
    const maxRadius = rippleData.maxRadius ?? 5
    const duration = rippleData.duration ?? 1500

    // Create and reuse circleGenerator for this ripple
    const circleGenerator = geoCircle().center(center)

    const ripplePath = svg.append('path')
      .attr('class', 'globe-ripple')
      .attr('stroke', rippleData.color ?? 'var(--chart-2)')
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.8)
      .attr('fill', rippleData.color ?? 'var(--chart-2)')
      .attr('fill-opacity', 0.15)

    // Store ripple data for projection updates (include circleGenerator for reuse)
    const rippleState: RippleState = {
      timer: null as unknown as Timer,
      element: ripplePath,
      center,
      currentRadius: 0,
      circleGenerator,
    }

    let startTime: number | null = null

    const rippleTimer = timer((elapsed) => {
      if (startTime === null)
        startTime = elapsed

      const rawProgress = Math.min((elapsed - startTime) / duration, 1)

      // Use easing for smooth animations
      const easedRadiusProgress = easeCubicOut(rawProgress)

      const currentRadius = easedRadiusProgress * maxRadius
      // Update stored radius for projection updates
      rippleState.currentRadius = currentRadius

      // Use radius progress for opacity - outer circles are lighter
      const strokeOpacity = 0.6 * (1 - easedRadiusProgress) ** 2
      const fillOpacity = 0.15 * (1 - easedRadiusProgress)

      ripplePath
        .attr('d', pathGenerator!(circleGenerator.radius(currentRadius)()))
        .attr('stroke-opacity', strokeOpacity)
        .attr('fill-opacity', fillOpacity)

      if (rawProgress >= 1) {
        ripplePath.remove()
        rippleTimer.stop()
        activeRipples.delete(id)
        activeAnimationCount.value--
      }
    })

    rippleState.timer = rippleTimer
    activeRipples.set(id, rippleState)
    activeAnimationCount.value++
    return id
  }

  // Get current projection for external use
  function getProjection() {
    return projection
  }

  // Cleanup D3 event bindings and SVG elements
  function cleanup() {
    if (svgRef.value) {
      const svg = select(svgRef.value)
      // Remove drag and zoom events
      svg.on('.drag', null).on('.zoom', null)
      // Remove any remaining arc/ripple elements
      svg.selectAll('.globe-arc, .globe-ripple').remove()
    }
  }

  // Cleanup
  function destroy() {
    stopAutoRotate()
    stopInertia()
    cleanup()
    activeArcs.forEach(arc => arc.timer.stop())
    activeRipples.forEach(ripple => ripple.timer.stop())
    activeArcs.clear()
    activeRipples.clear()
    activeAnimationCount.value = 0
  }

  // Initialize
  function init() {
    initProjection()
    setupDrag()
    setupZoom()
  }

  // Check if there are active animations (using reactive counter)
  const hasActiveAnimations = computed(() => activeAnimationCount.value > 0)

  return {
    // State
    rotation,
    scale,
    radius,
    isAutoRotating,
    isInertiaActive,
    isInteracting,
    hasActiveAnimations,

    // Getters for renderer integration
    getRotation: () => rotation.value,
    getScale: () => scale.value,
    getRadius: () => radius.value,

    // Methods
    init,
    updateProjection,
    setPointOfView,
    startAutoRotate,
    stopAutoRotate,
    drawArc,
    drawRipple,
    getProjection,
    destroy,
  }
}
