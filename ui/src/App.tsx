import { useState } from 'react'
import { HadrProvider, useHadr } from './store'
import { useTheme } from './theme'
import HadrMap from './map/HadrMap'
import { MapViewProvider } from './map/viewState'
import TopBar, { ClassificationStrip } from './components/TopBar'
import LayersPanel from './components/LayersPanel'
import OpsPanel from './components/OpsPanel'
import TimeScrubber from './components/TimeScrubber'
import SitrepDrawer from './components/SitrepDrawer'
import ClickCard from './components/ClickCard'
import FloatingControls from './components/FloatingControls'

function Shell() {
  const { ready, loadError } = useHadr()
  const [theme, toggleTheme] = useTheme()
  const [view, setView] = useState('Cairns')
  const [basemap, setBasemap] = useState<'satellite' | 'dark'>('satellite')
  const [pitch3d, setPitch3d] = useState(true)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [sitrepOpen, setSitrepOpen] = useState(false)

  if (loadError)
    return (
      <Centered>
        <div style={{ color: 'var(--impact)', maxWidth: 520, fontSize: 13, textAlign: 'center' }}>
          Failed to load replay data: {loadError}
        </div>
      </Centered>
    )
  if (!ready)
    return (
      <Centered>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 18, letterSpacing: '0.14em' }}>HADR COMMAND</div>
          <div className="mono" style={{ fontSize: 12, color: 'var(--text-2)', animation: 'hadrLive 1.4s ease-in-out infinite' }}>
            Loading replay cache…
          </div>
        </div>
      </Centered>
    )

  // Scrubber & floating controls sit clear of the left panel (300px + 12 gutter + 12)
  const leftEdge = leftCollapsed ? 70 : 324
  const rightEdge = 384

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
        overflow: 'hidden',
      }}
    >
      <ClassificationStrip pos="top" />
      <TopBar theme={theme} onToggleTheme={toggleTheme} onSitrep={() => setSitrepOpen((o) => !o)} />

      <MapViewProvider>
      <div style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <HadrMap view={view} basemap={basemap} pitch3d={pitch3d} />

        <LayersPanel
          view={view}
          setView={setView}
          collapsed={leftCollapsed}
          onToggleCollapse={() => setLeftCollapsed((c) => !c)}
          basemap={basemap}
          setBasemap={setBasemap}
          pitch3d={pitch3d}
          onTogglePitch={() => setPitch3d((p) => !p)}
        />

        <OpsPanel />

        <FloatingControls leftEdge={leftEdge} rightEdge={rightEdge} />

        <div style={{ position: 'absolute', left: leftEdge, right: rightEdge, bottom: 14, zIndex: 38 }}>
          <TimeScrubber />
        </div>

        <ClickCard />
        <SitrepDrawer open={sitrepOpen} onClose={() => setSitrepOpen(false)} />
      </div>
      </MapViewProvider>

      <ClassificationStrip pos="bottom" />
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
      }}
    >
      {children}
    </div>
  )
}

export default function App() {
  return (
    <HadrProvider>
      <Shell />
    </HadrProvider>
  )
}
