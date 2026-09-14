/* Global app state: replay clock, mode, layer toggles, data caches. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { api, accumulateDamage, type SpineTick } from './api'

export type Mode = 'replay' | 'live'

export interface LayerToggles {
  track: boolean
  wind: boolean
  rain: boolean
  flood: boolean
  roads: boolean
  buildings: boolean
  hexDensity: boolean
  estate: boolean
  airports: boolean
  terrain: boolean
}

const DEFAULT_TOGGLES: LayerToggles = {
  track: true,
  wind: true,
  rain: false,
  flood: true,
  roads: true,
  buildings: true,
  hexDensity: false,
  estate: true,
  airports: true,
  terrain: false,
}

export interface Selection {
  kind: 'airport' | 'site' | 'building' | 'road'
  data: any
}

interface HadrState {
  ready: boolean
  loadError: string | null
  timeline: SpineTick[]
  tIndex: number
  setTIndex: (t: number) => void
  playing: boolean
  setPlaying: (p: boolean) => void
  speed: number
  setSpeed: (s: number) => void
  mode: Mode
  setMode: (m: Mode) => void
  toggles: LayerToggles
  setToggle: (k: keyof LayerToggles, v: boolean) => void
  frame: Record<string, any> | null
  kpisAll: Record<string, any>
  damageStates: Array<Map<string, string>>
  buildings: GeoJSON.FeatureCollection | null
  reference: Record<string, any[]>
  live: any
  selection: Selection | null
  setSelection: (s: Selection | null) => void
}

const Ctx = createContext<HadrState | null>(null)

export function useHadr(): HadrState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useHadr outside provider')
  return v
}

const PER_TICK_LAYERS = ['track', 'cone', 'wind', 'rain', 'flood', 'roads', 'warnings', 'readiness', 'runways']

export function HadrProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [timeline, setTimeline] = useState<SpineTick[]>([])
  const [tIndex, setTIndexRaw] = useState(96) // default: approach of flood peak
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [mode, setMode] = useState<Mode>('replay')
  const [toggles, setToggles] = useState<LayerToggles>(DEFAULT_TOGGLES)
  const [frame, setFrame] = useState<Record<string, any> | null>(null)
  const [kpisAll, setKpisAll] = useState<Record<string, any>>({})
  const [damageStates, setDamageStates] = useState<Array<Map<string, string>>>([])
  const [buildings, setBuildings] = useState<GeoJSON.FeatureCollection | null>(null)
  const [reference, setReference] = useState<Record<string, any[]>>({})
  const [live, setLive] = useState<any>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const frameCache = useRef(new Map<number, Record<string, any>>())

  // Initial load (retry while the backend warms its frame cache).
  useEffect(() => {
    let cancelled = false
    async function boot(attempt = 0) {
      try {
        const status = await api.status()
        if (!status.frames_ready) {
          if (status.frames_error) throw new Error(status.frames_error)
          if (!cancelled) setTimeout(() => boot(attempt + 1), 2500)
          return
        }
        const [tl, deltas, kpis, sites, airports, runways, aircraft] = await Promise.all([
          api.timeline(),
          api.allFrames('damage_delta'),
          api.allFrames('kpis'),
          api.reference('defence_sites'),
          api.reference('airports'),
          api.reference('runways'),
          api.reference('aircraft_specs'),
        ])
        if (cancelled) return
        setTimeline(tl)
        setDamageStates(accumulateDamage(deltas, tl.length))
        setKpisAll(kpis)
        setReference({ defence_sites: sites, airports, runways, aircraft_specs: aircraft })
        setReady(true)
        api.buildings().then((b) => !cancelled && setBuildings(b)).catch(console.error)
      } catch (e: any) {
        if (!cancelled) setLoadError(String(e?.message ?? e))
      }
    }
    boot()
    return () => {
      cancelled = true
    }
  }, [])

  // Per-tick frame fetch with client cache + neighbour prefetch.
  const setTIndex = useCallback((t: number) => setTIndexRaw(t), [])
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    const cached = frameCache.current.get(tIndex)
    if (cached) setFrame(cached)
    else
      api.frame(tIndex, PER_TICK_LAYERS).then((f) => {
        frameCache.current.set(tIndex, f)
        if (!cancelled) setFrame(f)
      }).catch(console.error)
    for (const n of [tIndex + 1, tIndex + 2]) {
      if (n < timeline.length && !frameCache.current.has(n))
        api.frame(n, PER_TICK_LAYERS).then((f) => frameCache.current.set(n, f)).catch(() => {})
    }
    return () => {
      cancelled = true
    }
  }, [ready, tIndex, timeline.length])

  // Replay clock.
  useEffect(() => {
    if (!playing || mode !== 'replay') return
    const id = setInterval(() => {
      setTIndexRaw((t) => {
        if (t + 1 >= timeline.length) {
          setPlaying(false)
          return t
        }
        return t + 1
      })
    }, 1000 / speed)
    return () => clearInterval(id)
  }, [playing, speed, mode, timeline.length])

  // Live poll.
  useEffect(() => {
    if (mode !== 'live') return
    let cancelled = false
    const tick = () => api.liveState().then((s) => !cancelled && setLive(s)).catch(console.error)
    tick()
    const id = setInterval(tick, 30000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [mode])

  const setToggle = useCallback(
    (k: keyof LayerToggles, v: boolean) => setToggles((t) => ({ ...t, [k]: v })),
    [],
  )

  const value = useMemo<HadrState>(
    () => ({
      ready, loadError, timeline, tIndex, setTIndex, playing, setPlaying, speed, setSpeed,
      mode, setMode, toggles, setToggle, frame, kpisAll, damageStates, buildings,
      reference, live, selection, setSelection,
    }),
    [ready, loadError, timeline, tIndex, setTIndex, playing, speed, mode, toggles, setToggle,
      frame, kpisAll, damageStates, buildings, reference, live, selection],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
