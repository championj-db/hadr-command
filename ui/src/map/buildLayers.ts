/* Declarative layer registry: frame state + toggles -> deck.gl layers.
   Colours are the exact map_layers_rgba values from the Claude Design tokens. */
import { GeoJsonLayer, PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import { H3HexagonLayer, TerrainLayer } from '@deck.gl/geo-layers'
import { HexagonLayer } from '@deck.gl/aggregation-layers'
import { PathStyleExtension } from '@deck.gl/extensions'
import type { Layer, PickingInfo } from '@deck.gl/core'
import type { LayerToggles, Selection } from '../store'

// tokens.map_layers_rgba.building_damage_3d
export const DAMAGE_COLORS: Record<string, [number, number, number, number]> = {
  none: [122, 135, 148, 200],
  minor: [232, 192, 46, 220],
  moderate: [242, 133, 31, 230],
  severe: [238, 75, 71, 240],
  destroyed: [179, 42, 134, 245],
}

const TRACK_RED: [number, number, number, number] = [238, 75, 71, 255]
const CONE_FILL: [number, number, number, number] = [238, 75, 71, 26]
const CONE_LINE: [number, number, number, number] = [238, 75, 71, 90]
const FLOOD_FILL: [number, number, number, number] = [47, 128, 237, 56]
const FLOOD_LINE: [number, number, number, number] = [90, 162, 224, 180]
const RAIN_FILL: [number, number, number, number] = [20, 184, 166, 120]
const RAIN_LINE: [number, number, number, number] = [20, 184, 166, 220]
const DEFENCE_BASE: [number, number, number, number] = [232, 238, 244, 255]

// tokens.map_layers_rgba.wind_field.ramp — single-hue sequential violet, light→intense.
const WIND_RAMP: Array<[number, number, number, number]> = [
  [214, 209, 245, 60],
  [168, 158, 224, 120],
  [139, 127, 214, 180],
  [108, 94, 196, 220],
]
function windColor(gust: number): [number, number, number, number] {
  const x = Math.min(Math.max((gust - 20) / 60, 0), 1)
  return WIND_RAMP[Math.min(WIND_RAMP.length - 1, Math.floor(x * WIND_RAMP.length))]
}

interface BuildArgs {
  frame: Record<string, any> | null
  toggles: LayerToggles
  buildings: GeoJSON.FeatureCollection | null
  damageState: Map<string, string> | undefined
  reference: Record<string, any[]>
  tIndex: number
  mode: 'replay' | 'live'
  live: any
  onSelect: (s: Selection | null) => void
}

const num = (v: any) => (v == null ? null : Number(v))
const pos = (d: any): [number, number] => [Number(d.lon ?? d.longitude_deg), Number(d.lat ?? d.latitude_deg)]

export function buildLayers(a: BuildArgs): Layer[] {
  const layers: (Layer | false | null)[] = []
  const f = a.frame

  if (a.toggles.terrain) {
    layers.push(
      new TerrainLayer({
        id: 'terrain',
        minZoom: 0,
        maxZoom: 12,
        elevationDecoder: { rScaler: 256, gScaler: 1, bScaler: 1 / 256, offset: -32768 },
        elevationData: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
        texture: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        operation: 'terrain+draw',
      }),
    )
  }

  // --- Hazard ---
  if (a.toggles.flood && f?.flood?.geojson) {
    layers.push(
      new GeoJsonLayer({
        id: 'flood',
        data: { type: 'Feature', geometry: f.flood.geojson, properties: {} } as any,
        filled: true,
        stroked: true,
        getFillColor: FLOOD_FILL,
        getLineColor: FLOOD_LINE,
        getLineWidth: 1.5,
        lineWidthUnits: 'pixels',
      }),
    )
  }

  if (a.toggles.wind && f?.wind?.cells?.length) {
    layers.push(
      new H3HexagonLayer({
        id: 'wind',
        data: f.wind.cells,
        getHexagon: (d: any) => d.h3,
        filled: true,
        extruded: false,
        stroked: false,
        getFillColor: (d: any) => windColor(Number(d.gust_kt)),
        updateTriggers: { getFillColor: a.tIndex },
      }),
    )
  }

  if (a.toggles.rain && f?.rain?.stations?.length) {
    layers.push(
      new ScatterplotLayer({
        id: 'rain',
        data: f.rain.stations,
        getPosition: pos,
        getRadius: (d: any) => 500 + Number(d.rain_cum_mm ?? 0) * 3,
        radiusUnits: 'meters',
        getFillColor: RAIN_FILL,
        stroked: true,
        getLineColor: RAIN_LINE,
        lineWidthMinPixels: 1,
      }),
    )
  }

  if (a.toggles.track && f?.track) {
    if (f.track.cone?.length)
      layers.push(
        new PolygonLayer({
          id: 'cone',
          data: [{ ring: f.track.cone }],
          getPolygon: (d: any) => d.ring,
          filled: true,
          stroked: true,
          getFillColor: CONE_FILL,
          getLineColor: CONE_LINE,
          getLineWidth: 1.5,
          lineWidthUnits: 'pixels',
        }),
      )
    if (f.track.track_so_far?.length > 1)
      layers.push(
        new PathLayer({
          id: 'track',
          data: [{ path: f.track.track_so_far }],
          getPath: (d: any) => d.path,
          getColor: TRACK_RED,
          getWidth: 3,
          widthUnits: 'pixels',
          // Subtle dashed track per tokens (dash [10,9]); no marching-ants animation.
          getDashArray: [10, 9],
          dashJustified: true,
          extensions: [new PathStyleExtension({ dash: true })],
        }),
      )
    if (f.track.current)
      layers.push(
        new ScatterplotLayer({
          id: 'cyclone-eye',
          data: [f.track.current],
          getPosition: pos,
          getRadius: (d: any) => Math.max(Number(d.rmw_km ?? 30) * 1000, 8000),
          radiusUnits: 'meters',
          filled: true,
          getFillColor: [238, 75, 71, 60],
          stroked: true,
          getLineColor: TRACK_RED,
          lineWidthMinPixels: 2,
        }),
        new TextLayer({
          id: 'cyclone-label',
          data: [f.track.current],
          getPosition: pos,
          getText: (d: any) => `TC JASPER CAT ${d.category ?? '?'}`,
          getSize: 14,
          getColor: [255, 255, 255, 255],
          getPixelOffset: [0, -24],
          fontFamily: 'ui-monospace, monospace',
        }),
      )
  }

  // --- Impact ---
  if (a.toggles.buildings && a.buildings) {
    layers.push(
      new GeoJsonLayer({
        id: 'buildings',
        data: a.buildings as any,
        extruded: true,
        wireframe: false,
        filled: true,
        getElevation: (d: any) => Number(d.properties?.h ?? 4),
        getFillColor: (d: any) =>
          DAMAGE_COLORS[a.damageState?.get(String(d.id)) ?? 'none'],
        pickable: true,
        onClick: (info: PickingInfo) =>
          info.object &&
          a.onSelect({
            kind: 'building',
            data: {
              id: info.object.id,
              height: info.object.properties?.h,
              damage: a.damageState?.get(String(info.object.id)) ?? 'none',
            },
          }),
        updateTriggers: { getFillColor: a.tIndex },
      }),
    )
  }

  if (a.toggles.hexDensity && a.damageState && a.buildings) {
    const damaged = a.buildings.features.filter(
      (ft) => (a.damageState!.get(String(ft.id)) ?? 'none') !== 'none',
    )
    layers.push(
      new HexagonLayer({
        id: 'damage-hex',
        data: damaged,
        getPosition: (ft: any) => centroidOf(ft),
        radius: 400,
        extruded: true,
        elevationScale: 12,
        opacity: 0.5,
        updateTriggers: { getPosition: a.tIndex },
      }),
    )
  }

  // --- Infrastructure / roads ---
  const roadEvents = a.mode === 'live' ? a.live?.roads?.events : f?.roads?.events
  if (a.toggles.roads && roadEvents?.length) {
    layers.push(
      new ScatterplotLayer({
        id: 'roads',
        data: roadEvents.filter((e: any) => e.lat != null),
        getPosition: pos,
        getRadius: 120,
        radiusUnits: 'meters',
        radiusMinPixels: 4,
        radiusMaxPixels: 10,
        getFillColor: (d: any) =>
          (d.impact_type ?? '').toLowerCase().includes('closed')
            ? [238, 75, 71, 255]
            : [242, 164, 19, 255],
        stroked: true,
        getLineColor: [255, 255, 255, 200],
        lineWidthMinPixels: 1,
        pickable: true,
        onClick: (info: PickingInfo) =>
          info.object && a.onSelect({ kind: 'road', data: info.object }),
      }),
    )
  }

  // --- Estate + airports ---
  if (a.toggles.estate && a.reference.defence_sites?.length) {
    const readiness = new Map<string, any>(
      (f?.readiness?.units ?? []).map((u: any) => [u.site_id, u]),
    )
    const sites = a.reference.defence_sites.filter(
      (s: any) => String(s.on_map ?? 'true').toLowerCase() !== 'false',
    )
    layers.push(
      new ScatterplotLayer({
        id: 'estate',
        data: sites,
        getPosition: pos,
        getRadius: 200,
        radiusUnits: 'meters',
        radiusMinPixels: 6,
        radiusMaxPixels: 14,
        getFillColor: (d: any) => {
          const r = num(readiness.get(d.site_id)?.readiness_pct)
          if (r == null) return DEFENCE_BASE
          return r >= 0.85 ? [55, 185, 107, 230] : r >= 0.75 ? [242, 164, 19, 230] : [238, 75, 71, 230]
        },
        stroked: true,
        getLineColor: [255, 255, 255, 255],
        lineWidthMinPixels: 2,
        pickable: true,
        onClick: (info: PickingInfo) =>
          info.object &&
          a.onSelect({
            kind: 'site',
            data: { ...info.object, readiness: readiness.get(info.object.site_id) ?? null },
          }),
        updateTriggers: { getFillColor: a.tIndex },
      }),
      new TextLayer({
        id: 'estate-labels',
        data: sites,
        getPosition: pos,
        getText: (d: any) => String(d.name ?? d.site_id),
        getSize: 12,
        getColor: [226, 232, 240, 255],
        getPixelOffset: [0, -18],
      }),
    )
  }

  if (a.toggles.airports && a.reference.airports?.length) {
    const status = new Map<string, any>(
      (f?.runways?.airports ?? []).map((r: any) => [r.airport_ident, r]),
    )
    layers.push(
      new ScatterplotLayer({
        id: 'airports',
        data: a.reference.airports,
        getPosition: pos,
        getRadius: 300,
        radiusUnits: 'meters',
        radiusMinPixels: 7,
        radiusMaxPixels: 16,
        getFillColor: (d: any) => {
          const s = status.get(d.ident)?.status
          return s === 'closed' ? [238, 75, 71, 255] : s === 'limited' ? [242, 164, 19, 255] : [55, 185, 107, 255]
        },
        stroked: true,
        getLineColor: [15, 23, 42, 255],
        lineWidthMinPixels: 2,
        pickable: true,
        onClick: (info: PickingInfo) =>
          info.object &&
          a.onSelect({
            kind: 'airport',
            data: { ...info.object, runway_status: status.get(info.object.ident) ?? null },
          }),
        updateTriggers: { getFillColor: a.tIndex },
      }),
    )
  }

  return layers.filter(Boolean) as Layer[]
}

function centroidOf(ft: any): [number, number] {
  let ring = ft.geometry?.coordinates?.[0]
  if (ft.geometry?.type === 'MultiPolygon') ring = ft.geometry.coordinates[0][0]
  if (!ring?.length) return [0, 0]
  let x = 0
  let y = 0
  for (const c of ring) {
    x += c[0]
    y += c[1]
  }
  return [x / ring.length, y / ring.length]
}
