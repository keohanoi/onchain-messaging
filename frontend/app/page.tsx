'use client'

import { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { WalletConnect } from '../src/components/WalletConnect'

// Generate random hex only on client side
const randomHex = (length: number) =>
  Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join('')

const randomTag = () =>
  `0x${Math.floor(Math.random() * 256).toString(16).padStart(2, '0')}`

// Types
interface Message {
  id: string
  content: string
  timestamp: number
  sender: 'me' | 'them'
  nullifier: string
  viewTag: string
  stealthAddress: string
  proofVerified: boolean
  encrypted: boolean
}

interface Conversation {
  id: string
  name: string
  stealthSpendingKey: string
  lastMessage: string
  unread: number
  online: boolean
  viewTag: string
}

// Mock Data - Use static timestamps to avoid hydration mismatch
const BASE_TIME = 1700000000000 // Fixed base timestamp

const mockConversations: Conversation[] = [
  {
    id: '1',
    name: '0x7a3d...f291',
    stealthSpendingKey: '0x7a3d8cf291e4b6a0c3d7e8f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1',
    lastMessage: 'Encrypted message received',
    unread: 2,
    online: true,
    viewTag: '0xa7',
  },
  {
    id: '2',
    name: '0x4b2e...91c4',
    stealthSpendingKey: '0x4b2e91c4f8a3b5d7e1c9f0a2b4c6d8e0f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c1',
    lastMessage: 'See you at the rendezvous',
    unread: 0,
    online: false,
    viewTag: '0x3f',
  },
  {
    id: '3',
    name: '0x9f1c...d45a',
    stealthSpendingKey: '0x9f1cd45ab8e7c3a9f0d2b4c6e8a0f1d3b5c7e9a1f3d5b7c9e1a3f5d7b9c1e3a',
    lastMessage: 'Keys rotated successfully',
    unread: 1,
    online: true,
    viewTag: '0x82',
  },
]

const mockMessages: Message[] = [
  {
    id: '1',
    content: 'Establishing secure channel...',
    timestamp: BASE_TIME - 3600000,
    sender: 'me',
    nullifier: '0x8f3a2b1c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2',
    viewTag: '0xa7',
    stealthAddress: '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1',
    proofVerified: true,
    encrypted: false,
  },
  {
    id: '2',
    content: 'Channel established. X3DH complete. Session key derived.',
    timestamp: BASE_TIME - 3500000,
    sender: 'them',
    nullifier: '0x2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3',
    viewTag: '0xa7',
    stealthAddress: '0x2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c',
    proofVerified: true,
    encrypted: true,
  },
  {
    id: '3',
    content: 'The package will arrive at coordinates 47.3769° N, 8.5417° E. Confirmation code: SIGMA-7.',
    timestamp: BASE_TIME - 1800000,
    sender: 'them',
    nullifier: '0x3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4',
    viewTag: '0xa7',
    stealthAddress: '0x3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c3',
    proofVerified: true,
    encrypted: true,
  },
  {
    id: '4',
    content: 'Confirmed. I will be there. Using new identity commitment for this operation.',
    timestamp: BASE_TIME - 900000,
    sender: 'me',
    nullifier: '0x4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5',
    viewTag: '0xa7',
    stealthAddress: '0x4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c4',
    proofVerified: true,
    encrypted: true,
  },
]

// Utility functions
const formatTime = (ts: number) => {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

const truncateHex = (hex: string, start = 6, end = 4) => {
  if (!hex) return ''
  return `${hex.slice(0, start)}...${hex.slice(-end)}`
}

// Components
function StatusIndicator({ status }: { status: 'online' | 'offline' | 'encrypting' }) {
  return (
    <span className={`status-dot ${status}`} style={{ marginLeft: '8px' }} />
  )
}

function TechBadge({ label, value, color = 'green' }: { label: string; value: string; color?: 'green' | 'amber' | 'cyan' }) {
  const colorMap = {
    green: { border: 'var(--phosphor-secondary)', text: 'var(--phosphor-primary)' },
    amber: { border: 'var(--amber-secondary)', text: 'var(--amber-primary)' },
    cyan: { border: 'var(--accent-cyan)', text: 'var(--accent-cyan)' },
  }
  const colors = colorMap[color]

  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: '2px 8px',
      border: `1px solid ${colors.border}`,
      borderRadius: '2px',
      fontSize: '10px',
      fontFamily: 'Share Tech Mono, monospace',
    }}>
      <span style={{ color: colors.text, opacity: 0.7 }}>{label}:</span>
      <span style={{ color: colors.text }}>{value}</span>
    </div>
  )
}

