import { useState } from 'react'

function App() {
  const [challenge, setChallenge] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadDailyChallenge = async () => {
    setLoading(true)
    setError('')
    try {
      // In dev, assuming proxy or same host port mapping
      const res = await fetch('http://localhost:3000/dev/run-daily', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ userId: 'mock-user-1' })
      })
      
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load challenge')
      
      setChallenge(data.challenge)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: '400px', margin: '0 auto', padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>🌿 Touch Grass</h1>
      
      {!challenge && (
        <div style={{ textAlign: 'center', marginTop: '4rem' }}>
          <p>Ready for today's challenge?</p>
          <button 
            onClick={loadDailyChallenge}
            disabled={loading}
            style={{ padding: '1rem 2rem', fontSize: '1.2rem', background: '#2e7d32', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}
          >
            {loading ? 'Generating...' : 'Get Challenge'}
          </button>
          {error && <p style={{ color: 'red', marginTop: '1rem' }}>{error}</p>}
        </div>
      )}

      {challenge && (
        <div style={{ background: '#f5f5f5', padding: '1.5rem', borderRadius: '12px', marginTop: '2rem' }}>
          <span style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: '#666', fontWeight: 'bold' }}>
            {challenge.category} • Difficulty {challenge.difficulty}/5
          </span>
          <h2 style={{ margin: '0.5rem 0' }}>{challenge.title}</h2>
          <p style={{ lineHeight: '1.5', fontSize: '1.1rem' }}>{challenge.description}</p>
          
          <div style={{ background: '#e8f5e9', padding: '1rem', borderRadius: '8px', marginTop: '1.5rem' }}>
            <strong>Proof: </strong> {challenge.proofRubric}
          </div>

          <div style={{ marginTop: '2rem', display: 'flex', gap: '1rem' }}>
            <button style={{ flex: 1, padding: '1rem', background: '#2e7d32', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
              Done / Prove It
            </button>
            <button style={{ padding: '1rem', background: 'transparent', color: '#666', border: '1px solid #ccc', borderRadius: '8px', cursor: 'pointer' }}>
              Skip Safely
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
