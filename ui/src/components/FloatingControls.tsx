import { useHadr, type LayerToggles } from '../store'
import { useMapView } from '../map/viewState'

/* Legend chips mirror the currently-enabled layers. */
const LEGEND: Partial<Record<keyof LayerToggles, { label: string; bg: string; border?: string }>> = {
  track: { label: 'Cyclone track', bg: 'var(--impact)' },
  flood: { label: 'Flood extent', bg: 'rgba(47,128,237,.55)', border: '1px solid #5aa2e0' },
  wind: { label: 'Wind field', bg: '#8b7fd6' },
  buildings: { label: 'Damage severe', bg: 'var(--d-severe)' },
  roads: { label: 'Road closed', bg: 'var(--road-closed)' },
  estate: { label: 'Defence base', bg: 'var(--text)' },
}

export default function FloatingControls({ leftEdge, rightEdge }: { leftEdge: number; rightEdge: number }) {
  const { toggles } = useHadr()
  const { viewState, setViewState } = useMapView()
  const chips = (Object.keys(LEGEND) as Array<keyof LayerToggles>).filter((k) => toggles[k])

  const bearing = viewState.bearing ?? 0
  const offNorth = Math.abs(bearing) > 0.5
  const resetNorth = () =>
    setViewState((vs) => ({ ...vs, bearing: 0, transitionDuration: 400 })) // preserve pitch + zoom

  return (
    <>
      {/* legend */}
      <div style={{ position: 'absolute', left: leftEdge, bottom: 118, display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: 420, zIndex: 35 }}>
        {chips.map((k) => {
          const c = LEGEND[k]!
          return (
            <div
              key={k}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 5, padding: '4px 9px' }}
            >
              <span style={{ width: 11, height: 11, borderRadius: 2, background: c.bg, border: c.border ?? 'none' }} />
              <span style={{ fontSize: 10.5, color: 'var(--text-2)' }}>{c.label}</span>
            </div>
          )
        })}
      </div>

      {/* scale bar */}
      <div
        className="mono"
        style={{ position: 'absolute', left: leftEdge, bottom: 98, display: 'flex', alignItems: 'center', gap: 7, zIndex: 35, fontSize: 9.5, color: 'var(--text-2)' }}
      >
        <div style={{ width: 70, height: 5, border: '1px solid var(--text-2)', borderTop: 'none', position: 'relative' }}>
          <div style={{ position: 'absolute', left: 0, top: -1, width: 35, height: 5, background: 'var(--text-2)' }} />
        </div>
        <span>0&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;20 km</span>
      </div>

      {/* compass */}
      <div style={{ position: 'absolute', right: rightEdge, bottom: 98, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center', zIndex: 35 }}>
        {/* live compass — needle tracks bearing; click resets north (keeps pitch + zoom).
            Rotate hint lives in the hover tooltip only; zoom is mouse-scroll. */}
        <button
          onClick={resetNorth}
          title="Reset north — right-drag / ctrl-drag to rotate"
          className="mono"
          style={{
            width: 38,
            height: 38,
            borderRadius: '50%',
            background: 'var(--surface)',
            border: `1px solid ${offNorth ? 'var(--accent)' : 'var(--border)'}`,
            boxShadow: offNorth ? '0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent)' : 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            fontWeight: 600,
            color: offNorth ? 'var(--text)' : 'var(--text-2)',
            position: 'relative',
            cursor: 'pointer',
            padding: 0,
            transition: 'border-color .15s, box-shadow .15s',
          }}
        >
          <span
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transform: `rotate(${-bearing}deg)`,
              transition: 'transform .2s ease-out',
            }}
          >
            <span style={{ position: 'absolute', top: -13, color: 'var(--impact)', fontSize: 9 }}>N</span>
            <span style={{ fontSize: 12, color: offNorth ? 'var(--accent)' : 'var(--text-2)' }}>▲</span>
          </span>
        </button>
      </div>
    </>
  )
}