function MessageBubble({ message }: { message: Message }) {
  const isMe = message.sender === 'me'

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: isMe ? 'flex-end' : 'flex-start',
      marginBottom: '16px',
      animation: 'fadeIn 0.3s ease-out',
    }}>
      {/* Message bubble */}
      <div style={{
        maxWidth: '70%',
        padding: '12px 16px',
        background: isMe
          ? 'linear-gradient(135deg, rgba(0, 255, 65, 0.1) 0%, rgba(0, 255, 65, 0.05) 100%)'
          : 'linear-gradient(135deg, rgba(255, 176, 0, 0.1) 0%, rgba(255, 176, 0, 0.05) 100%)',
        border: `1px solid ${isMe ? 'var(--phosphor-dim)' : 'var(--amber-dim)'}`,
        borderRadius: '4px',
        position: 'relative',
      }}>
        {/* Encryption indicator */}
        {message.encrypted && (
          <div style={{
            position: 'absolute',
            top: '-8px',
            right: '10px',
            background: 'var(--screen-surface)',
            padding: '0 6px',
            fontSize: '9px',
            color: 'var(--success)',
          }}>
            🔒 E2E
          </div>
        )}

        <p style={{
          margin: 0,
          color: 'var(--text-primary)',
          lineHeight: 1.5,
          fontSize: '13px',
        }}>
          {message.content}
        </p>

        {/* Timestamp */}
        <div style={{
          marginTop: '8px',
          fontSize: '10px',
          color: 'var(--text-dim)',
          textAlign: 'right',
        }}>
          {formatTime(message.timestamp)}
        </div>
      </div>

      {/* Tech readout */}
      <div className="tech-readout" style={{
        marginTop: '4px',
        maxWidth: '70%',
        fontSize: '9px',
      }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '4px' }}>
          <TechBadge label="VIEW" value={message.viewTag} color="cyan" />
          <TechBadge
            label="PROOF"
            value={message.proofVerified ? '✓ VERIFIED' : '✗ FAILED'}
            color={message.proofVerified ? 'green' : 'amber'}
          />
        </div>
        <div className="hex-display" style={{ marginTop: '4px' }}>
          NULL: {truncateHex(message.nullifier, 10, 8)}
        </div>
        <div className="hex-display">
          STEALTH: {truncateHex(message.stealthAddress, 10, 8)}
        </div>
      </div>
    </div>
  )
}

