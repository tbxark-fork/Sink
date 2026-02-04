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

  // Projection state
  const rotation = ref<[number, number]>(config.value.initialRotation ?? [0, -20])
  const scale = ref(1)
  const isAutoRotating = ref(true)

  // Velocity for inertia
  let velocityX = 0
  let velocityY = 0
  let inertiaTimer: Timer | null = null

  // Internal state
  let projection: GeoProjection | null = null
  let pathGenerator: GeoPath<any, GeoPermissibleObjects> | null = null
  let rotationTimer: Timer | null = null
  const activeArcs = new Map<symbol, { timer: Timer, element: any, points: [number, number][], progress: number }>()
  const activeRipples = new Map<symbol, { timer: Timer, element: any, center: [number, number], currentRadius: number }>()

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

  // Update projection when config changes
  function updateProjection() {
    if (!projection)
      return

    projection
      .scale(radius.value * scale.value)
      .translate([config.value.width / 2, config.value.height / 2])
      .rotate(rotation.value)

    // Update active arcs to follow globe rotation
    if (pathGenerator) {
      activeArcs.forEach(({ element, points, progress }) => {
        const pointIndex = Math.floor(progress * (points.length - 1))
        const currentPoints = points.slice(0, pointIndex + 1)
        if (currentPoints.length >= 2) {
          const line: GeoJSON.LineString = {
            type: 'LineString',
            coordinates: currentPoints,
          }
          element.attr('d', pathGenerator!(line))
        }
      })

      // Update active ripples to follow globe rotation
      const circleGenerator = geoCircle()
      activeRipples.forEach(({ element, center, currentRadius }) => {
        circleGenerator.center(center).radius(currentRadius)
        element.attr('d', pathGenerator!(circleGenerator()))
      })
    }
  }

  // Setup drag behavior with inertia
  function setupDrag() {
    if (!svgRef.value)
      return

    const dragBehavior = drag<SVGSVGElement, unknown>()
      .on('start', () => {
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

        rotation.value = [
          lambda + event.dx * k,
          Math.max(-90, Math.min(90, phi - event.dy * k)),
        ]
        updateProjection()
      })
      .on('end', () => {
        // Start inertia animation
        startInertia()
      })

    select(svgRef.value).call(dragBehavior as any)
  }

  // Inertia animation
  function startInertia() {
    if (inertiaTimer)
      inertiaTimer.stop()

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
      rotation.value = [
        lambda + velocityX,
        Math.max(-90, Math.min(90, phi + velocityY)),
      ]
      updateProjection()
    })
  }

  function stopInertia() {
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
      .on('zoom', (event) => {
        scale.value = event.transform.k
        updateProjection()
      })

    select(svgRef.value)
      .call(zoomBehavior as any)
      .call(zoomBehavior.transform as any, zoomIdentity)
  }

  // Auto rotation
  function startAutoRotate() {
    if (rotationTimer)
      rotationTimer.stop()
    isAutoRotating.value = true

    rotationTimer = timer(() => {
      if (!isAutoRotating.value)
        return

      const [lambda, phi] = rotation.value
      rotation.value = [lambda - autoRotateSpeed.value, phi]
      updateProjection()
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

    // Store arc data for projection updates
    const arcState = { timer: null as unknown as Timer, element: arcPath, points: arcPoints, progress: 0 }

    let startTime: number | null = null

    const arcTimer = timer((elapsed) => {
      if (startTime === null)
        startTime = elapsed

      const rawProgress = Math.min((elapsed - startTime) / duration, 1)
      const easedProgress = easeCubicOut(rawProgress)

      // Update stored progress for projection updates
      arcState.progress = easedProgress

      // Use cached arc points based on eased progress
      const pointIndex = Math.floor(easedProgress * numPoints)
      const currentPoints = arcPoints.slice(0, pointIndex + 1)

      if (currentPoints.length >= 2) {
        const line: GeoJSON.LineString = {
          type: 'LineString',
          coordinates: currentPoints,
        }
        arcPath.attr('d', pathGenerator!(line))
      }

      if (rawProgress >= 1) {
        // Fade out - delay removal from activeArcs until transition ends
        arcPath.transition()
          .duration(500)
          .attr('opacity', 0)
          .on('end', () => {
            arcPath.remove()
            activeArcs.delete(id)
          })

        arcTimer.stop()
      }
    })

    arcState.timer = arcTimer
    activeArcs.set(id, arcState)
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

    const circleGenerator = geoCircle().center(center)

    const ripplePath = svg.append('path')
      .attr('class', 'globe-ripple')
      .attr('stroke', rippleData.color ?? 'var(--chart-2)')
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.8)
      .attr('fill', rippleData.color ?? 'var(--chart-2)')
      .attr('fill-opacity', 0.15)

    // Store ripple data for projection updates
    const rippleState = { timer: null as unknown as Timer, element: ripplePath, center, currentRadius: 0 }

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
      }
    })

    rippleState.timer = rippleTimer
    activeRipples.set(id, rippleState)
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
  }

  // Initialize
  function init() {
    initProjection()
    setupDrag()
    setupZoom()
  }

  return {
    // State
    rotation,
    scale,
    radius,
    isAutoRotating,

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
