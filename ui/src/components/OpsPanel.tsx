import { useState, type ReactNode } from 'react'
import { useHadr } from '../store'

const microHead: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.16em',
  color: 'var(--text-2)',
}

const POSTURE_DOT: Record<string, string> = {
  baseline: 'var(--text-3)',
  warning: 'var(--warning)',
  response: 'var(--accent)',
  surge: 'var(--impact)',
}

function barColor(p: number) {
  return p >= 85 ? 'var(--recovery)' : p >= 75 ? 'var(--warning)' : 'var(--impact)'
}

/* Collapsible card shell matching the mock (36px header + chevron). */
function Card({
  title,
  right,
  grow,
  children,
}: {
  title: string
  right?: ReactNode
  grow?: boolean
  children: (open: boolean) => ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        overflow: 'hidden',
        flex: grow ? 1 : 'none',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          height: 36,
          flex: 'none',
          border: 'none',
          background: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px 0 14px',
        }}
      >
        <span style={microHead}>{title}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {right}
          <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{open ? '▾' : '▸'}</span>
        </span>
      </button>
      {open && children(open)}
    </div>
  )
}

function deltaStr(cur: number, prev: number | null): { text: string; color: string } {
  if (prev == null || cur === prev) return { text: '', color: 'var(--text-3)' }
  const d = cur - prev
  return { text: `${d > 0 ? '▲' : '▼'} ${Math.abs(d)} since prev`, color: 'var(--text-3)' }
}

