import type { GlobeConfig } from '#layers/dashboard/app/composables/useD3Globe'
import type { ComputedRef, Ref, ShallowRef } from 'vue'
import type { AreaData, ColoData, CurrentLocation, GeoJSONData, LocationData, TrafficEventParams } from '@/types'
import { watchDeep } from '@vueuse/core'

interface RawLocationData {
  latitude: number
  longitude: number
  count: string | number
}

export interface GlobeDataState {
  countries: ShallowRef<GeoJSONData>
  locations: ShallowRef<LocationData[]>
  colos: ShallowRef<Record<string, ColoData>>
  currentLocation: Ref<CurrentLocation>
  countryStats: ShallowRef<Map<string, number>>
  highest: ComputedRef<number>
  maxCountryVisits: ComputedRef<number>
}

export function useGlobeData() {
  const realtimeStore = useDashboardRealtimeStore()

  const countries = shallowRef<GeoJSONData>({ features: [] })
  const locations = shallowRef<LocationData[]>([])
  const colos = shallowRef<Record<string, ColoData>>({})
  const currentLocation = ref<CurrentLocation>({})
  const countryStats = shallowRef<Map<string, number>>(new Map())

  const highest = computed(() => Math.max(...locations.value.map(l => l.count), 1))
  const maxCountryVisits = computed(() => Math.max(...countryStats.value.values(), 1))

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
        statsMap.set(item.name, item.count)
      })
    }
    countryStats.value = statsMap
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

  async function init() {
    await Promise.all([
      getLiveLocations(),
      getCurrentLocation(),
      getGlobeJSON(),
      getColosJSON(),
      getCountryStats(),
    ])
  }

  async function refresh() {
    await Promise.all([
      getLiveLocations(),
      getCountryStats(),
    ])
  }

  // Watch store changes
  watchDeep([() => realtimeStore.timeRange, () => realtimeStore.filters], refresh)

  return {
    countries,
    locations,
    colos,
    currentLocation,
    countryStats,
    highest,
    maxCountryVisits,
    init,
    refresh,
  }
}

export interface TrafficEventContext {
  colos: ShallowRef<Record<string, ColoData>>
  arcColor: ComputedRef<string>
  globe: {
    getProjection: () => any
    drawArc: (arcData: any, duration?: number) => symbol
    drawRipple: (rippleData: any) => symbol
  }
}

export function useTrafficEvent(ctx: TrafficEventContext) {
  const pendingTimeouts = new Set<ReturnType<typeof setTimeout>>()

  function handleTrafficEvent({ props }: TrafficEventParams, { delay = 2000 }: { delay?: number } = {}) {
    const projection = ctx.globe.getProjection()
    if (!projection)
      return

    const { item } = props
    if (item.latitude == null || item.longitude == null || !item.COLO) {
      console.warn('Missing location data for traffic event', item)
      return
    }

    const endLat = ctx.colos.value[item.COLO]?.lat
    const endLng = ctx.colos.value[item.COLO]?.lon

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

    // Draw arc
    ctx.globe.drawArc({
      startLat: item.latitude,
      startLng: item.longitude,
      endLat,
      endLng,
      color: ctx.arcColor.value,
    }, delay)

    // Draw start ripple (small)
    ctx.globe.drawRipple({
      lat: item.latitude,
      lng: item.longitude,
      maxRadius: 0.75,
      duration: delay * 0.6,
      color: ctx.arcColor.value,
    })

    // Draw end ripple after delay (larger)
    const timeoutId = setTimeout(() => {
      pendingTimeouts.delete(timeoutId)
      ctx.globe.drawRipple({
        lat: endLat,
        lng: endLng,
        maxRadius: 3,
        duration: delay,
        color: ctx.arcColor.value,
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

export function createGlobeConfig(
  width: Ref<number>,
  height: Ref<number>,
  currentLocation: Ref<CurrentLocation>,
): ComputedRef<GlobeConfig> {
  return computed<GlobeConfig>(() => ({
    width: width.value,
    height: height.value || width.value,
    sensitivity: 75,
    autoRotateSpeed: 0.3,
    initialRotation: [
      currentLocation.value.longitude != null ? -currentLocation.value.longitude : 0,
      currentLocation.value.latitude != null ? -currentLocation.value.latitude : -20,
    ],
  }))
}
