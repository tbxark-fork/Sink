import type { ShallowRef } from 'vue'
import type { LocationData } from '@/types'
import { ref, shallowRef } from 'vue'

export interface GlobeWorkerInput {
  locations: LocationData[]
  width: number
  height: number
  scale: number
  rotation: [number, number]
  radius: number
  highest: number
}

export interface VisiblePoint {
  x: number
  y: number
  radius: number
  r: number
  g: number
  b: number
  count: number
}

const FLOATS_PER_POINT = 7

export function useGlobeWorker() {
  let worker: Worker | null = null
  let pendingResolve: ((points: VisiblePoint[]) => void) | null = null

  // Double buffer for smooth rendering
  const currentBuffer: ShallowRef<VisiblePoint[]> = shallowRef([])

  // Track if worker is busy and pending input
  const isBusy = ref(false)
  let pendingInput: GlobeWorkerInput | null = null

  function init() {
    if (worker)
      return

    const workerUrl = new URL('../workers/globe.worker.ts', import.meta.url)
    worker = new Worker(workerUrl, { type: 'module', name: 'globe-worker' })
    worker.onmessage = handleWorkerMessage
    worker.onerror = handleWorkerError
  }

  function handleWorkerMessage(event: MessageEvent) {
    const { type, buffer, count } = event.data

    if (type === 'visiblePoints') {
      const points = parseBuffer(buffer, count)
      currentBuffer.value = points

      isBusy.value = false

      if (pendingResolve) {
        pendingResolve(points)
        pendingResolve = null
      }

      // If there's pending input, process it immediately
      if (pendingInput) {
        const input = pendingInput
        pendingInput = null
        computeAsync(input)
      }
    }
  }

  function handleWorkerError(error: ErrorEvent) {
    console.error('Globe worker error:', error)
    isBusy.value = false
    // Resolve pending promise with current buffer to avoid hanging
    if (pendingResolve) {
      pendingResolve(currentBuffer.value)
      pendingResolve = null
    }
    pendingInput = null
  }

  function parseBuffer(buffer: ArrayBuffer, count: number): VisiblePoint[] {
    const view = new Float32Array(buffer)
    const points: VisiblePoint[] = []

    for (let i = 0; i < count; i++) {
      const offset = i * FLOATS_PER_POINT
      const x = view[offset]!
      const y = view[offset + 1]!

      // Skip invalid points (marked with NaN)
      if (Number.isNaN(x))
        continue

      points.push({
        x,
        y,
        radius: view[offset + 2]!,
        r: view[offset + 3]!,
        g: view[offset + 4]!,
        b: view[offset + 5]!,
        count: view[offset + 6]!,
      })
    }

    return points
  }

  function compute(input: GlobeWorkerInput): Promise<VisiblePoint[]> {
    return new Promise((resolve) => {
      if (!worker) {
        init()
      }

      // If worker is busy, store as pending and resolve with current buffer
      if (isBusy.value) {
        pendingInput = input
        resolve(currentBuffer.value)
        return
      }

      isBusy.value = true
      pendingResolve = resolve

      worker!.postMessage({
        type: 'computeVisiblePoints',
        data: input,
      })
    })
  }

  // Fire-and-forget version for render loop
  function computeAsync(input: GlobeWorkerInput) {
    if (!worker) {
      init()
    }

    // If worker is busy, store input for later processing
    if (isBusy.value) {
      pendingInput = input
      return
    }

    isBusy.value = true
    pendingInput = null

    worker!.postMessage({
      type: 'computeVisiblePoints',
      data: input,
    })
  }

  function getVisiblePoints(): VisiblePoint[] {
    return currentBuffer.value
  }

  function destroy() {
    if (worker) {
      worker.terminate()
      worker = null
    }
    isBusy.value = false
    pendingResolve = null
    pendingInput = null
    currentBuffer.value = []
  }

  return {
    init,
    compute,
    computeAsync,
    getVisiblePoints,
    currentBuffer,
    isBusy,
    destroy,
  }
}
