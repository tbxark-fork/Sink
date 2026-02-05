/**
 * Globe WebWorker - Offloads heavy computations from main thread
 *
 * Responsibilities:
 * - Project location points using D3 orthographic projection
 * - Filter visible points (backface culling)
 * - Pre-compute colors and radii
 * - Output as TypedArray for zero-copy transfer
 */

import { color as d3Color } from 'd3-color'
import { geoOrthographic } from 'd3-geo'
import { scaleSequentialSqrt } from 'd3-scale'
import { interpolateYlOrRd } from 'd3-scale-chromatic'

// Reuse projection instance - avoid creating every message
const projection = geoOrthographic().clipAngle(90)

// Reuse color scale - only update domain when highest changes
let colorScale = scaleSequentialSqrt(interpolateYlOrRd).domain([0, 1])
let lastHighest = 0

// Pre-computed color cache: Map<count, [r, g, b]>
const colorCache = new Map<number, Float32Array>()
const MAX_COLOR_CACHE_SIZE = 1000

export interface WorkerInput {
  type: 'computeVisiblePoints'
  data: {
    locations: Array<{ lat: number, lng: number, count: number }>
    width: number
    height: number
    scale: number
    rotation: [number, number]
    radius: number
    highest: number
  }
}

export interface WorkerOutput {
  type: 'visiblePoints'
  buffer: ArrayBuffer
  count: number
}

/**
 * TypedArray layout per point (7 floats = 28 bytes):
 * [x, y, radius, r, g, b, count]
 *
 * Where r,g,b are normalized 0-1 values for the gradient center color
 */
const FLOATS_PER_POINT = 7

function computeVisiblePoints(input: WorkerInput['data']): WorkerOutput {
  const { locations, width, height, scale, rotation, radius, highest } = input

  // Update projection parameters
  projection
    .scale(radius * scale)
    .translate([width / 2, height / 2])
    .rotate(rotation)

  // Update color scale domain if highest changed
  if (highest !== lastHighest) {
    // Ensure domain is valid (avoid [0,0] which causes NaN)
    const domainMax = highest > 0 ? highest * 3 : 1
    colorScale = scaleSequentialSqrt(interpolateYlOrRd).domain([0, domainMax])
    lastHighest = highest
    // Clear cache when domain changes
    colorCache.clear()
  }

  // Pre-compute center for visibility check
  // For orthographic projection with rotation [lambda, phi]:
  // - The center of view is at longitude = -lambda, latitude = -phi
  // But we need to compare with point coordinates, so we work in radians
  const centerLng = -rotation[0] * Math.PI / 180
  const centerLat = -rotation[1] * Math.PI / 180
  const sinCenterLat = Math.sin(centerLat)
  const cosCenterLat = Math.cos(centerLat)

  // First pass: count visible points
  const visibleIndices: number[] = []

  for (let i = 0; i < locations.length; i++) {
    const loc = locations[i]!
    if (loc.count <= 0)
      continue

    // Visibility check using dot product (no acos needed)
    // A point is visible if it's on the front hemisphere
    const pointLat = loc.lat * Math.PI / 180
    const pointLng = loc.lng * Math.PI / 180

    // Great circle distance formula's cosine component
    // cos(c) = sin(lat1)*sin(lat2) + cos(lat1)*cos(lat2)*cos(lon2-lon1)
    const dot = sinCenterLat * Math.sin(pointLat)
      + cosCenterLat * Math.cos(pointLat) * Math.cos(pointLng - centerLng)

    // Point is visible if cos(angular distance) > 0 (angle < 90 degrees)
    if (dot > 0) {
      visibleIndices.push(i)
    }
  }

  // Allocate output buffer
  const buffer = new Float32Array(visibleIndices.length * FLOATS_PER_POINT)

  // Second pass: compute coordinates and colors for visible points
  for (let i = 0; i < visibleIndices.length; i++) {
    const idx = visibleIndices[i]!
    const loc = locations[idx]!
    const coords = projection([loc.lng, loc.lat])

    if (!coords || !Number.isFinite(coords[0]) || !Number.isFinite(coords[1])) {
      // Mark as invalid (will be skipped during rendering)
      buffer[i * FLOATS_PER_POINT] = Number.NaN
      continue
    }

    const offset = i * FLOATS_PER_POINT
    const pointRadius = Math.max(3, Math.min(12, Math.sqrt(loc.count) * 2))

    // Get or compute color
    let colorData = colorCache.get(loc.count)
    if (!colorData) {
      colorData = computeColor(loc.count)
      // Limit cache size
      if (colorCache.size < MAX_COLOR_CACHE_SIZE) {
        colorCache.set(loc.count, colorData)
      }
    }

    buffer[offset] = coords[0]! // x
    buffer[offset + 1] = coords[1]! // y
    buffer[offset + 2] = pointRadius // radius
    buffer[offset + 3] = colorData[0]! // r
    buffer[offset + 4] = colorData[1]! // g
    buffer[offset + 5] = colorData[2]! // b
    buffer[offset + 6] = loc.count // count (for debugging/sorting)
  }

  return {
    type: 'visiblePoints',
    buffer: buffer.buffer,
    count: visibleIndices.length,
  }
}

function computeColor(count: number): Float32Array {
  const colorStr = colorScale(count)
  const parsed = d3Color(colorStr)

  const result = new Float32Array(3)
  if (parsed) {
    const rgb = parsed.rgb()
    result[0] = rgb.r / 255
    result[1] = rgb.g / 255
    result[2] = rgb.b / 255
  }
  else {
    // Fallback color (orange)
    result[0] = 1
    result[1] = 0.78
    result[2] = 0.39
  }

  return result
}

// Worker message handler
globalThis.onmessage = (event: MessageEvent<WorkerInput>) => {
  const { type, data } = event.data

  if (type === 'computeVisiblePoints') {
    const result = computeVisiblePoints(data)

    // Transfer buffer ownership to main thread (zero-copy)
    globalThis.postMessage(result, [result.buffer])
  }
}
