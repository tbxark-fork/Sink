import type { GlobeConfig } from '#layers/dashboard/app/composables/useD3Globe'
import type { ComputedRef, Ref } from 'vue'
import type { CurrentLocation } from '@/types'
import { computed } from 'vue'

export function createGlobeConfig(
  width: Ref<number>,
  height: Ref<number>,
  currentLocation: Ref<CurrentLocation>,
): ComputedRef<GlobeConfig> {
  return computed<GlobeConfig>(() => {
    const { latitude, longitude } = currentLocation.value
    const w = width.value
    const h = height.value || w

    return {
      width: w,
      height: h,
      sensitivity: 75,
      autoRotateSpeed: 0.3,
      initialRotation: [
        longitude != null ? -longitude : 0,
        latitude != null ? -latitude : -20,
      ],
    }
  })
}