function ConversationList({
  conversations,
  activeId,
  onSelect
}: {
  conversations: Conversation[]
  activeId: string
  onSelect: (id: string) => void
}) {
  return (
    <div style={{
      flex: 1,
      overflowY: 'auto',
      padding: '8px',
    }}>
      {conversations.map((conv) => (
        <div
          key={conv.id}
          onClick={() => onSelect(conv.id)}
          style={{
            padding: '12px',
            marginBottom: '4px',
            background: activeId === conv.id
              ? 'linear-gradient(90deg, rgba(0, 255, 65, 0.1) 0%, transparent 100%)'
              : 'transparent',
            border: activeId === conv.id
              ? '1px solid var(--phosphor-dim)'
              : '1px solid transparent',
            borderRadius: '4px',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '4px',
          }}>
            <span style={{
              fontFamily: 'Share Tech Mono, monospace',
              fontSize: '12px',
              color: activeId === conv.id ? 'var(--phosphor-primary)' : 'var(--text-secondary)',
            }}>
              {conv.name}
            </span>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              {conv.unread > 0 && (
                <span style={{
                  background: 'var(--accent-red)',
                  color: 'white',
                  fontSize: '10px',
                  padding: '2px 6px',
                  borderRadius: '10px',
                  marginRight: '8px',
                }}>
                  {conv.unread}
                </span>
              )}
              <StatusIndicator status={conv.online ? 'online' : 'offline'} />
            </div>
          </div>
          <div style={{
            fontSize: '11px',
            color: 'var(--text-dim)',
            marginBottom: '4px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {conv.lastMessage}
          </div>
          <div className="hex-display" style={{ fontSize: '9px' }}>
            TAG: {conv.viewTag}
          </div>
        </div>
      ))}
    </div>
  )
}

function TechPanel({ message }: { message: Message | null }) {
  if (!message) return null

  return (
    <div className="terminal-window" style={{
      width: '280px',
      borderLeft: '1px solid var(--screen-border)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div className="terminal-header">
        <div className="terminal-dot green" />
        <span className="terminal-title">TECHNICAL DETAILS</span>
      </div>

      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '12px',
      }}>
        {/* ZK Proof Section */}
        <div style={{ marginBottom: '16px' }}>
          <h4 style={{
            color: 'var(--phosphor-primary)',
            fontSize: '11px',
            marginBottom: '8px',
            textTransform: 'uppercase',
            letterSpacing: '1px',
          }}>
            Zero-Knowledge Proof
          </h4>
          <div className="tech-readout" style={{ marginBottom: '8px' }}>
            <div style={{ color: message.proofVerified ? 'var(--success)' : 'var(--error)', marginBottom: '4px' }}>
              {message.proofVerified ? '✓ VERIFIED' : '✗ INVALID'}
            </div>
            <div style={{ fontSize: '9px', color: 'var(--text-secondary)' }}>
              Groth16 on BN254
            </div>
          </div>
        </div>

        {/* Stealth Address Section */}
        <div style={{ marginBottom: '16px' }}>
          <h4 style={{
            color: 'var(--amber-primary)',
            fontSize: '11px',
            marginBottom: '8px',
            textTransform: 'uppercase',
            letterSpacing: '1px',
          }}>
            Stealth Address
          </h4>
          <div className="hex-display" style={{
            background: 'rgba(0,0,0,0.3)',
            padding: '8px',
            borderRadius: '2px',
            wordBreak: 'break-all',
          }}>
            {message.stealthAddress}
          </div>
        </div>

        {/* Nullifier Section */}
        <div style={{ marginBottom: '16px' }}>
          <h4 style={{
            color: 'var(--accent-cyan)',
            fontSize: '11px',
            marginBottom: '8px',
            textTransform: 'uppercase',
            letterSpacing: '1px',
          }}>
            Nullifier
          </h4>
          <div className="hex-display" style={{
            background: 'rgba(0,0,0,0.3)',
            padding: '8px',
            borderRadius: '2px',
            wordBreak: 'break-all',
          }}>
            {message.nullifier}
          </div>
        </div>

        {/* View Tag */}
        <div style={{ marginBottom: '16px' }}>
          <h4 style={{
            color: 'var(--accent-magenta)',
            fontSize: '11px',
            marginBottom: '8px',
            textTransform: 'uppercase',
            letterSpacing: '1px',
          }}>
            View Tag
          </h4>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}>
            <span style={{
              background: 'var(--accent-magenta)',
              color: 'black',
              padding: '4px 12px',
              fontFamily: 'Share Tech Mono, monospace',
              fontSize: '14px',
            }}>
              {message.viewTag}
            </span>
            <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
              1/256 filter
            </span>
          </div>
        </div>

        {/* Ratchet State */}
        <div>
          <h4 style={{
            color: 'var(--phosphor-primary)',
            fontSize: '11px',
            marginBottom: '8px',
            textTransform: 'uppercase',
            letterSpacing: '1px',
          }}>
            Ratchet State
          </h4>
          <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
            <div>Chain: Send #7 / Recv #4</div>
            <div>Root Key: Rotated</div>
            <div>Skipped Keys: 2 cached</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function KeyManagementModal({ onClose }: { onClose: () => void }) {
  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 2000,
    }}>
      <div className="terminal-window" style={{
        width: '600px',
        maxHeight: '80vh',
      }}>
        <div className="terminal-header">
          <div className="terminal-dot red" />
          <div className="terminal-dot yellow" />
          <div className="terminal-dot green" />
          <span className="terminal-title">KEY MANAGEMENT</span>
          <button
            onClick={onClose}
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '16px',
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: '20px', overflowY: 'auto', maxHeight: 'calc(80vh - 40px)' }}>
          {/* Identity Key */}
          <div style={{ marginBottom: '24px' }}>
            <h3 style={{
              color: 'var(--phosphor-primary)',
              fontSize: '12px',
              marginBottom: '12px',
              textTransform: 'uppercase',
            }}>
              Identity Key
            </h3>
            <div style={{
              background: 'rgba(0, 255, 65, 0.05)',
              border: '1px solid var(--phosphor-dim)',
              padding: '12px',
            }}>
              <div className="hex-display" style={{ marginBottom: '8px' }}>
                0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                Created: 2024-01-15 14:32:07 UTC • Never rotate
              </div>
            </div>
          </div>

          {/* Signed Pre-Key */}
          <div style={{ marginBottom: '24px' }}>
            <h3 style={{
              color: 'var(--amber-primary)',
              fontSize: '12px',
              marginBottom: '12px',
              textTransform: 'uppercase',
            }}>
              Signed Pre-Key
            </h3>
            <div style={{
              background: 'rgba(255, 176, 0, 0.05)',
              border: '1px solid var(--amber-dim)',
              padding: '12px',
            }}>
              <div className="hex-display" style={{ marginBottom: '8px' }}>
                0x9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                Signature: ✓ Valid • Rotated: 2 hours ago
              </div>
              <button className="btn-terminal amber" style={{ fontSize: '10px', padding: '6px 12px' }}>
                Rotate Key
              </button>
            </div>
          </div>

          {/* One-Time Pre-Keys */}
          <div style={{ marginBottom: '24px' }}>
            <h3 style={{
              color: 'var(--accent-cyan)',
              fontSize: '12px',
              marginBottom: '12px',
              textTransform: 'uppercase',
            }}>
              One-Time Pre-Keys
            </h3>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '20px',
              marginBottom: '12px',
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  fontSize: '32px',
                  color: 'var(--success)',
                  fontFamily: 'Share Tech Mono, monospace',
                }}>
                  47
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Available</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  fontSize: '32px',
                  color: 'var(--amber-primary)',
                  fontFamily: 'Share Tech Mono, monospace',
                }}>
                  53
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Consumed</div>
              </div>
            </div>
            <div style={{
              height: '4px',
              background: 'var(--screen-border)',
              borderRadius: '2px',
              overflow: 'hidden',
            }}>
              <div style={{
                width: '47%',
                height: '100%',
                background: 'var(--phosphor-primary)',
              }} />
            </div>
          </div>

          {/* Stealth Keys */}
          <div style={{ marginBottom: '24px' }}>
            <h3 style={{
              color: 'var(--accent-magenta)',
              fontSize: '12px',
              marginBottom: '12px',
              textTransform: 'uppercase',
            }}>
              Stealth Keys
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Viewing Key
                </div>
                <div className="hex-display" style={{ fontSize: '9px' }}>
                  0x4a5b6c7d8e9f...
                </div>
              </div>
              <div>
                <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Spending Key
                </div>
                <div className="hex-display" style={{ fontSize: '9px' }}>
                  0x1d2e3f4a5b6c...
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <button className="btn-terminal" onClick={onClose}>
              Close
            </button>
            <button className="btn-terminal primary">
              Backup Keys
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ComposeBar({ onSend }: { onSend: (msg: string) => void }) {
  const [message, setMessage] = useState('')
  const [encrypting, setEncrypting] = useState(false)
  const [nextTag, setNextTag] = useState('0x??')

  useEffect(() => {
    setNextTag(randomTag())
  }, [])

  const handleSend = async () => {
    if (!message.trim()) return
    setEncrypting(true)
    // Simulate encryption delay
    await new Promise(r => setTimeout(r, 500))
    onSend(message)
    setMessage('')
    setEncrypting(false)
    setNextTag(randomTag())
  }

  return (
    <div style={{
      padding: '12px 16px',
      borderTop: '1px solid var(--screen-border)',
      background: 'rgba(0, 0, 0, 0.3)',
    }}>
      {/* Encryption status */}
      {encrypting && (
        <div style={{
          marginBottom: '8px',
          fontSize: '10px',
          color: 'var(--amber-primary)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <StatusIndicator status="encrypting" />
          <span>Encrypting message... Generating ZK proof...</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: '12px' }}>
        <input
          type="text"
          className="input-terminal"
          placeholder="Enter message (will be E2E encrypted)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          style={{ flex: 1 }}
        />
        <button
          className="btn-terminal primary"
          onClick={handleSend}
          disabled={encrypting || !message.trim()}
          style={{ opacity: encrypting || !message.trim() ? 0.5 : 1 }}
        >
          {encrypting ? 'ENCRYPTING' : 'SEND'}
        </button>
      </div>

      {/* Tech info */}
      <div style={{
        marginTop: '8px',
        fontSize: '9px',
        color: 'var(--text-dim)',
        display: 'flex',
        gap: '16px',
      }}>
        <span>🔐 Double Ratchet Active</span>
        <span>🏷️ New View Tag: {nextTag}</span>
        <span>📍 Stealth: Unique</span>
      </div>
    </div>
  )
}

function HeaderBar({ onKeyManage, onScan, scanning }: { onKeyManage: () => void; onScan: () => void; scanning: boolean }) {
  const { isConnected } = useAccount()

  return (
    <div style={{
      padding: '12px 20px',
      borderBottom: '1px solid var(--screen-border)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      background: 'linear-gradient(180deg, rgba(0,0,0,0.5) 0%, transparent 100%)',
    }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{
          fontFamily: 'Share Tech Mono, monospace',
          fontSize: '20px',
          fontWeight: 'bold',
          color: 'var(--phosphor-primary)',
        }} className="glow-text">
          POMP
        </div>
        <div style={{
          fontSize: '10px',
          color: 'var(--text-secondary)',
          borderLeft: '1px solid var(--screen-border)',
          paddingLeft: '12px',
        }}>
          Private Onchain Messaging
        </div>
      </div>

      {/* Status & Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        {/* Network Status */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '4px 12px',
          background: 'rgba(0, 255, 65, 0.1)',
          border: '1px solid var(--phosphor-dim)',
          borderRadius: '2px',
        }}>
          <StatusIndicator status={isConnected ? 'online' : 'offline'} />
          <span style={{ fontSize: '10px', color: 'var(--phosphor-primary)' }}>
            HARDHAT
          </span>
        </div>

        {/* Wallet Connect */}
        <WalletConnect />

        {/* Scan Button - only show when connected */}
        {isConnected && (
          <button
            className="btn-terminal"
            onClick={onScan}
            disabled={scanning}
            style={{ fontSize: '11px', padding: '6px 12px' }}
          >
            {scanning ? 'SCANNING...' : 'SCAN MESSAGES'}
          </button>
        )}

        {/* Key Management */}
        {isConnected && (
          <button
            className="btn-terminal amber"
            onClick={onKeyManage}
            style={{ fontSize: '11px', padding: '6px 12px' }}
          >
            KEYS
          </button>
        )}
      </div>
    </div>
  )
}

// Main App
export default function POMPApp() {
  const [activeConversation, setActiveConversation] = useState('1')
  const [messages, setMessages] = useState<Message[]>(mockMessages)
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null)
  const [showKeyModal, setShowKeyModal] = useState(false)
  const [scanning, setScanning] = useState(false)

  const handleScan = async () => {
    setScanning(true)
    // In a real implementation, this would call scanMessages from the hook
    await new Promise(r => setTimeout(r, 2000))
    setScanning(false)
  }

  const handleSendMessage = (content: string) => {
    const newMessage: Message = {
      id: Date.now().toString(),
      content,
      timestamp: Date.now(),
      sender: 'me',
      nullifier: `0x${randomHex(64)}`,
      viewTag: randomTag(),
      stealthAddress: `0x${randomHex(40)}`,
      proofVerified: true,
      encrypted: true,
    }
    setMessages([...messages, newMessage])
  }

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <HeaderBar
        onKeyManage={() => setShowKeyModal(true)}
        onScan={handleScan}
        scanning={scanning}
      />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Sidebar */}
        <div className="terminal-window" style={{
          width: '280px',
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid var(--screen-border)',
        }}>
          <div className="terminal-header">
            <div className="terminal-dot green" />
            <span className="terminal-title">CONVERSATIONS</span>
          </div>

          {/* Search */}
          <div style={{ padding: '8px' }}>
            <input
              type="text"
              className="input-terminal"
              placeholder="Search by view tag or address..."
              style={{ fontSize: '11px', padding: '8px' }}
            />
          </div>

          <ConversationList
            conversations={mockConversations}
            activeId={activeConversation}
            onSelect={setActiveConversation}
          />

          {/* New Chat Button */}
          <div style={{ padding: '12px', borderTop: '1px solid var(--screen-border)' }}>
            <button className="btn-terminal primary" style={{ width: '100%', fontSize: '11px' }}>
              + NEW SECURE CHANNEL
            </button>
          </div>
        </div>

        {/* Main Chat Area */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* Chat Header */}
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--screen-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <div>
              <div style={{
                fontFamily: 'Share Tech Mono, monospace',
                fontSize: '14px',
                color: 'var(--phosphor-primary)',
              }}>
                {mockConversations.find(c => c.id === activeConversation)?.name}
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                X3DH established • Double Ratchet active • 4 message keys remaining
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <TechBadge label="VIEW" value={mockConversations.find(c => c.id === activeConversation)?.viewTag || ''} color="cyan" />
              <TechBadge label="STATUS" value="SECURE" color="green" />
            </div>
          </div>

          {/* Messages */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '16px',
              background: 'radial-gradient(ellipse at center, rgba(0, 255, 65, 0.02) 0%, transparent 70%)',
            }}
            onClick={() => setSelectedMessage(null)}
          >
            {messages.map((msg) => (
              <div key={msg.id} onClick={(e) => { e.stopPropagation(); setSelectedMessage(msg) }}>
                <MessageBubble message={msg} />
              </div>
            ))}
          </div>

          <ComposeBar onSend={handleSendMessage} />
        </div>

        {/* Tech Panel */}
        <TechPanel message={selectedMessage || messages[messages.length - 1]} />
      </div>

      {/* Key Management Modal */}
      {showKeyModal && <KeyManagementModal onClose={() => setShowKeyModal(false)} />}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
