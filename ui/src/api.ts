const cache = new Map<string, unknown>()

async function getJSON<T>(url: string, useCache = true): Promise<T> {
  if (useCache && cache.has(url)) return cache.get(url) as T
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url}: ${r.status} ${await r.text()}`)
  const data = (await r.json()) as T
  if (useCache) cache.set(url, data)
  return data
}

export interface SpineTick {
  t_index: number
  ts_utc: string
  ts_aest: string
  phase: 'approach' | 'landfall' | 'flood' | 'recovery'
  narrative: string
}

/** ts_aest arrives as AEST wall time with a spurious Z — format without TZ math. */
export function fmtAest(ts?: string): string {
  if (!ts) return '—'
  const d = new Date(ts.replace('Z', ''))
  return (
    d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) +
    ' ' +
    d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false }) +
    ' AEST'
  )
}

export const api = {
  timeline: () => getJSON<SpineTick[]>('/api/timeline'),
  frame: (t: number, layers?: string[]) =>
    getJSON<Record<string, any>>(
      `/api/frame/${t}${layers ? `?layers=${layers.join(',')}` : ''}`,
    ),
  allFrames: (layer: string) => getJSON<Record<string, any>>(`/api/frames/${layer}`),
  reference: (name: string) => getJSON<any[]>(`/api/reference/${name}`),
  buildings: () => getJSON<GeoJSON.FeatureCollection>('/api/reference/buildings/geojson'),
  liveState: () => getJSON<any>('/api/live/state', false),
  status: () => getJSON<any>('/api/status', false),
  sitrep: async (body: { t_index?: number; live?: boolean }) => {
    const r = await fetch('/api/sitrep', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) throw new Error(`sitrep: ${r.status} ${await r.text()}`)
    return (await r.json()) as { sitrep: string; generated_by: string; caveat: string }
  },
}

/** Rebuild cumulative per-building damage state from the delta frames. */
export function accumulateDamage(
  deltas: Record<string, { changes?: Record<string, string> } | null>,
  nTicks: number,
): Array<Map<string, string>> {
  const states: Array<Map<string, string>> = []
  let current = new Map<string, string>()
  for (let t = 0; t < nTicks; t++) {
    const d = deltas[String(t)]
    if (d?.changes && Object.keys(d.changes).length > 0) {
      current = new Map(current)
      for (const [id, cls] of Object.entries(d.changes)) current.set(id, cls)
    }
    states.push(current)
  }
  return states
}
