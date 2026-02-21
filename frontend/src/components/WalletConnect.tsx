'use client'

import { useAccount, useConnect, useDisconnect, useBalance } from 'wagmi'
import { useEffect, useState } from 'react'
import { useAccountContext } from '../context/AccountContext'
import { TestModeToggle } from './TestModeToggle'

// Truncate address for display
function truncateAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export function WalletConnect() {
  const { address: wagmiAddress, isConnected: wagmiConnected } = useAccount()
  const { connectors, connect, isPending } = useConnect()
  const { disconnect } = useDisconnect()
  const { data: balance } = useBalance({ address: wagmiAddress })

  const { isTestMode, testUser, mounted } = useAccountContext()

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
        }}>
          Loading...
        </div>
      </div>
    )
  }

  // Test mode - show test mode toggle (which includes user selector)
  if (isTestMode && testUser) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
      }}>
        {/* Balance (test users have real ETH on Hardhat) */}
        <div style={{
          fontSize: '10px',
          color: 'var(--text-secondary)',
        }}>
          10000.0 ETH
        </div>

        {/* Test user indicator */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '4px 12px',
          background: 'rgba(255, 176, 0, 0.1)',
          border: '1px solid var(--amber-dim)',
          borderRadius: '2px',
        }}>
          <span className="status-dot online" style={{ marginLeft: 0 }} />
          <span style={{
            fontSize: '11px',
            color: 'var(--amber-primary)',
            fontFamily: 'Share Tech Mono, monospace',
          }}>
            {testUser.name} ({truncateAddress(testUser.address)})
          </span>
        </div>

        <TestModeToggle />
      </div>
    )
  }

  // Not in test mode - show regular wallet connect or toggle
  if (!wagmiConnected) {
    return (
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        {connectors.map((connector) => (
          <button
            key={connector.uid}
            onClick={() => connect({ connector })}
            disabled={isPending}
            className="btn-terminal"
            style={{
              fontSize: '11px',
              padding: '6px 12px',
              opacity: isPending ? 0.5 : 1,
            }}
          >
            {isPending ? 'CONNECTING...' : 'CONNECT WALLET'}
          </button>
        ))}
        <TestModeToggle />
      </div>
    )
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
    }}>
      {/* Balance */}
      {balance && (
        <div style={{
          fontSize: '10px',
          color: 'var(--text-secondary)',
        }}>
          {parseFloat(balance.formatted).toFixed(4)} ETH
        </div>
      )}

      {/* Address */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '4px 12px',
        background: 'rgba(0, 255, 65, 0.1)',
        border: '1px solid var(--phosphor-dim)',
        borderRadius: '2px',
      }}>
        <span className="status-dot online" style={{ marginLeft: 0 }} />
        <span style={{
          fontSize: '11px',
          color: 'var(--phosphor-primary)',
          fontFamily: 'Share Tech Mono, monospace',
        }}>
          {wagmiAddress && truncateAddress(wagmiAddress)}
        </span>
      </div>

      {/* Disconnect */}
      <button
        onClick={() => disconnect()}
        className="btn-terminal"
        style={{
          fontSize: '10px',
          padding: '4px 8px',
        }}
      >
        DISCONNECT
      </button>

      <TestModeToggle />
    </div>
  )
}
