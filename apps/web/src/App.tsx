import { useEffect, useRef, useState } from 'react'
import './App.css'

type Challenge = { id: string; title: string; description: string; category: string; difficulty: number; estimatedMinutes: number; proofType: string; proofRubric: string; safetyNotes: string | null; audioUrl?: string | null }
type Screen = 'welcome' | 'challenge' | 'proof' | 'complete' | 'skipped'
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

function App() {
  const [screen, setScreen] = useState<Screen>('welcome')
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const getChallenge = async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch(`${API_URL}/dev/run-daily`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 'mock-user-1' }) })
      const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Could not create a challenge')
      setChallenge(data.challenge); setScreen('challenge')
    } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong. Try again.') } finally { setLoading(false) }
  }
  const complete = async () => {
    if (!challenge) return
    setLoading(true); setError('')
    try {
      const res = await fetch(`${API_URL}/dev/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challengeId: challenge.id, proofType: challenge.proofType, fileName: file?.name }) })
      const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Verification failed')
      setScreen('complete')
    } catch (e) { setError(e instanceof Error ? e.message : 'Verification failed') } finally { setLoading(false) }
  }
  const speak = () => { if (challenge && 'speechSynthesis' in window) window.speechSynthesis.speak(new SpeechSynthesisUtterance(`${challenge.title}. ${challenge.description}`)) }
  useEffect(() => () => window.speechSynthesis?.cancel(), [])

  return <main className="app-shell">
    <header className="topbar"><div className="brand"><b>✦</b> touch<span>grass</span></div><div className="streak">☀ 0 day streak</div></header>
    <section className="content"><div className="eyebrow">A small reason to step outside</div>
      {screen === 'welcome' && <section className="welcome panel"><div className="sun">☼</div><h1>Put your phone down.<br /><em>Find your world.</em></h1><p className="lede">One thoughtful outdoor challenge, made for your day. No feeds. No pressure. Just a little more life.</p><button className="primary" onClick={getChallenge} disabled={loading}>{loading ? 'Finding your challenge…' : <>Give me a challenge <b>→</b></>}</button><small>Takes 5–20 minutes · You can always skip</small>{error && <div className="error">{error}</div>}</section>}
      {screen === 'challenge' && challenge && <section className="challenge"><div className="meta"><span>{challenge.category}</span><span>{challenge.estimatedMinutes} min</span><span>{'●'.repeat(challenge.difficulty)}{'○'.repeat(5 - challenge.difficulty)}</span></div><h1>{challenge.title}</h1><p className="description">{challenge.description}</p>{challenge.safetyNotes && <div className="safety">♡ <span><b>Keep it easy</b><br />{challenge.safetyNotes}</span></div>}<div className="actions"><button className="primary" onClick={() => setScreen('proof')}>I’m ready <b>→</b></button><button className="sound" onClick={speak}>🔊</button></div><button className="quiet" onClick={() => setScreen('skipped')}>Not today — skip safely</button></section>}
      {screen === 'proof' && challenge && <section className="panel proof"><button className="back" onClick={() => setScreen('challenge')}>← Back</button><div className="eyebrow">LAST STEP</div><h1>Show yourself<br /><em>you did it.</em></h1><p className="lede">{challenge.proofRubric}</p>{challenge.proofType === 'photo' || challenge.proofType === 'strava_screenshot' ? <><input ref={input} hidden type="file" accept="image/*" capture="environment" onChange={e => setFile(e.target.files?.[0] || null)} /><button className="upload" onClick={() => input.current?.click()}><strong>{file ? `✓ ${file.name}` : '＋ Add a photo'}</strong><small>{file ? 'Ready to submit' : 'A quick snapshot is enough'}</small></button></> : <div className="trust">You know what counts. We trust you.</div>}{error && <div className="error">{error}</div>}<button className="primary full" disabled={loading || (challenge.proofType === 'photo' && !file)} onClick={complete}>{loading ? 'Checking…' : 'Complete challenge ✓'}</button></section>}
      {(screen === 'complete' || screen === 'skipped') && <section className="panel result"><div className="result-icon">{screen === 'complete' ? '✦' : '○'}</div><div className="eyebrow">{screen === 'complete' ? 'CHALLENGE COMPLETE' : 'NO GUILT, EVER'}</div><h1>{screen === 'complete' ? <>That was<br /><em>worth it.</em></> : <>Maybe<br /><em>tomorrow.</em></>}</h1><p className="lede">{screen === 'complete' ? 'You made a little room for the real world today.' : 'Rest is part of taking care of yourself too.'}</p><button className="primary" onClick={() => { setChallenge(null); setFile(null); setScreen('welcome') }}>Back home <b>→</b></button></section>}
    </section><footer>DESIGNED FOR REAL LIFE　·　NOTHING TO PROVE</footer>
  </main>
}
export default App
