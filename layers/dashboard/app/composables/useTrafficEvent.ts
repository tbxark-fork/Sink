import type { ComputedRef, ShallowRef } from 'vue'
import type { ColoData, TrafficEventParams } from '@/types'

export interface TrafficEventContext {
  colos: ShallowRef<Record<string, ColoData>>
  arcColor: ComputedRef<string>
  globe: {
    isReady: () => boolean
    drawArc: (arcData: any, duration?: number) => symbol
    drawRipple: (rippleData: any) => symbol
  }
}

export function useTrafficEvent(ctx: TrafficEventContext) {
  const pendingTimeouts = new Set<ReturnType<typeof setTimeout>>()

  function handleTrafficEvent({ props }: TrafficEventParams, { delay = 2000 }: { delay?: number } = {}) {
    if (!ctx.globe.isReady())
      return

    const { item } = props
    const { latitude, longitude, COLO, city } = item
    if (latitude == null || longitude == null || !COLO) {
      console.warn('Missing location data for traffic event', item)
      return
    }

    const colo = ctx.colos.value[COLO]
    const endLat = colo?.lat
    const endLng = colo?.lon

    if (endLat === undefined || endLng === undefined) {
      console.warn(`Missing COLO coordinates for ${COLO}`)
      return
    }

    // Skip if too close
    const isNear = Math.abs(endLat - latitude) < 5 && Math.abs(endLng - longitude) < 5
    if (isNear) {
      console.info(`from ${city} to ${COLO} is near, skip`)
      return
    }

    console.info(`from ${city}(${latitude}, ${longitude}) to ${COLO}(${endLat}, ${endLng})`)
    const color = ctx.arcColor.value

    // Draw arc
    ctx.globe.drawArc({
      startLat: latitude,
      startLng: longitude,
      endLat,
      endLng,
      color,
    }, delay)

    // Draw start ripple
    ctx.globe.drawRipple({
      lat: latitude,
      lng: longitude,
      maxRadius: 3,
      duration: delay * 0.8,
      color,
    })

    // Draw end ripple after delay
    const timeoutId = setTimeout(() => {
      pendingTimeouts.delete(timeoutId)
      ctx.globe.drawRipple({
        lat: endLat,
        lng: endLng,
        maxRadius: 6,
        duration: delay * 1.2,
        color,
      })
    }, delay)
    pendingTimeouts.add(timeoutId)
  }

  function cleanup() {
    pendingTimeouts.forEach(id => clearTimeout(id))
    pendingTimeouts.clear()
  }

  return {
    handleTrafficEvent,
    cleanup,
  }
}
