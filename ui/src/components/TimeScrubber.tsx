import { useHadr } from '../store'
import { fmtAest } from '../api'

/* Scrubber phase bands — cyclone progression read left→right. */
const BAND: Record<string, { color: string; opacity: number }> = {
  approach: { color: 'var(--watch)', opacity: 0.45 },
  landfall: { color: 'var(--warning)', opacity: 0.5 },
  flood: { color: 'var(--impact)', opacity: 0.5 },
  recovery: { color: 'var(--recovery)', opacity: 0.5 },
}

const MARKERS = [
  { t: 71, label: 'Landfall — Wujal Wujal' },
  { t: 96, label: 'YBCS CLOSED' },
  { t: 100, label: 'Barron River peak' },
  { t: 106, label: 'YBCS limited ops' },
]

function shortDate(ts?: string) {
  if (!ts) return ''
  const d = new Date(ts.replace('Z', ''))
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }).toUpperCase()
}

export default function TimeScrubber() {
  const { timeline, tIndex, setTIndex, playing, setPlaying, speed, setSpeed, mode } = useHadr()

  if (mode === 'live')
    return (
      <div
        className="mono"
        style={{
          height: 34,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          gap: 10,
        }}
      >
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--live)', animation: 'hadrLive 1s ease-in-out infinite' }} />
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.1em', color: 'var(--live)' }}>LIVE</span>
        <span style={{ fontSize: 11, color: 'var(--text-2)' }}>
          — feeds real-time · BOM · QLDTraffic · Defence GEOINT
        </span>
      </div>
    )

  const n = timeline.length || 112

  // Group consecutive phases into proportional bands.
  const runs: Array<{ phase: string; count: number }> = []
  for (const t of timeline) {
    const last = runs[runs.length - 1]
    if (last && last.phase === t.phase) last.count++
    else runs.push({ phase: t.phase, count: 1 })
  }

  return (
    <div
      style={{
        height: 78,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: 16,
      }}
    >
      <button
        onClick={() => setPlaying(!playing)}
        style={{
          width: 38,
          height: 38,
          flex: 'none',
          borderRadius: '50%',
          border: 'none',
          cursor: 'pointer',
          background: 'var(--accent)',
          color: 'var(--on-accent)',
          fontSize: 15,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {playing ? '❚❚' : '▶'}
      </button>

      <button
        onClick={() => setSpeed(speed === 1 ? 4 : speed === 4 ? 12 : 1)}
        className="mono"
        style={{
          flex: 'none',
          border: '1px solid var(--border)',
          cursor: 'pointer',
          background: 'var(--surface-2)',
          color: 'var(--text)',
          fontSize: 12,
          fontWeight: 600,
          padding: '7px 10px',
          borderRadius: 6,
          minWidth: 44,
        }}
      >
        {speed}×
      </button>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div
          className="mono"
          style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-3)', letterSpacing: '0.04em' }}
        >
          <span>{shortDate(timeline[0]?.ts_aest)}</span>
          <span>APPROACH</span>
          <span>LANDFALL</span>
          <span>FLOOD</span>
          <span>RECOVERY</span>
          <span>{shortDate(timeline[n - 1]?.ts_aest)}</span>
        </div>

        <div style={{ position: 'relative', height: 26, borderRadius: 5 }}>
          {/* phase bands */}
          <div style={{ position: 'absolute', inset: 0, display: 'flex', borderRadius: 5, overflow: 'hidden' }}>
            {runs.map((r, i) => {
              const b = BAND[r.phase] ?? BAND.approach
              return <div key={i} style={{ width: `${(r.count / n) * 100}%`, background: b.color, opacity: b.opacity }} />
            })}
          </div>

          {/* event flags */}
          {MARKERS.map((m) => (
            <button
              key={m.t}
              onClick={() => setTIndex(m.t)}
              title={m.label}
              style={{
                position: 'absolute',
                top: -3,
                transform: 'translateX(-50%)',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                zIndex: 3,
                color: '#fff',
                fontSize: 11,
                lineHeight: 1,
                left: `${(m.t / (n - 1)) * 100}%`,
              }}
            >
              ⚑
            </button>
          ))}

          {/* playhead */}
          <div
            style={{
              position: 'absolute',
              top: -6,
              bottom: -6,
              width: 2,
              background: '#fff',
              zIndex: 4,
              pointerEvents: 'none',
              left: `${(tIndex / (n - 1)) * 100}%`,
            }}
          >
            <div style={{ position: 'absolute', top: -4, left: -5, width: 12, height: 12, background: '#fff', borderRadius: '50%', border: '2px solid var(--accent)' }} />
          </div>

          {/* transparent range for drag + keyboard + automation */}
          <input
            type="range"
            min={0}
            max={n - 1}
            value={tIndex}
            onChange={(e) => setTIndex(Number(e.target.value))}
            aria-label="Replay timeline"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', margin: 0, opacity: 0, cursor: 'pointer', zIndex: 5 }}
          />
        </div>
      </div>

      <span className="mono" style={{ fontSize: 11, color: 'var(--text-2)', minWidth: 150, textAlign: 'right' }}>
        {fmtAest(timeline[tIndex]?.ts_aest)}
      </span>
    </div>
  )
}
