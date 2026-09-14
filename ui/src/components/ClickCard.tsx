import { useHadr } from '../store'

const STATUS_COLOR: Record<string, string> = {
  open: 'var(--recovery)',
  limited: 'var(--warning)',
  closed: 'var(--impact)',
}

const microLabel: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 9.5,
  fontWeight: 600,
  letterSpacing: '0.14em',
  color: 'var(--text-3)',
}

export default function ClickCard() {
  const { selection, setSelection, reference } = useHadr()
  if (!selection) return null
  const d = selection.data

  const accent =
    selection.kind === 'airport'
      ? STATUS_COLOR[d.runway_status?.status ?? 'open'] ?? 'var(--recovery)'
      : selection.kind === 'road'
        ? 'var(--road-closed)'
        : selection.kind === 'building'
          ? 'var(--d-severe)'
          : 'var(--accent)'

  const width = selection.kind === 'airport' ? 412 : 288

  return (
    <div
      style={{
        position: 'absolute',
        top: 20,
        left: 340,
        width,
        background: 'var(--surface)',
        border: '1px solid var(--border-2)',
        borderRadius: 9,
        zIndex: 55,
        boxShadow: '0 12px 32px -8px rgba(0,0,0,.6)',
        animation: 'hadrCardIn .18s ease-out',
        overflow: 'hidden',
      }}
    >
      <div style={{ borderTop: `3px solid ${accent}` }} />
      <div style={{ padding: '14px 16px 16px', position: 'relative' }}>
        <button
          onClick={() => setSelection(null)}
          style={{ position: 'absolute', top: 12, right: 12, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 16, lineHeight: 1, padding: '2px 4px' }}
        >
          ✕
        </button>

        {selection.kind === 'airport' && <AirportCard d={d} aircraft={reference.aircraft_specs ?? []} runways={reference.runways ?? []} />}
        {selection.kind === 'site' && <SiteCard d={d} />}
        {selection.kind === 'building' && <BuildingCard d={d} />}
        {selection.kind === 'road' && <RoadCard d={d} />}
      </div>
    </div>
  )
}

function Badge({ color, bg, children }: { color: string; bg: string; children: React.ReactNode }) {
  return (
    <div
      className="mono"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        marginTop: 11,
        padding: '6px 11px',
        borderRadius: 6,
        fontSize: 11.5,
        fontWeight: 600,
        letterSpacing: '0.04em',
        background: bg,
        color,
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
      {children}
    </div>
  )
}

function AirportCard({ d, aircraft, runways }: { d: any; aircraft: any[]; runways: any[] }) {
  const st = d.runway_status
  const status = st?.status ?? 'open'
  const color = STATUS_COLOR[status] ?? 'var(--recovery)'
  const bg = status === 'open' ? 'rgba(55,185,107,.16)' : status === 'limited' ? 'rgba(242,164,19,.16)' : 'rgba(238,75,71,.18)'
  const usable: string[] = st?.usable_by ?? []
  const rwy = runways.find((r: any) => r.airport_ident === d.ident && !r.closed) ?? runways.find((r: any) => r.airport_ident === d.ident)
  const lengthM = rwy ? Math.round(Number(rwy.length_m ?? Number(rwy.length_ft) * 0.3048)) : null
  const lat = Number(d.lat ?? d.latitude_deg)
  const lon = Number(d.lon ?? d.longitude_deg)

  return (
    <>
      <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '0.01em', paddingRight: 20 }}>
        {d.ident} — {d.name}
      </div>
      {Number.isFinite(lat) && (
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
          {lat.toFixed(4)}°, {lon.toFixed(4)}°
        </div>
      )}
      <Badge color={color} bg={bg}>
        {status.toUpperCase()}
        {st?.reason ? ` — ${st.reason}` : ''}
      </Badge>

      {rwy && (
        <div
          className="mono"
          style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', letterSpacing: '0.02em' }}
        >
          RWY {rwy.runway_ident ?? `${rwy.le_ident}/${rwy.he_ident}`}
          {lengthM ? ` · ${lengthM.toLocaleString()} m` : ''}
          {rwy.surface ? ` · ${rwy.surface}` : ''}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <div style={{ ...microLabel, marginBottom: 7 }}>SUITABILITY — GO / NO-GO</div>
        {aircraft
          .filter((a: any) => a.aircraft_type !== 'MRH-90')
          .map((a: any) => {
            const go = status !== 'closed' && (usable.length === 0 || usable.includes(a.aircraft_type))
            return (
              <div
                key={a.aircraft_type}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 6, marginBottom: 4, background: 'var(--surface-2)' }}
              >
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600 }}>{a.aircraft_type}</span>
                <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
                  req {Number(a.min_runway_m).toLocaleString()} m
                </span>
                <span
                  style={{
                    width: 20,
                    height: 20,
                    flex: 'none',
                    borderRadius: 4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    fontWeight: 700,
                    background: go ? 'rgba(55,185,107,.16)' : 'rgba(238,75,71,.16)',
                    color: go ? 'var(--recovery)' : 'var(--impact)',
                  }}
                >
                  {go ? '✓' : '✕'}
                </span>
              </div>
            )
          })}
      </div>

      {d.ident === 'YBCS' && status !== 'open' && (
        <div
          style={{ marginTop: 11, padding: '9px 11px', background: 'var(--surface-2)', borderRadius: 6, fontSize: 11.5, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 7 }}
        >
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--recovery)', flex: 'none' }} />
          YBTL Townsville <b style={{ color: 'var(--recovery)', fontWeight: 600 }}>&nbsp;OPEN&nbsp;</b> — designated staging base
        </div>
      )}
    </>
  )
}

