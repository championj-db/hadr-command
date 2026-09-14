/* Shared map view state so the map and the floating controls (compass, zoom)
   read the live bearing/pitch/zoom and can drive them. Presentational only. */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { VIEWS } from './HadrMap'

export interface MapViewState {
  longitude: number
  latitude: number
  zoom: number
  pitch: number
  bearing: number
  transitionDuration?: number
  [k: string]: any
}

interface MapViewCtx {
  viewState: MapViewState
  setViewState: (updater: MapViewState | ((vs: MapViewState) => MapViewState)) => void
}

const Ctx = createContext<MapViewCtx | null>(null)

export function useMapView(): MapViewCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useMapView outside provider')
  return v
}

export function MapViewProvider({ children }: { children: ReactNode }) {
  const [viewState, setViewState] = useState<MapViewState>({ ...VIEWS.Cairns })
  const value = useMemo(() => ({ viewState, setViewState }), [viewState])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
