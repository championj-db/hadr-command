import { useEffect, useRef, useState } from 'react'
import { api, type GenieAnswer } from '../api'

/* Floating "Ask the COP" assistant — a chat bubble wired to the HADR Genie space.
   Genie turns plain-language questions into governed SQL over the operating-picture
   tables and returns a table + short summary; conversation_id threads follow-ups. */

interface Msg {
  role: 'user' | 'assistant'
  question?: string
  answer?: GenieAnswer
  error?: string
}

const SUGGESTED = [
  'Peak cyclone category and lowest pressure?',
  'How many buildings were damaged, broken down by severity?',
  'Which airports have a usable runway right now, showing airport name and how many runways are open?',
  'Which defence units are at surge readiness right now, showing unit name, home base and readiness percentage?',
]

function ResultTable({ a }: { a: GenieAnswer }) {
  if (!a.columns || !a.rows || a.rows.length === 0) return null
  return (
    <div
      style={{
        marginTop: 8,
        border: '1px solid var(--border)',
        borderRadius: 6,
        overflow: 'auto',
        maxHeight: 220,
      }}
    >
      <table className="mono" style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>
        <thead>
          <tr>
            {a.columns.map((c) => (
              <th
                key={c}
                style={{
                  position: 'sticky',
                  top: 0,
                  textAlign: 'left',
                  padding: '6px 9px',
                  background: 'var(--surface-3)',
                  color: 'var(--text-2)',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  borderBottom: '1px solid var(--border-2)',
                }}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {a.rows.map((row, i) => (
            <tr key={i} style={{ background: i % 2 ? 'transparent' : 'var(--surface-2)' }}>
              {row.map((cell, j) => (
                <td
                  key={j}
                  style={{
                    padding: '5px 9px',
                    color: 'var(--text)',
                    whiteSpace: 'nowrap',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  {cell === null ? '—' : String(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Answer({ a }: { a: GenieAnswer }) {
  const [showSql, setShowSql] = useState(false)
  const failed = a.status !== 'COMPLETED'
  return (
    <div>
      {a.text && (
        <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>
          {a.text.split('**').map((seg, j) =>
            j % 2 === 1 ? (
              <b key={j} style={{ fontWeight: 600 }}>
                {seg}
              </b>
            ) : (
              <span key={j}>{seg}</span>
            ),
          )}
        </div>
      )}
      {failed && (
        <div style={{ fontSize: 12.5, color: 'var(--impact)', marginTop: a.text ? 6 : 0 }}>
          {a.error || `Genie could not answer (${a.status}). Try rephrasing.`}
        </div>
      )}
      <ResultTable a={a} />
      {a.row_count > 0 && (
        <div className="micro" style={{ marginTop: 6, color: 'var(--text-3)' }}>
          {a.row_count} row{a.row_count === 1 ? '' : 's'}
          {a.truncated ? ' · showing first 500' : ''}
        </div>
      )}
      {a.sql && (
        <div style={{ marginTop: 8 }}>
          <button
            onClick={() => setShowSql((s) => !s)}
            className="mono"
            style={{
              border: '1px solid var(--border)',
              background: 'var(--surface-2)',
              color: 'var(--text-2)',
              cursor: 'pointer',
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.06em',
              padding: '4px 8px',
              borderRadius: 5,
            }}
          >
            {showSql ? 'HIDE SQL' : 'SHOW SQL'}
          </button>
          {showSql && (
            <pre
              className="mono"
              style={{
                marginTop: 6,
                padding: 10,
                background: 'var(--surface-3)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                fontSize: 11,
                lineHeight: 1.5,
                color: 'var(--text-2)',
                whiteSpace: 'pre-wrap',
                overflowX: 'auto',
              }}
            >
              {a.sql}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

export default function GenieChat() {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [loading, setLoading] = useState(false)
  const convId = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [msgs, loading])

  async function send(q: string) {
    const question = q.trim()
    if (!question || loading) return
    setInput('')
    setMsgs((m) => [...m, { role: 'user', question }])
    setLoading(true)
    try {
      const answer = await api.genie({ question, conversation_id: convId.current })
      convId.current = answer.conversation_id
      setMsgs((m) => [...m, { role: 'assistant', answer }])
    } catch (e: any) {
      setMsgs((m) => [...m, { role: 'assistant', error: String(e?.message ?? e) }])
    } finally {
      setLoading(false)
    }
  }

  function reset() {
    convId.current = null
    setMsgs([])
  }

  return (
    <>
      {/* Chat window */}
      {open && (
        <div
          style={{
            position: 'absolute',
            right: 20,
            bottom: 84,
            width: 420,
            maxHeight: 'calc(100% - 108px)',
            background: 'var(--surface)',
            border: '1px solid var(--border-2)',
            borderRadius: 12,
            zIndex: 73,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            boxShadow: '0 24px 60px -18px rgba(0,0,0,.6)',
            animation: 'hadrDrawerIn .2s cubic-bezier(0.2,0,0,1)',
          }}
        >
          {/* header */}
          <div
            style={{
              flex: 'none',
              padding: '13px 16px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div className="micro" style={{ color: 'var(--accent)' }}>ASK THE COP · GENIE</div>
              <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>HADR Command Data Assistant</div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {msgs.length > 0 && (
                <button
                  onClick={reset}
                  title="New conversation"
                  className="mono"
                  style={{
                    border: '1px solid var(--border)',
                    background: 'var(--surface-2)',
                    color: 'var(--text-3)',
                    cursor: 'pointer',
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: '0.06em',
                    padding: '4px 8px',
                    borderRadius: 5,
                  }}
                >
                  NEW
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 18, padding: '0 4px' }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* messages */}
          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', minHeight: 200 }}>
            {msgs.length === 0 && !loading && (
              <div>
                <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.55 }}>
                  Ask about the cyclone, damage, flooding, force readiness, airfields or warnings —
                  Genie writes governed SQL over the operating-picture tables.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 14 }}>
                  {SUGGESTED.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      style={{
                        textAlign: 'left',
                        border: '1px solid var(--border)',
                        background: 'var(--surface-2)',
                        color: 'var(--text)',
                        cursor: 'pointer',
                        fontSize: 12.5,
                        padding: '8px 11px',
                        borderRadius: 8,
                        lineHeight: 1.35,
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {msgs.map((m, i) =>
              m.role === 'user' ? (
                <div key={i} style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                  <div
                    style={{
                      maxWidth: '82%',
                      background: 'var(--accent)',
                      color: 'var(--on-accent)',
                      fontSize: 13,
                      lineHeight: 1.45,
                      padding: '8px 12px',
                      borderRadius: '12px 12px 3px 12px',
                    }}
                  >
                    {m.question}
                  </div>
                </div>
              ) : (
                <div key={i} style={{ marginBottom: 16 }}>
                  {m.error ? (
                    <div style={{ fontSize: 12.5, color: 'var(--impact)' }}>{m.error}</div>
                  ) : (
                    m.answer && <Answer a={m.answer} />
                  )}
                </div>
              ),
            )}

            {loading && (
              <div
                className="mono"
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', animation: 'hadrLive 1s ease-in-out infinite' }} />
                Genie is querying the COP…
              </div>
            )}
          </div>

          {/* input */}
          <div style={{ flex: 'none', padding: '12px 14px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send(input)}
              placeholder="Ask about TC Jasper…"
              style={{
                flex: 1,
                border: '1px solid var(--border-2)',
                background: 'var(--surface-2)',
                color: 'var(--text)',
                borderRadius: 8,
                padding: '9px 12px',
                fontSize: 13,
                outline: 'none',
                fontFamily: 'inherit',
              }}
            />
            <button
              onClick={() => send(input)}
              disabled={loading || !input.trim()}
              className="mono"
              style={{
                border: 'none',
                cursor: loading || !input.trim() ? 'default' : 'pointer',
                background: 'var(--accent)',
                color: 'var(--on-accent)',
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '0.04em',
                padding: '0 16px',
                borderRadius: 8,
                opacity: loading || !input.trim() ? 0.5 : 1,
              }}
            >
              SEND
            </button>
          </div>

          <div className="micro" style={{ flex: 'none', padding: '0 16px 10px', color: 'var(--text-3)' }}>
            AI-generated SQL — verify figures before release.
          </div>
        </div>
      )}

      {/* Floating bubble */}
      <button
        onClick={() => setOpen((o) => !o)}
        title="Ask the COP"
        style={{
          position: 'absolute',
          right: 20,
          bottom: 20,
          width: 54,
          height: 54,
          borderRadius: '50%',
          border: 'none',
          cursor: 'pointer',
          background: 'var(--accent)',
          color: 'var(--on-accent)',
          zIndex: 74,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 10px 28px -6px rgba(0,0,0,.55)',
        }}
      >
        {open ? (
          <span style={{ fontSize: 20, lineHeight: 1 }}>✕</span>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        )}
      </button>
    </>
  )
}
