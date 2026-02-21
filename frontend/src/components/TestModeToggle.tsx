'use client'

import { useState, useEffect } from 'react'
import { useAccountContext } from '../context/AccountContext'

export function TestModeToggle() {
  const {
    isTestMode,
    testUser,
    switchTestUser,
    availableTestUsers,
    enableTestMode,
    disableTestMode,
    mounted,
  } = useAccountContext()

  const [localMounted, setLocalMounted] = useState(false)

  useEffect(() => {
    setLocalMounted(true)
  }, [])

  if (!mounted || !localMounted) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}>
        <div style={{
          padding: '4px 12px',
          background: 'rgba(0, 255, 65, 0.1)',
          border: '1px solid var(--phosphor-dim)',
          borderRadius: '2px',
          fontSize: '10px',
        }}>
          Loading...
        </div>
      </div>
    )
  }

  // Test mode is enabled - show user selector
  if (isTestMode && testUser) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}>
        {/* Test mode indicator */}
        <div style={{
          padding: '4px 8px',
          background: 'rgba(255, 176, 0, 0.2)',
          border: '1px solid var(--amber-primary)',
          borderRadius: '2px',
          fontSize: '9px',
          color: 'var(--amber-primary)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          TEST MODE
        </div>

        {/* User selector */}
        <select
          value={testUser.name.toLowerCase()}
          onChange={(e) => switchTestUser(e.target.value)}
          style={{
            padding: '4px 8px',
            background: 'rgba(0, 0, 0, 0.5)',
            border: '1px solid var(--phosphor-dim)',
            borderRadius: '2px',
            color: 'var(--phosphor-primary)',
            fontFamily: 'Share Tech Mono, monospace',
            fontSize: '11px',
            cursor: 'pointer',
          }}
        >
          {Object.entries(availableTestUsers).map(([key, user]) => (
            <option key={key} value={key}>
              {user.name} ({user.address.slice(0, 6)}...{user.address.slice(-4)})
            </option>
          ))}
        </select>

        {/* Disable test mode */}
        <button
          onClick={disableTestMode}
          style={{
            padding: '4px 8px',
            background: 'transparent',
            border: '1px solid var(--text-dim)',
            borderRadius: '2px',
            color: 'var(--text-dim)',
            fontSize: '9px',
            cursor: 'pointer',
            fontFamily: 'Share Tech Mono, monospace',
          }}
        >
          EXIT TEST
        </button>
      </div>
    )
  }

  // Test mode is disabled - show enable button
  return (
    <button
      onClick={enableTestMode}
      style={{
        padding: '4px 12px',
        background: 'rgba(255, 176, 0, 0.1)',
        border: '1px solid var(--amber-dim)',
        borderRadius: '2px',
        color: 'var(--amber-primary)',
        fontSize: '10px',
        cursor: 'pointer',
        fontFamily: 'Share Tech Mono, monospace',
      }}
    >
      ENABLE TEST MODE
    </button>
  )
}
