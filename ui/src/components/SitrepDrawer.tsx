import { useEffect, useRef, useState } from 'react'
import { api, fmtAest } from '../api'
import { useHadr } from '../store'

interface Section {
  h: string
  body: string
}

/* SITREP prompt asks for numbered sections (1. SITUATION … 5. ASSESSMENT); the
   model wraps them in markdown bold and adds `---` rules — tolerate both. */
function parseSections(text: string): Section[] {
  const lines = text.replace(/\r/g, '').split('\n')
  const out: Section[] = []
  let cur: Section | null = null
  const headRe = /^\s*\*{0,2}\s*\d+\.\s+([A-Za-z][A-Za-z0-9 /&()-]{2,44}?)\s*\*{0,2}\s*:?\s*$/
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    if (/^\s*-{3,}\s*$/.test(line)) continue // markdown horizontal rule
    const m = line.match(headRe)
    if (m && /[A-Za-z]{3,}/.test(m[1])) {
      cur = { h: m[1].trim().toUpperCase(), body: '' }
      out.push(cur)
    } else if (cur) {
      cur.body += (cur.body ? '\n' : '') + line
    } else if (line.trim()) {
      cur = { h: '', body: line }
      out.push(cur)
    }
  }
  return out.map((s) => ({ ...s, body: s.body.trim() })).filter((s) => s.h || s.body)
}

/* Render **bold** inline and preserve line breaks. */
function SitrepBody({ text }: { text: string }) {
  return (
    <div style={{ fontSize: 13, lineHeight: 1.62, color: 'var(--text)' }}>
      {text.split('\n').map((ln, i) => (
        <div key={i} style={{ minHeight: ln.trim() ? undefined : 8 }}>
          {ln.split('**').map((seg, j) =>
            j % 2 === 1 ? (
              <b key={j} style={{ color: 'var(--text)', fontWeight: 600 }}>
                {seg}
              </b>
            ) : (
              <span key={j}>{seg}</span>
            ),
          )}
        </div>
      ))}
    </div>
  )
}

function Shimmer({ w, h, mt }: { w?: string; h: number; mt: number }) {
  return (
    <div
      style={{
        height: h,
        width: w ?? '100%',
        marginTop: mt,
        borderRadius: 3,
        background: 'linear-gradient(90deg,var(--surface-2) 25%,var(--surface-3) 50%,var(--surface-2) 75%)',
        backgroundSize: '400px 100%',
        animation: 'hadrShimmer 1.2s linear infinite',
      }}
    />
  )
}

export default function SitrepDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tIndex, mode, timeline } = useHadr()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ sitrep: string; caveat: string; generated_by: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const genFor = useRef<string>('')

  async function generate() {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      setResult(await api.sitrep(mode === 'live' ? { live: true } : { t_index: tIndex }))
    } catch (e: any) {
      setError(String(e?.message ?? e))
    } finally {
      setLoading(false)
    }
  }

  // Auto-generate when the drawer opens (once per open).
  useEffect(() => {
    if (!open) {
      genFor.current = ''
      return
    }
    const key = `${mode}:${tIndex}`
    if (genFor.current !== key) {
      genFor.current = key
      generate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const sections = result ? parseSections(result.sitrep) : []

  return (
    <>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(4,8,12,.4)', zIndex: 70 }} />
      <div
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: 480,
          background: 'var(--surface)',
          borderLeft: '1px solid var(--border-2)',
          zIndex: 71,
          display: 'flex',
          flexDirection: 'column',
          animation: 'hadrDrawerIn .22s cubic-bezier(0.2,0,0,1)',
          boxShadow: '-16px 0 40px -12px rgba(0,0,0,.55)',
        }}
      >
        {/* header */}
        <div
          style={{
            flex: 'none',
            padding: '16px 18px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div className="micro">SITUATION REPORT</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 3 }}>TC JASPER — FNQ</div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 3 }}>
              {mode === 'live' ? 'LIVE FEEDS' : fmtAest(timeline[tIndex]?.ts_aest)}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 18, padding: '2px 4px' }}
          >
            ✕
          </button>
        </div>

        {/* body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 18px 18px' }}>
          {loading && (
            <div>
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} style={{ marginTop: 18 }}>
                  <Shimmer w="120px" h={11} mt={0} />
                  <Shimmer h={9} mt={10} />
                  <Shimmer w="88%" h={9} mt={7} />
                  <Shimmer w="64%" h={9} mt={7} />
                </div>
              ))}
              <div
                className="mono"
                style={{ marginTop: 22, fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', animation: 'hadrLive 1s ease-in-out infinite' }} />
                Generating brief from live COP state…
              </div>
            </div>
          )}

          {error && !loading && (
            <div style={{ marginTop: 18, color: 'var(--impact)', fontSize: 13 }}>{error}</div>
          )}

          {result && !loading && (
            <div>
              {sections.map((sec, i) => (
                <div key={i} style={{ marginTop: 18 }}>
                  {sec.h && (
                    <div
                      className="mono"
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: '0.14em',
                        color: 'var(--accent)',
                        paddingBottom: 6,
                        borderBottom: '1px solid var(--border)',
                        marginBottom: 8,
                      }}
                    >
                      {sec.h}
                    </div>
                  )}
                  <SitrepBody text={sec.body} />
                </div>
              ))}
              <div
                style={{
                  marginTop: 22,
                  padding: '10px 12px',
                  background: 'rgba(242,164,19,.1)',
                  border: '1px solid rgba(242,164,19,.35)',
                  borderRadius: 6,
                  display: 'flex',
                  gap: 8,
                  alignItems: 'flex-start',
                }}
              >
                <span style={{ color: 'var(--warning)', fontSize: 13, lineHeight: 1.3 }}>▲</span>
                <span style={{ fontSize: 11.5, color: 'var(--warning)', lineHeight: 1.45 }}>
                  {result.caveat || 'Generated by AI — verify against source feeds before release.'}
                  {result.generated_by ? ` · ${result.generated_by}` : ''}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* footer */}
        <div style={{ flex: 'none', padding: '14px 18px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10 }}>
          <button
            onClick={() => {
              if (!result) return
              navigator.clipboard?.writeText(result.sitrep)
              setCopied(true)
              setTimeout(() => setCopied(false), 1600)
            }}
            disabled={!result}
            className="mono"
            style={{
              flex: 1,
              border: '1px solid var(--border-2)',
              cursor: result ? 'pointer' : 'default',
              background: 'var(--surface-2)',
              color: 'var(--text)',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.06em',
              padding: 10,
              borderRadius: 6,
              opacity: result ? 1 : 0.5,
            }}
          >
            {copied ? 'COPIED ✓' : result ? 'COPY' : loading ? 'GENERATING…' : 'REGENERATE'}
          </button>
          <button
            onClick={generate}
            className="mono"
            style={{
              flex: 1,
              border: 'none',
              cursor: 'pointer',
              background: 'var(--accent)',
              color: 'var(--on-accent)',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.06em',
              padding: 10,
              borderRadius: 6,
            }}
          >
            {loading ? 'GENERATING…' : 'REGENERATE'}
          </button>
        </div>
      </div>
    </>
  )
}
