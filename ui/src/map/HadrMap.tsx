import { useEffect, useMemo } from 'react'
import DeckGL from '@deck.gl/react'
import { Map as MapLibreMap } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useHadr } from '../store'
import { buildLayers } from './buildLayers'
import { useMapView } from './viewState'

const SATELLITE_STYLE = {
  version: 8 as const,
  sources: {
    esri: {
      type: 'raster' as const,
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: 'Esri World Imagery',
    },
  },
  layers: [{ id: 'esri', type: 'raster' as const, source: 'esri' }],
}

// Dark basemap alternative (kept dark in both UI themes per tokens note).
const DARK_STYLE = {
  version: 8 as const,
  sources: {
    carto: {
      type: 'raster' as const,
      tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© CARTO © OpenStreetMap',
    },
  },
  layers: [
    { id: 'bg', type: 'background' as const, paint: { 'background-color': '#0a0f16' } },
    { id: 'carto', type: 'raster' as const, source: 'carto' },
  ],
}

export const VIEWS: Record<string, { longitude: number; latitude: number; zoom: number; pitch: number; bearing: number }> = {
  FNQ: { longitude: 145.6, latitude: -16.6, zoom: 7.2, pitch: 40, bearing: 0 },
  Cairns: { longitude: 145.755, latitude: -16.92, zoom: 11.8, pitch: 52, bearing: -15 },
  Airport: { longitude: 145.752, latitude: -16.877, zoom: 13.2, pitch: 55, bearing: -25 },
  Townsville: { longitude: 146.77, latitude: -19.28, zoom: 10.5, pitch: 45, bearing: 0 },
}

export default function HadrMap({
  view,
  basemap = 'satellite',
  pitch3d = true,
}: {
  view: string
  basemap?: 'satellite' | 'dark'
  pitch3d?: boolean
}) {
  const { frame, toggles, buildings, damageStates, tIndex, reference, mode, live, setSelection } = useHadr()
  const { viewState, setViewState } = useMapView()

  // Fly on preset change (respecting current pitch mode).
  useEffect(() => {
    const preset = VIEWS[view] ?? VIEWS.Cairns
    setViewState({ ...preset, pitch: pitch3d ? preset.pitch : 0, transitionDuration: 1200 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  // Flatten / restore pitch on toggle.
  useEffect(() => {
    setViewState((vs) => ({ ...vs, pitch: pitch3d ? VIEWS[view]?.pitch ?? 45 : 0, transitionDuration: 400 }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pitch3d])

  const layers = useMemo(
    () =>
      buildLayers({
        frame,
        toggles,
        buildings,
        damageState: damageStates[tIndex],
        reference,
        tIndex,
        mode,
        live,
        onSelect: setSelection,
      }),
    [frame, toggles, buildings, damageStates, tIndex, reference, mode, live, setSelection],
  )

  return (
    // Suppress the browser context menu so right-drag rotates cleanly
    // (deck.gl MapController has dragRotate on by default; ctrl-drag also rotates).
    <div onContextMenu={(e) => e.preventDefault()} style={{ position: 'absolute', inset: 0 }}>
      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState: vs }: any) => setViewState(vs)}
        controller={{ dragRotate: true }}
        layers={layers}
        style={{ position: 'absolute', inset: '0' }}
      >
        <MapLibreMap mapStyle={(basemap === 'dark' ? DARK_STYLE : SATELLITE_STYLE) as any} />
      </DeckGL>
    </div>
  )
}
