import type { ComputedRef, Ref, ShallowRef } from 'vue'
import type { CountryColorTiers, GlobeColors, HeatmapColorTiers } from './useGlobeColors'
import type { GeoJSONData, LocationData } from '@/types'
import { geoDistance, geoInterpolate } from 'd3-geo'
import { scaleThreshold } from 'd3-scale'
import * as twgl from 'twgl.js'
import { ref, shallowRef } from 'vue'

const m4 = twgl.m4

// ============================================================================
// Types
// ============================================================================

export interface WebGLGlobeContext {
  canvasRef: Ref<HTMLCanvasElement | null>
  width: Ref<number>
  height: Ref<number>
  countries: ShallowRef<GeoJSONData>
  locations: ShallowRef<LocationData[]>
  countryStats: ShallowRef<Map<string, number>>
  maxCountryVisits: ComputedRef<number>
  highest: ComputedRef<number>
  colors: ComputedRef<GlobeColors>
  countryColorTiers: ComputedRef<CountryColorTiers>
  heatmapColorTiers: ComputedRef<HeatmapColorTiers>
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

// ============================================================================
// Shaders
// ============================================================================

const earthVertexShader = /* glsl */ `
  attribute vec3 position;
  attribute vec2 texcoord;

  uniform mat4 model;
  uniform mat4 view;
  uniform mat4 projection;

  varying vec2 vUv;

  void main() {
    vUv = texcoord;
    gl_Position = projection * view * model * vec4(position, 1.0);
  }
`

const earthFragmentShader = /* glsl */ `
  precision mediump float;

  uniform sampler2D u_countryTexture;

  varying vec2 vUv;

  void main() {
    gl_FragColor = vec4(texture2D(u_countryTexture, vUv).rgb, 1.0);
  }
`

const arcVertexShader = /* glsl */ `
  attribute vec3 position;
  attribute float alpha;

  uniform mat4 model;
  uniform mat4 view;
  uniform mat4 projection;

  varying float vAlpha;

  void main() {
    gl_Position = projection * view * model * vec4(position, 1.0);
    vAlpha = alpha;
  }
`

const arcFragmentShader = /* glsl */ `
  precision mediump float;

  uniform vec3 u_color;
  uniform float u_fade;

  varying float vAlpha;

  void main() {
    float a = min(vAlpha * u_fade * 2.5, 1.0);
    gl_FragColor = vec4(u_color * a, a);
  }
`

const rippleVertexShader = /* glsl */ `
  attribute vec3 position;

  uniform mat4 model;
  uniform mat4 view;
  uniform mat4 projection;
  uniform float u_pointSize;

  varying vec3 vWorldPos;

  void main() {
    vec4 worldPos = model * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projection * view * worldPos;
    gl_PointSize = u_pointSize;
  }
`

const rippleFragmentShader = /* glsl */ `
  precision mediump float;

  uniform vec3 u_color;
  uniform vec3 u_eye;
  uniform float u_alpha;
  uniform float u_ringWidth;

  varying vec3 vWorldPos;

  void main() {
    vec3 toEye = normalize(u_eye - vWorldPos);
    vec3 normal = normalize(vWorldPos);
    if (dot(toEye, normal) < 0.0) discard;

    float dist = length(gl_PointCoord - vec2(0.5));
    if (dist > 0.5) discard;

    // Ring shape
    float inner = 0.5 - u_ringWidth;
    float ring = smoothstep(inner - 0.05, inner, dist) * (1.0 - smoothstep(0.45, 0.5, dist));
    float a = ring * u_alpha;
    if (a < 0.01) discard;

    gl_FragColor = vec4(u_color * a, a);
  }
`

// ============================================================================
// Geometry: Octahedron Sphere (from globe-viewer)
// ============================================================================

function createOctahedronSphere(divisions: number) {
  // Initial octahedron triangles
  const initialPoints: number[] = [
    0,
    1,
    0,
    0,
    0,
    -1,
    -1,
    0,
    0,
    0,
    1,
    0,
    -1,
    0,
    0,
    0,
    0,
    1,
    0,
    1,
    0,
    0,
    0,
    1,
    1,
    0,
    0,
    0,
    1,
    0,
    1,
    0,
    0,
    0,
    0,
    -1,
    0,
    -1,
    0,
    -1,
    0,
    0,
    0,
    0,
    -1,
    0,
    -1,
    0,
    0,
    0,
    1,
    -1,
    0,
    0,
    0,
    -1,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
    0,
    -1,
    0,
    0,
    0,
    -1,
    1,
    0,
    0,
  ]

  let points = new Float32Array(initialPoints)

  // Subdivide
  for (let i = 0; i < divisions; i++) {
    const newPoints = new Float32Array(points.length * 4)
    let offset = 0

    for (let j = 0; j < points.length; j += 9) {
      const a: [number, number, number] = [points[j]!, points[j + 1]!, points[j + 2]!]
      const b: [number, number, number] = [points[j + 3]!, points[j + 4]!, points[j + 5]!]
      const c: [number, number, number] = [points[j + 6]!, points[j + 7]!, points[j + 8]!]

      const ab = normalize([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2])
      const bc = normalize([(b[0] + c[0]) / 2, (b[1] + c[1]) / 2, (b[2] + c[2]) / 2])
      const ca = normalize([(c[0] + a[0]) / 2, (c[1] + a[1]) / 2, (c[2] + a[2]) / 2])

      // 4 new triangles
      newPoints.set([...a, ...ab, ...ca], offset)
      offset += 9
      newPoints.set([...ab, ...bc, ...ca], offset)
      offset += 9
      newPoints.set([...ab, ...b, ...bc], offset)
      offset += 9
      newPoints.set([...ca, ...bc, ...c], offset)
      offset += 9
    }

    points = newPoints
  }

  // Build indexed mesh (triangle-at-a-time for proper seam/pole handling)
  const vertexMap = new Map<string, number>()
  const positions: number[] = []
  const texcoords: number[] = []
  const indices: number[] = []

  for (let tri = 0; tri < points.length; tri += 9) {
    const triVerts: [number, number, number][] = []
    const triUVs: [number, number][] = []

    for (let v = 0; v < 3; v++) {
      const p: [number, number, number] = [
        points[tri + v * 3]!,
        points[tri + v * 3 + 1]!,
        points[tri + v * 3 + 2]!,
      ]
      triVerts.push(p)
      triUVs.push(uvFromPoint(p))
    }

    // Fix poles: at poles atan2 is undefined, use average u from other verts
    for (let v = 0; v < 3; v++) {
      if (Math.abs(triVerts[v]![1]) > 0.999) {
        const otherUs = triUVs.filter((_, i) => i !== v).map(uv => uv[0])
        triUVs[v]![0] = (otherUs[0]! + otherUs[1]!) / 2
      }
    }

    // Fix seam: if triangle spans the dateline (u range > 0.5), wrap low values
    const us = triUVs.map(uv => uv[0])
    const maxU = Math.max(...us)
    const minU = Math.min(...us)
    if (maxU - minU > 0.5) {
      for (const uv of triUVs) {
        if (uv[0] < 0.25)
          uv[0] += 1.0
      }
    }

    for (let v = 0; v < 3; v++) {
      const p = triVerts[v]!
      const uv = triUVs[v]!
      const key = `${p[0].toFixed(6)},${p[1].toFixed(6)},${p[2].toFixed(6)},${uv[0].toFixed(6)},${uv[1].toFixed(6)}`

      let index = vertexMap.get(key)
      if (index === undefined) {
        index = positions.length / 3
        vertexMap.set(key, index)
        positions.push(...p)
        texcoords.push(...uv)
      }
      indices.push(index)
    }
  }

  return {
    position: new Float32Array(positions),
    texcoord: new Float32Array(texcoords),
    indices: new Uint16Array(indices),
  }
}

function normalize(v: number[]): [number, number, number] {
  const len = Math.sqrt(v[0]! * v[0]! + v[1]! * v[1]! + v[2]! * v[2]!)
  return [v[0]! / len, v[1]! / len, v[2]! / len]
}

function uvFromPoint(p: number[]): [number, number] {
  return [
    (Math.atan2(p[0]!, p[2]!) / (2 * Math.PI)) + 0.5,
    1.0 - ((Math.asin(p[1]!) / Math.PI) + 0.5),
  ]
}

// ============================================================================
// Arc Geometry Generation
// ============================================================================

function createArcGeometry(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  segments: number = 50,
  progress: number = 1,
): { positions: Float32Array, alphas: Float32Array } {
  const interpolate = geoInterpolate([startLng, startLat], [endLng, endLat])
  const angle = geoDistance([startLng, startLat], [endLng, endLat])

  const positions: number[] = []
  const alphas: number[] = []

  const numSegments = Math.floor(segments * progress)
  for (let i = 0; i <= numSegments; i++) {
    const t = i / segments

    // D3 great-circle interpolation (handles antimeridian + poles)
    const [lng, lat] = interpolate(t)
    const point = latLngToXYZ(lat!, lng!, 1.0)

    // Lift arc above sphere surface
    const lift = Math.sin(t * Math.PI) * 0.15 * (angle / Math.PI)
    const len = Math.sqrt(point[0] ** 2 + point[1] ** 2 + point[2] ** 2)
    const scale = (1 + lift) / len
    positions.push(point[0] * scale, point[1] * scale, point[2] * scale)

    // Alpha: strong center, soft ends
    alphas.push(Math.sin(t * Math.PI))
  }

  return {
    positions: new Float32Array(positions),
    alphas: new Float32Array(alphas),
  }
}

function latLngToXYZ(lat: number, lng: number, radius: number): [number, number, number] {
  const latRad = (lat * Math.PI) / 180
  const lngRad = (lng * Math.PI) / 180
  return [
    radius * Math.cos(latRad) * Math.sin(lngRad),
    radius * Math.sin(latRad),
    radius * Math.cos(latRad) * Math.cos(lngRad),
  ]
}

// ============================================================================
// Color Utilities
// ============================================================================

function parseColor(color: string): [number, number, number] {
  if (color.startsWith('oklch')) {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = color
    ctx.fillRect(0, 0, 1, 1)
    const data = ctx.getImageData(0, 0, 1, 1).data
    return [data[0]! / 255, data[1]! / 255, data[2]! / 255]
  }

  if (color.startsWith('#')) {
    const hex = color.slice(1)
    return [
      Number.parseInt(hex.slice(0, 2), 16) / 255,
      Number.parseInt(hex.slice(2, 4), 16) / 255,
      Number.parseInt(hex.slice(4, 6), 16) / 255,
    ]
  }

  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (match) {
    return [
      Number.parseInt(match[1]!) / 255,
      Number.parseInt(match[2]!) / 255,
      Number.parseInt(match[3]!) / 255,
    ]
  }

  return [0.5, 0.5, 0.5]
}

// ============================================================================
// Country Texture Generation
// ============================================================================

// Hex grid constants (flat-top hexagons)
// hexSize=9 gives ~40k hexes globally, close to H3 resolution 3
const HEX_SIZE = 9
const HEX_MARGIN = 0.2

// Precompute hex vertex offsets for flat-top hexagon
const HEX_ANGLES = Array.from({ length: 6 }, (_, i) => {
  const angle = (Math.PI / 3) * i
  return [Math.cos(angle), Math.sin(angle)] as const
})

async function createCountryTexture(
  gl: WebGLRenderingContext,
  countries: GeoJSONData,
  countryStats: Map<string, number>,
  maxVisits: number,
  tiers: CountryColorTiers,
  strokeColor: string,
  globeFill: string,
  locations: LocationData[],
  highest: number,
  heatmapTiers: HeatmapColorTiers,
): Promise<WebGLTexture | null> {
  const { geoPath, geoEquirectangular } = await import('d3-geo')

  const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
  const width = Math.min(4096, maxSize)
  const height = width / 2

  // Main canvas
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!

  // Fill ocean
  ctx.fillStyle = globeFill
  ctx.fillRect(0, 0, width, height)

  const projection = geoEquirectangular()
    .scale(width / (2 * Math.PI))
    .translate([width / 2, height / 2])

  const pathGen = geoPath(projection)

  // === Step 1: Create country lookup texture ===
  // Each country is drawn with a unique color encoding its index
  const lookupCanvas = document.createElement('canvas')
  lookupCanvas.width = width
  lookupCanvas.height = height
  const lookupCtx = lookupCanvas.getContext('2d')!

  lookupCtx.fillStyle = 'rgb(0, 0, 0)'
  lookupCtx.fillRect(0, 0, width, height)

  const features = countries.features
  for (let i = 0; i < features.length; i++) {
    const id = i + 1
    lookupCtx.fillStyle = `rgb(${id & 0xFF}, ${(id >> 8) & 0xFF}, 0)`
    lookupCtx.beginPath()
    pathGen.context(lookupCtx)(features[i] as any)
    lookupCtx.fill()
  }

  const lookupData = lookupCtx.getImageData(0, 0, width, height).data

  // === Step 2: Build country color map ===
  const tierScale = scaleThreshold<number, string>()
    .domain([1, maxVisits * 0.33, maxVisits * 0.66])
    .range([tiers.noData, tiers.tier1, tiers.tier2, tiers.tier3])

  const countryColorMap = new Map<number, string>()
  for (let i = 0; i < features.length; i++) {
    const props = (features[i] as any)?.properties
    const countryCode = props?.ISO_A2 || props?.iso_a2 || ''
    const count = countryStats.get(countryCode) || 0
    countryColorMap.set(i, tierScale(count))
  }

  // === Step 3: Generate hex grid and group by color ===
  const drawRadius = HEX_SIZE * (1 - HEX_MARGIN)
  const colSpacing = 1.5 * HEX_SIZE
  const rowSpacing = Math.sqrt(3) * HEX_SIZE
  const halfRowSpacing = rowSpacing / 2
  const numCols = Math.ceil(width / colSpacing) + 1
  const numRows = Math.ceil(height / rowSpacing) + 1

  // Group hex centers by fill color for batch rendering
  const hexesByColor = new Map<string, number[]>()

  for (let col = 0; col < numCols; col++) {
    const isOddCol = col & 1
    for (let row = 0; row < numRows; row++) {
      const cx = col * colSpacing
      const cy = row * rowSpacing + (isOddCol ? halfRowSpacing : 0)

      if (cx >= width || cy >= height)
        continue

      // Lookup country at hex center pixel
      const px = Math.min(Math.floor(cx), width - 1)
      const py = Math.min(Math.floor(cy), height - 1)
      const idx = (py * width + px) * 4
      const countryIdx = (lookupData[idx]! | (lookupData[idx + 1]! << 8)) - 1

      if (countryIdx < 0)
        continue // ocean

      const color = countryColorMap.get(countryIdx) || tiers.noData
      let coords = hexesByColor.get(color)
      if (!coords) {
        coords = []
        hexesByColor.set(color, coords)
      }
      coords.push(cx, cy)
    }
  }

  // === Step 4: Draw hexes in batches by color ===
  for (const [color, coords] of hexesByColor) {
    ctx.fillStyle = color
    ctx.beginPath()
    for (let i = 0; i < coords.length; i += 2) {
      const cx = coords[i]!
      const cy = coords[i + 1]!
      // Flat-top hex vertices
      const [cos0, sin0] = HEX_ANGLES[0]!
      ctx.moveTo(cx + drawRadius * cos0, cy + drawRadius * sin0)
      for (let v = 1; v < 6; v++) {
        const [cos, sin] = HEX_ANGLES[v]!
        ctx.lineTo(cx + drawRadius * cos, cy + drawRadius * sin)
      }
      ctx.closePath()
    }
    ctx.fill()
  }

  // === Step 5: Draw heatmap hexes (orange, 5-tier by location density) ===
  if (locations.length > 0 && highest > 0) {
    // Build a density grid: for each hex, sum nearby location counts
    const heatHexSize = HEX_SIZE
    const heatDrawRadius = heatHexSize * (1 - HEX_MARGIN)
    const heatColSpacing = 1.5 * heatHexSize
    const heatRowSpacing = Math.sqrt(3) * heatHexSize
    const heatHalfRow = heatRowSpacing / 2

    // Project all locations to pixel coords and build a spatial index
    const projectedLocs: { px: number, py: number, count: number }[] = []
    for (const loc of locations) {
      const projected = projection([loc.lng, loc.lat])
      if (!projected)
        continue
      projectedLocs.push({ px: projected[0], py: projected[1], count: loc.count })
    }

    // Influence radius in pixels for aggregation
    const influenceRadius = heatColSpacing * 1.5
    const influenceRadiusSq = influenceRadius * influenceRadius

    const heatTierScale = scaleThreshold<number, string>()
      .domain([highest * 0.05, highest * 0.15, highest * 0.35, highest * 0.65])
      .range([heatmapTiers.tier1, heatmapTiers.tier2, heatmapTiers.tier3, heatmapTiers.tier4, heatmapTiers.tier5])

    const heatHexesByColor = new Map<string, number[]>()
    const heatNumCols = Math.ceil(width / heatColSpacing) + 1
    const heatNumRows = Math.ceil(height / heatRowSpacing) + 1

    for (let col = 0; col < heatNumCols; col++) {
      const isOddCol = col & 1
      for (let row = 0; row < heatNumRows; row++) {
        const cx = col * heatColSpacing
        const cy = row * heatRowSpacing + (isOddCol ? heatHalfRow : 0)

        if (cx >= width || cy >= height)
          continue

        // Sum weighted density from nearby locations
        let density = 0
        for (const loc of projectedLocs) {
          const dx = cx - loc.px
          const dy = cy - loc.py
          const distSq = dx * dx + dy * dy
          if (distSq < influenceRadiusSq) {
            const weight = 1 - Math.sqrt(distSq) / influenceRadius
            density += loc.count * weight
          }
        }

        if (density <= 0)
          continue

        const color = heatTierScale(density)
        let coords = heatHexesByColor.get(color)
        if (!coords) {
          coords = []
          heatHexesByColor.set(color, coords)
        }
        coords.push(cx, cy)
      }
    }

    // Draw heatmap hexes on top of country hexes
    for (const [color, coords] of heatHexesByColor) {
      ctx.fillStyle = color
      ctx.beginPath()
      for (let i = 0; i < coords.length; i += 2) {
        const cx = coords[i]!
        const cy = coords[i + 1]!
        const [cos0, sin0] = HEX_ANGLES[0]!
        ctx.moveTo(cx + heatDrawRadius * cos0, cy + heatDrawRadius * sin0)
        for (let v = 1; v < 6; v++) {
          const [cos, sin] = HEX_ANGLES[v]!
          ctx.lineTo(cx + heatDrawRadius * cos, cy + heatDrawRadius * sin)
        }
        ctx.closePath()
      }
      ctx.fill()
    }
  }

  // Create GL texture
  const texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

  return texture
}

// ============================================================================
// Main Composable
// ============================================================================

export function useWebGLGlobe(ctx: WebGLGlobeContext) {
  // State
  const longitude = ref(0)
  const latitude = ref(0)
  const zoom = ref(0)
  const isAutoRotating = ref(true)
  const isDragging = ref(false)
  const isReady = ref(false)

  // WebGL state
  let gl: WebGLRenderingContext | null = null
  let earthProgram: twgl.ProgramInfo | null = null
  let arcProgram: twgl.ProgramInfo | null = null
  let rippleProgram: twgl.ProgramInfo | null = null
  let earthBufferInfo: twgl.BufferInfo | null = null
  let countryTexture: WebGLTexture | null = null
  let animationFrameId: number | null = null

  // Interaction state
  let lastMouseX = 0
  let lastMouseY = 0
  let cleanupInteraction: (() => void) | null = null

  // Inertia state
  let velocityX = 0
  let velocityY = 0
  let lastDragTime = 0
  let isInertiaActive = false

  // Intro spin animation
  let introSpinActive = false
  let introSpinStartTime = 0
  const INTRO_SPIN_DURATION = 1000
  let introTargetLat = 0
  let introTargetLng = 0
  let introStartLng = 0
  let introStartLat = 0

  // Active animations
  interface ArcAnimation {
    data: ArcData
    startTime: number
    duration: number
    bufferInfo: twgl.BufferInfo
    vertexCount: number
    color: [number, number, number]
  }

  interface RippleAnimation {
    data: RippleData
    startTime: number
    color: [number, number, number]
  }

  const activeArcs = shallowRef<ArcAnimation[]>([])
  const activeRipples = shallowRef<RippleAnimation[]>([])

  // Reusable single-vertex buffer for ripples
  let rippleBufferInfo: twgl.BufferInfo | null = null
  const ripplePositionData = new Float32Array(3)

  // Precomputed geometry
  const sphereGeometry = createOctahedronSphere(6)

  // Cache
  let lastTextureKey = ''

  // ============================================================================
  // Camera (based on globe-viewer)
  // ============================================================================

  function getCameraValues() {
    const w = ctx.width.value
    const h = ctx.height.value
    const aspect = w / h

    const fov = (30 * Math.PI / 180) / Math.min(aspect, 1.0)
    const projection = m4.perspective(fov, aspect, 0.01, 10)

    // Distance so globe fills ~80% of viewport height at zoom=0
    const baseDistance = 1 / Math.tan(0.8 * fov / 2)
    const distance = baseDistance * (1 - zoom.value * 0.7)
    let camera = m4.identity()
    camera = m4.rotateY(camera, (longitude.value + 180) * Math.PI / 180)
    camera = m4.rotateX(camera, latitude.value * Math.PI / 180)

    const eye = m4.transformPoint(camera, [0, 0, -distance]) as number[]
    const up = m4.transformPoint(camera, [0, 1, 0]) as number[]
    const target = [0, 0, 0]
    const view = m4.inverse(m4.lookAt(eye, target, up))

    return { view, projection, eye }
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  async function init() {
    const canvas = ctx.canvasRef.value
    if (!canvas)
      return false

    gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: true,
    })

    if (!gl) {
      console.error('WebGL not supported')
      return false
    }

    // Create programs
    earthProgram = twgl.createProgramInfo(gl, [earthVertexShader, earthFragmentShader])
    arcProgram = twgl.createProgramInfo(gl, [arcVertexShader, arcFragmentShader])
    rippleProgram = twgl.createProgramInfo(gl, [rippleVertexShader, rippleFragmentShader])

    // Create earth buffer
    earthBufferInfo = twgl.createBufferInfoFromArrays(gl, {
      position: { numComponents: 3, data: sphereGeometry.position },
      texcoord: { numComponents: 2, data: sphereGeometry.texcoord },
      indices: { numComponents: 3, data: sphereGeometry.indices },
    })

    // Setup GL state
    gl.enable(gl.DEPTH_TEST)
    gl.enable(gl.CULL_FACE)
    gl.clearColor(0, 0, 0, 0)

    // Create placeholder texture
    const textures = twgl.createTextures(gl, {
      placeholder: {
        min: gl.LINEAR,
        mag: gl.LINEAR,
        width: 1,
        height: 1,
        src: [0, 0, 0, 0],
      },
    })
    countryTexture = textures.placeholder ?? null

    // Setup interaction
    setupInteraction(canvas)

    isReady.value = true
    return true
  }

