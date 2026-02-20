'use client'

import { useAccount, useConnect, useDisconnect, useBalance } from 'wagmi'
import { useEffect, useState } from 'react'

// Truncate address for display
function truncateAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export function WalletConnect() {
  const { address, isConnected } = useAccount()
  const { connectors, connect, isPending } = useConnect()
  const { disconnect } = useDisconnect()
  const { data: balance } = useBalance({ address })
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
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

  if (!isConnected) {
    return (
      <div style={{ display: 'flex', gap: '8px' }}>
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
          {address && truncateAddress(address)}
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
    </div>
  )
}