function SiteCard({ d }: { d: any }) {
  const r = d.readiness
  const pct = r ? Math.round(Number(r.readiness_pct) * 100) : null
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, paddingRight: 20 }}>
        <span style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--surface-2)', border: '1px solid var(--border-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>⚓</span>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{d.name}</span>
      </div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>
        {[d.service, d.role].filter(Boolean).join(' — ')}
      </div>
      {r ? (
        <>
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>
            <b style={{ color: 'var(--text)' }}>Readiness:</b>{' '}
            <span style={{ color: 'var(--recovery)', fontWeight: 600 }}>
              {pct}% · {String(r.posture).toUpperCase()}
            </span>
          </div>
          {r.assets && (
            <div style={{ marginTop: 8 }}>
              {Object.entries(r.assets).map(([k, v]: [string, any]) => (
                <Row key={k} k={k.replace(/_/g, ' ')} v={`${(v.available ?? 0) - (v.tasked ?? 0)} avail / ${v.tasked ?? 0} tasked`} />
              ))}
            </div>
          )}
        </>
      ) : (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-3)' }}>No unit readiness data at this tick.</div>
      )}
    </>
  )
}

function BuildingCard({ d }: { d: any }) {
  const dmg = String(d.damage ?? 'none').toLowerCase()
  const color = ({ minor: 'var(--d-minor)', moderate: 'var(--d-moderate)', severe: 'var(--d-severe)', destroyed: 'var(--d-destroyed)' } as any)[dmg] ?? 'var(--d-none)'
  return (
    <>
      <div style={{ fontSize: 14, fontWeight: 700, paddingRight: 20 }}>Structure {String(d.id).slice(0, 12)}</div>
      <div
        className="mono"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 10, padding: '5px 10px', borderRadius: 6, background: 'rgba(238,75,71,.16)', color, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em' }}
      >
        <span style={{ width: 9, height: 9, background: color, transform: 'rotate(45deg)' }} />
        {dmg.toUpperCase()} DAMAGE
      </div>
      <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>
        <b style={{ color: 'var(--text)' }}>Height:</b> {d.height} m
      </div>
    </>
  )
}

function RoadCard({ d }: { d: any }) {
  const closed = String(d.impact_type ?? '').toLowerCase().includes('closed')
  const color = closed ? 'var(--road-closed)' : 'var(--road-caution)'
  return (
    <>
      <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.2, paddingRight: 20 }}>{d.road_name}</div>
      {(d.segment_desc || d.locality) && (
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{d.segment_desc ?? d.locality}</div>
      )}
      <div
        className="mono"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 11, padding: '5px 10px', borderRadius: 6, background: closed ? 'rgba(238,75,71,.16)' : 'rgba(242,164,19,.16)', color, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em' }}
      >
        {String(d.impact_type ?? d.event_type ?? '').toUpperCase()}
      </div>
      <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>
        <b style={{ color: 'var(--text)' }}>Type:</b> {d.event_type ?? '—'}
      </div>
    </>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0' }}>
      <span style={{ color: 'var(--text-3)' }}>{k}</span>
      <span style={{ fontWeight: 600 }}>{v}</span>
    </div>
  )
}
