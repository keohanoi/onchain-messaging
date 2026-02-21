'use client'

import { useState, useEffect } from 'react'

export default function TestIPFS() {
  const [status, setStatus] = useState('Testing...')
  const [error, setError] = useState<string | null>(null)
  const [cid, setCid] = useState<string | null>(null)

  useEffect(() => {
    const test = async () => {
      try {
        setStatus('Connecting to IPFS...')
        
        const formData = new FormData()
        formData.append('file', new Blob(['test from browser']))
        
        const response = await fetch('http://localhost:5001/api/v0/add', {
          method: 'POST',
          body: formData
        })
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }
        
        const result = await response.json()
        setCid(result.Hash)
        setStatus('SUCCESS!')
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setStatus('FAILED')
      }
    }
    
    test()
  }, [])

  return (
    <div style={{ padding: 40, fontFamily: 'monospace' }}>
      <h1>IPFS Connection Test</h1>
      <p>Status: <strong>{status}</strong></p>
      {error && <p style={{ color: 'red' }}>Error: {error}</p>}
      {cid && <p style={{ color: 'green' }}>CID: {cid}</p>}
    </div>
  )
}
