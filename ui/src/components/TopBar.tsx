import { useHadr } from '../store'
import { fmtAest } from '../api'
import type { Theme } from '../theme'

/* Phase chip: cyclone phase progression drives colour + tinted background. */
const PHASE: Record<string, { label: string; color: string; bg: string }> = {
  approach: { label: 'WATCH', color: 'var(--watch)', bg: 'rgba(63,138,224,.16)' },
  landfall: { label: 'IMPACT', color: 'var(--impact)', bg: 'rgba(238,75,71,.18)' },
  flood: { label: 'IMPACT', color: 'var(--impact)', bg: 'rgba(238,75,71,.18)' },
  recovery: { label: 'RECOVERY', color: 'var(--recovery)', bg: 'rgba(55,185,107,.16)' },
}

export function ClassificationStrip({ pos }: { pos: 'top' | 'bottom' }) {
  const top = pos === 'top'
  return (
    <div
      className="mono"
      style={{
        height: top ? 24 : 20,
        flex: 'none',
        background: 'var(--surface-3)',
        [top ? 'borderBottom' : 'borderTop']: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: top ? 11 : 10,
        fontWeight: 600,
        letterSpacing: '0.34em',
        color: 'var(--text-2)',
        userSelect: 'none',
      } as React.CSSProperties}
    >
      OFFICIAL
    </div>
  )
}

const segBtn: React.CSSProperties = {
  border: 'none',
  cursor: 'pointer',
  padding: '5px 12px',
  borderRadius: 4,
  font: 'inherit',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
}

export default function TopBar({
  theme,
  onToggleTheme,
  onSitrep,
}: {
  theme: Theme
  onToggleTheme: () => void
  onSitrep: () => void
}) {
  const { timeline, tIndex, mode, setMode } = useHadr()
  const tick = timeline[tIndex]
  const ph = PHASE[tick?.phase ?? 'approach'] ?? PHASE.approach

  const clock =
    mode === 'live'
      ? new Date().toLocaleString('en-AU', { timeZone: 'Australia/Brisbane', hour12: false }) + ' AEST'
      : fmtAest(tick?.ts_aest)

  const replayActive = mode === 'replay'
  const liveActive = mode === 'live'

  return (
    <div
      style={{
        height: 56,
        flex: 'none',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: 18,
        zIndex: 60,
      }}
    >
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 250 }}>
        <div
          style={{
            width: 26,
            height: 26,
            background: 'var(--impact)',
            borderRadius: 3,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 'none',
          }}
        >
          <div style={{ width: 11, height: 11, border: '2px solid #fff', borderRadius: 2 }} />
        </div>
        <div style={{ lineHeight: 1.05 }}>
          <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: '0.08em' }}>HADR COMMAND</div>
          <div style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.04em' }}>
            Disaster Response COP
          </div>
        </div>
      </div>

      {/* Event + phase chip */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ fontWeight: 600, fontSize: 14, letterSpacing: '0.03em' }}>TC JASPER</span>
          <span style={{ color: 'var(--text-3)', fontSize: 13 }}>—</span>
          <span style={{ fontSize: 13, color: 'var(--text-2)', letterSpacing: '0.02em' }}>
            Far North Queensland
          </span>
        </div>
        <div
          className="mono"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            padding: '5px 11px',
            borderRadius: 5,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.12em',
            background: liveActive ? 'rgba(255,68,56,.14)' : ph.bg,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: liveActive ? 'var(--live)' : ph.color,
              animation: liveActive ? 'hadrLive 1s ease-in-out infinite' : 'none',
            }}
          />
          <span style={{ color: liveActive ? 'var(--live)' : ph.color }}>
            {liveActive ? 'MONITORING' : ph.label}
          </span>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          className="mono"
          style={{
            display: 'flex',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: 2,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.06em',
          }}
        >
          <button
            onClick={() => setMode('replay')}
            style={{
              ...segBtn,
              background: replayActive ? 'var(--accent)' : 'transparent',
              color: replayActive ? 'var(--on-accent)' : 'var(--text-2)',
            }}
          >
            REPLAY
          </button>
          <button
            onClick={() => setMode('live')}
            style={{
              ...segBtn,
              background: liveActive ? 'var(--live)' : 'transparent',
              color: liveActive ? '#fff' : 'var(--text-2)',
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: liveActive ? '#fff' : 'var(--text-3)',
                animation: liveActive ? 'hadrLive 1s ease-in-out infinite' : 'none',
              }}
            />
            LIVE
          </button>
        </div>

        <div
          className="mono"
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--text)',
            letterSpacing: '0.01em',
            minWidth: 236,
            textAlign: 'right',
          }}
        >
          {clock}
        </div>

        <button
          onClick={onSitrep}
          className="mono"
          style={{
            border: 'none',
            cursor: 'pointer',
            background: 'var(--impact)',
            color: '#fff',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.08em',
            padding: '8px 14px',
            borderRadius: 6,
          }}
        >
          GENERATE SITREP
        </button>

        <button
          onClick={onToggleTheme}
          title="Toggle theme"
          className="mono"
          style={{
            border: '1px solid var(--border)',
            cursor: 'pointer',
            background: 'var(--surface-2)',
            color: 'var(--text-2)',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.08em',
            padding: '8px 10px',
            borderRadius: 6,
            width: 58,
          }}
        >
          {theme === 'dark' ? 'LIGHT' : 'DARK'}
        </button>
      </div>
    </div>
  )
}
