import { useHadr, type LayerToggles } from '../store'
import { VIEWS } from '../map/HadrMap'

interface LayerDef {
  key: keyof LayerToggles
  label: string
  swatchBg: string
  swatchBorder?: string
}

const GROUPS: Array<{ name: string; abbr: string; items: LayerDef[] }> = [
  {
    name: 'HAZARD',
    abbr: 'HZ',
    items: [
      { key: 'track', label: 'Cyclone track & cone', swatchBg: 'var(--impact)' },
      { key: 'wind', label: 'Wind field', swatchBg: '#8b7fd6' },
      { key: 'rain', label: 'Rainfall', swatchBg: '#14b8a6' },
      { key: 'flood', label: 'Flood extent', swatchBg: 'rgba(47,128,237,.55)', swatchBorder: '1px solid #5aa2e0' },
    ],
  },
  {
    name: 'INFRASTRUCTURE',
    abbr: 'IN',
    items: [
      { key: 'airports', label: 'Airports & runways', swatchBg: 'var(--accent)' },
      {
        key: 'roads',
        label: 'Roads (by status)',
        swatchBg: 'linear-gradient(90deg,var(--road-open) 33%,var(--road-caution) 33% 66%,var(--road-closed) 66%)',
      },
    ],
  },
  {
    name: 'DEFENCE ESTATE',
    abbr: 'DE',
    items: [{ key: 'estate', label: 'Bases & facilities', swatchBg: 'var(--text)' }],
  },
  {
    name: 'IMPACT',
    abbr: 'IM',
    items: [
      { key: 'buildings', label: 'Building damage (3D)', swatchBg: 'linear-gradient(90deg,var(--d-minor),var(--d-severe),var(--d-destroyed))' },
      { key: 'hexDensity', label: 'Damage density (hex)', swatchBg: 'linear-gradient(90deg,var(--d-minor),var(--d-moderate),var(--d-destroyed))' },
    ],
  },
  {
    name: 'BASE',
    abbr: 'BS',
    items: [{ key: 'terrain', label: '3D terrain', swatchBg: 'var(--surface-3)', swatchBorder: '1px solid var(--border-2)' }],
  },
]

const microHead: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 9.5,
  fontWeight: 600,
  letterSpacing: '0.16em',
  color: 'var(--text-3)',
}

function Switch({ on }: { on: boolean }) {
  return (
    <span
      style={{
        width: 28,
        height: 16,
        borderRadius: 9,
        position: 'relative',
        flex: 'none',
        transition: 'background .15s',
        background: on ? 'var(--accent)' : 'var(--border-2)',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          width: 12,
          height: 12,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left .15s',
          left: on ? 14 : 2,
        }}
      />
    </span>
  )
}

function footerBtn(active: boolean): React.CSSProperties {
  return {
    cursor: 'pointer',
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.06em',
    padding: 6,
    borderRadius: 5,
    background: active ? 'var(--accent-2)' : 'var(--surface-2)',
    color: active ? 'var(--text)' : 'var(--text-2)',
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
  }
}

export default function LayersPanel({
  view,
  setView,
  collapsed,
  onToggleCollapse,
  basemap,
  setBasemap,
  pitch3d,
  onTogglePitch,
}: {
  view: string
  setView: (v: string) => void
  collapsed: boolean
  onToggleCollapse: () => void
  basemap: 'satellite' | 'dark'
  setBasemap: (b: 'satellite' | 'dark') => void
  pitch3d: boolean
  onTogglePitch: () => void
}) {
  const { toggles, setToggle } = useHadr()

  const frame: React.CSSProperties = {
    position: 'absolute',
    left: 12,
    top: 12,
    bottom: 12,
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    display: 'flex',
    flexDirection: 'column',
    zIndex: 40,
    overflow: 'hidden',
  }

  if (collapsed)
    return (
      <div style={{ ...frame, width: 46, alignItems: 'center', paddingTop: 8, gap: 4 }}>
        <button
          onClick={onToggleCollapse}
          title="Expand layers"
          style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-2)', fontSize: 16, padding: 6 }}
        >
          ☰
        </button>
        <div style={{ width: 24, height: 1, background: 'var(--border)', margin: '2px 0' }} />
        {GROUPS.map((g) => (
          <div
            key={g.abbr}
            title={g.name}
            className="mono"
            style={{
              width: 30,
              height: 30,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-3)',
            }}
          >
            {g.abbr}
          </div>
        ))}
      </div>
    )

  return (
    <div style={{ ...frame, width: 300 }}>
      <div
        style={{
          height: 40,
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px 0 14px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <span style={{ ...microHead, fontSize: 11, color: 'var(--text-2)' }}>LAYERS</span>
        <button
          onClick={onToggleCollapse}
          title="Collapse"
          style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 15, padding: '2px 4px' }}
        >
          ‹
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
        {GROUPS.map((g) => (
          <div key={g.name}>
            <div style={{ padding: '10px 14px 4px' }}>
              <div style={microHead}>{g.name}</div>
            </div>
            {g.items.map((ly) => {
              const on = toggles[ly.key]
              return (
                <button
                  key={ly.key}
                  onClick={() => setToggle(ly.key, !on)}
                  style={{
                    width: '100%',
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '7px 14px',
                    textAlign: 'left',
                  }}
                >
                  <span
                    style={{
                      width: 13,
                      height: 13,
                      borderRadius: 3,
                      flex: 'none',
                      background: ly.swatchBg,
                      border: ly.swatchBorder ?? 'none',
                    }}
                  />
                  <span style={{ flex: 1, fontSize: 12.5, color: 'var(--text)' }}>{ly.label}</span>
                  <Switch on={on} />
                </button>
              )
            })}
          </div>
        ))}
      </div>

      <div
        style={{
          flex: 'none',
          borderTop: '1px solid var(--border)',
          padding: '10px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 9,
        }}
      >
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setBasemap('satellite')} style={{ ...footerBtn(basemap === 'satellite'), flex: 1 }}>
            SATELLITE
          </button>
          <button onClick={() => setBasemap('dark')} style={{ ...footerBtn(basemap === 'dark'), flex: 1 }}>
            DARK
          </button>
          <button
            onClick={onTogglePitch}
            style={{
              flex: 'none',
              width: 46,
              cursor: 'pointer',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10,
              fontWeight: 600,
              padding: 6,
              borderRadius: 5,
              background: 'var(--surface-2)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
            }}
          >
            {pitch3d ? '3D' : '2D'}
          </button>
        </div>
        <div>
          <div style={{ ...microHead, fontSize: 9, marginBottom: 5 }}>VIEW PRESETS</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {Object.keys(VIEWS).map((p) => {
              const active = view === p
              return (
                <button
                  key={p}
                  onClick={() => setView(p)}
                  style={{
                    cursor: 'pointer',
                    fontSize: 11,
                    padding: '4px 9px',
                    borderRadius: 12,
                    background: active ? 'var(--accent-2)' : 'var(--surface-2)',
                    color: active ? 'var(--text)' : 'var(--text-2)',
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                  }}
                >
                  {p}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