  function updateCanvasSize() {
    const canvas = ctx.canvasRef.value
    if (!canvas || !gl)
      return

    const w = ctx.width.value
    const h = ctx.height.value
    const dpr = window.devicePixelRatio || 1

    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`

    gl.viewport(0, 0, canvas.width, canvas.height)
  }

  async function updateCountryTexture() {
    if (!gl)
      return

    const countries = ctx.countries.value
    const stats = ctx.countryStats.value
    const max = ctx.maxCountryVisits.value
    const tiers = ctx.countryColorTiers.value
    const colors = ctx.colors.value

    const locs = ctx.locations.value
    const high = ctx.highest.value
    const heatTiers = ctx.heatmapColorTiers.value
    const key = JSON.stringify(tiers) + JSON.stringify(heatTiers) + colors.countryStroke + colors.globeFill + countries.features.length + stats.size + max + locs.length + high
    if (key === lastTextureKey && countryTexture)
      return

    lastTextureKey = key

    if (countryTexture) {
      gl.deleteTexture(countryTexture)
    }

    countryTexture = await createCountryTexture(
      gl,
      countries,
      stats,
      max,
      tiers,
      colors.countryStroke,
      colors.globeFill,
      ctx.locations.value,
      ctx.highest.value,
      ctx.heatmapColorTiers.value,
    )
  }

  // ============================================================================
  // Interaction (based on globe-viewer)
  // ============================================================================

  function setupInteraction(canvas: HTMLCanvasElement) {
    function stopInertia() {
      isInertiaActive = false
      velocityX = 0
      velocityY = 0
    }

    function startInertia() {
      if (Math.abs(velocityX) > 0.01 || Math.abs(velocityY) > 0.01) {
        isInertiaActive = true
      }
    }

    function applyDrag(deltaX: number, deltaY: number, sensitivity: number) {
      const now = performance.now()
      const dt = now - lastDragTime
      if (dt > 0 && dt < 100) {
        velocityX = deltaX / dt
        velocityY = deltaY / dt
      }
      lastDragTime = now

      const zoomFactor = 1 - zoom.value * 0.8
      longitude.value = ((longitude.value - deltaX * sensitivity * zoomFactor) % 360 + 540) % 360 - 180
      latitude.value = Math.max(-85, Math.min(85, latitude.value + deltaY * sensitivity * zoomFactor))
    }

    const onMouseDown = (e: MouseEvent) => {
      isDragging.value = true
      lastMouseX = e.screenX
      lastMouseY = e.screenY
      lastDragTime = performance.now()
      stopAutoRotate()
      stopInertia()
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.value)
        return

      const deltaX = e.screenX - lastMouseX
      const deltaY = e.screenY - lastMouseY
      lastMouseX = e.screenX
      lastMouseY = e.screenY

      applyDrag(deltaX, deltaY, 0.3)
    }

    const onMouseUp = () => {
      if (!isDragging.value)
        return
      isDragging.value = false
      startInertia()
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      let amount = -e.deltaY * 0.001
      if ((e as any).mozInputSource === 1 && e.deltaMode === 1) {
        amount *= 50
      }
      zoom.value = Math.max(0, Math.min(1, zoom.value + amount))
      stopAutoRotate()
    }

    // Touch support
    let lastTouchX = 0
    let lastTouchY = 0

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        isDragging.value = true
        lastTouchX = e.touches[0]!.clientX
        lastTouchY = e.touches[0]!.clientY
        lastDragTime = performance.now()
        stopAutoRotate()
        stopInertia()
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!isDragging.value || e.touches.length !== 1)
        return

      const deltaX = e.touches[0]!.clientX - lastTouchX
      const deltaY = e.touches[0]!.clientY - lastTouchY
      lastTouchX = e.touches[0]!.clientX
      lastTouchY = e.touches[0]!.clientY

      applyDrag(deltaX, deltaY, 0.5)
    }

    const onTouchEnd = () => {
      if (!isDragging.value)
        return
      isDragging.value = false
      startInertia()
    }

    canvas.addEventListener('mousedown', onMouseDown)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('touchstart', onTouchStart)
    canvas.addEventListener('touchmove', onTouchMove)
    canvas.addEventListener('touchend', onTouchEnd)

    cleanupInteraction = () => {
      stopInertia()
      canvas.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('touchstart', onTouchStart)
      canvas.removeEventListener('touchmove', onTouchMove)
      canvas.removeEventListener('touchend', onTouchEnd)
    }
  }

  // ============================================================================
  // Auto Rotation (integrated into render loop)
  // ============================================================================

  function startAutoRotate() {
    isAutoRotating.value = true
  }

  function stopAutoRotate() {
    isAutoRotating.value = false
  }

  // ============================================================================
  // Arc and Ripple
  // ============================================================================

  function drawArc(arcData: ArcData, duration: number = 2000): symbol {
    if (!gl)
      return Symbol('arc')

    const id = Symbol('arc')
    const color = arcData.color ? parseColor(arcData.color) : [1.0, 0.6, 0.2] as [number, number, number]

    // Pre-compute full arc geometry (all 51 vertices)
    const geom = createArcGeometry(
      arcData.startLat,
      arcData.startLng,
      arcData.endLat,
      arcData.endLng,
      50,
      1,
    )

    const bufferInfo = twgl.createBufferInfoFromArrays(gl, {
      position: { numComponents: 3, data: geom.positions },
      alpha: { numComponents: 1, data: geom.alphas },
    })

    activeArcs.value = [...activeArcs.value, {
      data: arcData,
      startTime: performance.now(),
      duration,
      bufferInfo,
      vertexCount: geom.positions.length / 3,
      color,
    }]

    return id
  }

  function drawRipple(rippleData: RippleData): symbol {
    const id = Symbol('ripple')
    const color = rippleData.color ? parseColor(rippleData.color) : [1.0, 0.6, 0.2] as [number, number, number]

    activeRipples.value = [...activeRipples.value, {
      data: rippleData,
      startTime: performance.now(),
      color,
    }]

    return id
  }

  // ============================================================================
  // Rendering
  // ============================================================================

  // Render timing
  let lastFrameTime = 0

  function render() {
    if (!gl || !earthProgram || !earthBufferInfo || !countryTexture)
      return

    const w = ctx.width.value
    const h = ctx.height.value
    if (w < 2 || h < 2)
      return

    const now = performance.now()
    const dt = lastFrameTime > 0 ? Math.min((now - lastFrameTime) / 1000, 0.1) : 0.016
    lastFrameTime = now

    // Intro spin animation (fast spin-in on first load)
    if (introSpinActive) {
      const elapsed = now - introSpinStartTime
      const t = Math.min(elapsed / INTRO_SPIN_DURATION, 1)
      // Ease-out cubic for smooth deceleration
      const eased = 1 - (1 - t) ** 3
      longitude.value = introStartLng + (introTargetLng - introStartLng) * eased
      latitude.value = introStartLat + (introTargetLat - introStartLat) * eased

      if (t >= 1) {
        introSpinActive = false
        longitude.value = introTargetLng
        latitude.value = introTargetLat
        isAutoRotating.value = true
      }
    }

    // Auto-rotate (integrated into render loop)
    if (isAutoRotating.value && !introSpinActive) {
      longitude.value = ((longitude.value - 9 * dt) % 360 + 540) % 360 - 180
    }

    // Inertia (dt-based decay)
    if (isInertiaActive) {
      const decay = Math.exp(-3.0 * dt)
      velocityX *= decay
      velocityY *= decay

      const zoomFactor = 1 - zoom.value * 0.8
      const dtMs = dt * 1000
      longitude.value = ((longitude.value - velocityX * dtMs * 0.3 * zoomFactor) % 360 + 540) % 360 - 180
      latitude.value = Math.max(-85, Math.min(85, latitude.value + velocityY * dtMs * 0.3 * zoomFactor))

      if (Math.abs(velocityX) < 0.001 && Math.abs(velocityY) < 0.001) {
        isInertiaActive = false
      }
    }

    const { view, projection, eye } = getCameraValues()
    const model = m4.identity()

    // Clear
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

    // Draw earth
    gl.useProgram(earthProgram.program)
    twgl.setBuffersAndAttributes(gl, earthProgram, earthBufferInfo)
    twgl.setUniforms(earthProgram, {
      model,
      view,
      projection,
      u_countryTexture: countryTexture,
    })
    twgl.drawBufferInfo(gl, earthBufferInfo)

    // Draw arcs (reuse pre-computed buffers)
    if (arcProgram && activeArcs.value.length > 0) {
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.depthMask(false)

      gl.lineWidth(3)
      const newArcs: typeof activeArcs.value = []

      for (const arc of activeArcs.value) {
        const elapsed = now - arc.startTime
        const progress = Math.min(elapsed / arc.duration, 1)

        if (progress < 1 || elapsed < arc.duration + 500) {
          const fadeProgress = progress >= 1 ? 1 - (elapsed - arc.duration) / 500 : 1
          const visibleVerts = Math.floor(arc.vertexCount * Math.min(progress, 1))

          if (visibleVerts > 1) {
            gl!.useProgram(arcProgram!.program)
            twgl.setBuffersAndAttributes(gl!, arcProgram!, arc.bufferInfo)
            twgl.setUniforms(arcProgram!, {
              model,
              view,
              projection,
              u_color: arc.color,
              u_fade: fadeProgress,
            })

            gl!.drawArrays(gl!.LINE_STRIP, 0, visibleVerts)
          }
          newArcs.push(arc)
        }
      }

      activeArcs.value = newArcs
      gl.depthMask(true)
      gl.disable(gl.BLEND)
    }

    // Draw ripples as expanding rings (reuse single-vertex buffer)
    if (rippleProgram && activeRipples.value.length > 0) {
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.depthMask(false)

      const newRipples: typeof activeRipples.value = []
      const h = ctx.height.value

      // Create ripple buffer once
      if (!rippleBufferInfo) {
        rippleBufferInfo = twgl.createBufferInfoFromArrays(gl, {
          position: { numComponents: 3, data: ripplePositionData },
        })
      }

      for (const ripple of activeRipples.value) {
        const elapsed = now - ripple.startTime
        const duration = ripple.data.duration ?? 1500
        const progress = elapsed / duration

        if (progress < 1) {
          const maxRadius = ripple.data.maxRadius ?? 6
          const projectedGlobeRadius = h * 0.4
          const maxSize = maxRadius * projectedGlobeRadius * Math.PI / 180 * 4
          const currentSize = Math.max(12, maxSize * progress)
          const alpha = 1.0 - progress

          const pos = latLngToXYZ(ripple.data.lat, ripple.data.lng, 1.005)
          ripplePositionData[0] = pos[0]
          ripplePositionData[1] = pos[1]
          ripplePositionData[2] = pos[2]

          // Update existing buffer data
          const posAttrib = rippleBufferInfo!.attribs?.position
          if (posAttrib) {
            gl!.bindBuffer(gl!.ARRAY_BUFFER, posAttrib.buffer)
            gl!.bufferData(gl!.ARRAY_BUFFER, ripplePositionData, gl!.DYNAMIC_DRAW)
          }

          gl!.useProgram(rippleProgram!.program)
          twgl.setBuffersAndAttributes(gl!, rippleProgram!, rippleBufferInfo!)
          twgl.setUniforms(rippleProgram!, {
            model,
            view,
            projection,
            u_pointSize: currentSize,
            u_color: ripple.color,
            u_eye: eye,
            u_alpha: Math.min(alpha, 1.0),
            u_ringWidth: 0.25 + 0.15 * (1 - progress),
          })

          gl!.drawArrays(gl!.POINTS, 0, 1)
          newRipples.push(ripple)
        }
      }

      activeRipples.value = newRipples
      gl.depthMask(true)
      gl.disable(gl.BLEND)
    }
  }

  function startRenderLoop() {
    if (animationFrameId !== null)
      return

    function loop() {
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

  // ============================================================================
  // Public API
  // ============================================================================

  function setPointOfView(lat: number, lng: number, animate: boolean = false) {
    const targetLat = Math.max(-85, Math.min(85, lat))
    const targetLng = -lng

    if (animate) {
      introSpinActive = true
      introSpinStartTime = performance.now()
      introStartLng = targetLng + 360
      introStartLat = targetLat
      introTargetLng = targetLng
      introTargetLat = targetLat
      longitude.value = introStartLng
      latitude.value = introStartLat
      isAutoRotating.value = false
    }
    else {
      latitude.value = targetLat
      longitude.value = targetLng
    }
  }

  function destroy() {
    stopRenderLoop()
    stopAutoRotate()
    activeArcs.value = []
    activeRipples.value = []
    isReady.value = false

    if (cleanupInteraction) {
      cleanupInteraction()
      cleanupInteraction = null
    }

    if (gl && countryTexture) {
      gl.deleteTexture(countryTexture)
    }
  }

  return {
    // State
    longitude,
    latitude,
    zoom,
    isAutoRotating,
    isDragging,
    isReady,

    // Methods
    init,
    updateCanvasSize,
    updateCountryTexture,
    setPointOfView,
    startAutoRotate,
    stopAutoRotate,
    drawArc,
    drawRipple,
    startRenderLoop,
    stopRenderLoop,
    destroy,

    // For external checks
    hasActiveAnimations: () => activeArcs.value.length > 0 || activeRipples.value.length > 0,
  }
}