export default function OpsPanel() {
  const { kpisAll, tIndex, frame, mode, live, reference } = useHadr()
  const kpis = mode === 'replay' ? kpisAll[String(tIndex)] : null
  const prev = mode === 'replay' ? kpisAll[String(tIndex - 1)] : null
  const units = frame?.readiness?.units ?? []
  const siteName = new Map<string, string>(
    (reference.defence_sites ?? []).map((s: any) => [s.site_id, s.name ?? s.site_id]),
  )
  const warnings = mode === 'live' ? live?.warnings?.warnings ?? [] : frame?.warnings?.warnings ?? []
  const roads = mode === 'live' ? live?.roads?.events ?? [] : frame?.roads?.events ?? []
  const readyCount = kpis?.units_ready ?? units.filter((u: any) => Number(u.readiness_pct) >= 0.85).length
  const activeCount = warnings.length + roads.length

  type Tile = { num: string; label: string; numColor: string; delta: { text: string; color: string } }
  const tiles: Tile[] = kpis
    ? [
        { num: Number(kpis.pop_affected).toLocaleString(), label: 'Population in warning area', numColor: 'var(--text)', delta: deltaColored(kpis.pop_affected, prev?.pop_affected, 'bad') },
        { num: String(kpis.roads_cut), label: 'Roads cut', numColor: 'var(--text)', delta: deltaColored(kpis.roads_cut, prev?.roads_cut, 'bad') },
        { num: `${kpis.runways_open} / 4`, label: 'Runways open', numColor: kpis.runways_open < 2 ? 'var(--warning)' : 'var(--text)', delta: deltaColored(kpis.runways_open, prev?.runways_open, 'good') },
        { num: Number(kpis.buildings_damaged).toLocaleString(), label: 'Buildings damaged', numColor: 'var(--text)', delta: deltaColored(kpis.buildings_damaged, prev?.buildings_damaged, 'bad') },
        { num: `${kpis.units_ready} / 8`, label: 'Units ready', numColor: 'var(--recovery)', delta: deltaColored(kpis.units_ready, prev?.units_ready, 'good') },
        { num: String(kpis.active_warnings), label: 'Warnings active', numColor: 'var(--impact)', delta: deltaColored(kpis.active_warnings, prev?.active_warnings, 'bad') },
      ]
    : [
        { num: String(roads.length), label: 'Road events (live)', numColor: 'var(--text)', delta: deltaStr(0, null) },
        { num: String(warnings.length), label: 'Warnings (live)', numColor: 'var(--impact)', delta: deltaStr(0, null) },
      ]

  return (
    <div
      style={{
        position: 'absolute',
        right: 12,
        top: 12,
        bottom: 12,
        width: 360,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        zIndex: 40,
      }}
    >
      {/* KPI snapshot */}
      <Card title="SITUATION SNAPSHOT">
        {() => (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: kpis ? '1fr 1fr 1fr' : '1fr 1fr',
              gap: 1,
              background: 'var(--border)',
              borderTop: '1px solid var(--border)',
            }}
          >
            {tiles.map((k) => (
              <div key={k.label} style={{ background: 'var(--surface)', padding: '10px 11px 11px' }}>
                <div
                  className="mono"
                  style={{ fontSize: 22, fontWeight: 600, lineHeight: 1, letterSpacing: '-0.01em', color: k.numColor }}
                >
                  {k.num}
                </div>
                <div style={{ fontSize: 9.5, color: 'var(--text-3)', letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 5, lineHeight: 1.25 }}>
                  {k.label}
                </div>
                <div className="mono" style={{ fontSize: 9.5, marginTop: 3, color: k.delta.color, minHeight: 12 }}>
                  {k.delta.text}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Force readiness (replay only) */}
      {mode === 'replay' && (
        <Card
          title="FORCE READINESS"
          right={
            <span className="mono" style={{ fontSize: 10, color: 'var(--recovery)' }}>
              {readyCount}/8 READY
            </span>
          }
        >
          {() => (
            <div style={{ borderTop: '1px solid var(--border)', overflowY: 'auto', maxHeight: 250 }}>
              {units.map((u: any) => {
                const pct = Math.round(Number(u.readiness_pct) * 100)
                const posture = String(u.posture ?? '').toLowerCase()
                return (
                  <div key={u.unit_id} style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>{u.unit_name}</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 'none' }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: POSTURE_DOT[posture] ?? 'var(--text-3)' }} />
                        <span className="mono" style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--text-2)' }}>
                          {posture.toUpperCase()}
                        </span>
                      </span>
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 1 }}>
                      {siteName.get(u.site_id) ?? u.branch}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                      <div style={{ flex: 1, height: 5, background: 'var(--surface-3)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', borderRadius: 3, width: `${pct}%`, background: barColor(pct) }} />
                      </div>
                      <span className="mono" style={{ fontWeight: 600, minWidth: 34, textAlign: 'right', color: barColor(pct), fontSize: 11 }}>
                        {pct}%
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      )}

      {/* Alert feed */}
      <Card
        title="ALERT FEED"
        grow
        right={
          <span
            className="mono"
            style={{ fontSize: 9, fontWeight: 600, color: '#fff', background: 'var(--impact)', padding: '2px 6px', borderRadius: 9 }}
          >
            {activeCount} ACTIVE
          </span>
        }
      >
        {() => (
          <div style={{ borderTop: '1px solid var(--border)', overflowY: 'auto', flex: 1, minHeight: 0 }}>
            {warnings.map((w: any, i: number) => (
              <AlertRow
                key={w.warning_id ?? w.product_id ?? `w${i}`}
                source="BOM"
                srcBg="rgba(63,138,224,.16)"
                srcColor="var(--accent)"
                tag={w.severity ? `${w.severity} · ${w.category ?? ''}`.trim() : w.category}
                glyph="▲"
                glyphColor={i === 0 ? 'var(--impact)' : 'var(--text-3)'}
                headline={w.headline}
                headlineColor={i === 0 ? 'var(--text)' : 'var(--text-2)'}
                rowBg={i === 0 ? 'rgba(238,75,71,.06)' : 'transparent'}
                rowBorder={i === 0 ? '2px solid var(--impact)' : '2px solid transparent'}
              />
            ))}
            {roads.map((r: any, i: number) => {
              const closed = String(r.impact_type ?? '').toLowerCase().includes('closed')
              return (
                <AlertRow
                  key={r.event_id ?? `r${i}`}
                  source="QLDTRAFFIC"
                  srcBg="rgba(242,164,19,.16)"
                  srcColor="var(--warning)"
                  tag={r.event_type ?? r.impact_type}
                  glyph="⏺"
                  glyphColor={closed ? 'var(--road-closed)' : 'var(--road-caution)'}
                  headline={`${r.road_name} — ${r.impact_type ?? r.event_type}${r.segment_desc ? ` (${r.segment_desc})` : ''}`}
                  headlineColor="var(--text-2)"
                  rowBg="transparent"
                  rowBorder="2px solid transparent"
                />
              )
            })}
            {activeCount === 0 && (
              <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text-3)' }}>No active alerts.</div>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}

function deltaColored(cur: any, prev: any, dir: 'good' | 'bad'): { text: string; color: string } {
  if (prev == null || Number(cur) === Number(prev)) return { text: '', color: 'var(--text-3)' }
  const d = Number(cur) - Number(prev)
  const up = d > 0
  // A rise in a "bad" metric is impact-coloured; a rise in a "good" metric is recovery.
  const color = (dir === 'bad') === up ? 'var(--impact)' : 'var(--recovery)'
  return { text: `${up ? '▲' : '▼'} ${Math.abs(d).toLocaleString()}`, color }
}

function AlertRow(p: {
  source: string
  srcBg: string
  srcColor: string
  tag?: string
  glyph: string
  glyphColor: string
  headline: string
  headlineColor: string
  rowBg: string
  rowBorder: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        padding: '10px 14px',
        borderBottom: '1px solid var(--border)',
        background: p.rowBg,
        borderLeft: p.rowBorder,
      }}
    >
      <span style={{ width: 16, height: 16, flex: 'none', marginTop: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: p.glyphColor }}>
        {p.glyph}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 2 }}>
          <span
            className="mono"
            style={{ fontSize: 8.5, fontWeight: 600, letterSpacing: '0.06em', padding: '1px 5px', borderRadius: 3, background: p.srcBg, color: p.srcColor }}
          >
            {p.source}
          </span>
          {p.tag && (
            <span className="mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>
              {p.tag}
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.35, color: p.headlineColor }}>{p.headline}</div>
      </div>
    </div>
  )
}
