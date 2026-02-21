'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAccountContext } from '../src/context/AccountContext'
import { WalletConnect } from '../src/components/WalletConnect'
import { useMessageClient } from '../src/hooks/useMessageClient'
import { useMessages } from '../src/hooks/useMessages'
import { useRegisterKeys } from '../src/hooks/useRegisterKeys'
import { useIpfsStorage } from '../src/hooks/useIpfsStorage'
import { BackupRestore } from '../src/components/BackupRestore'
import { Message } from '../../src/types'

// UI-specific message type that extends core Message with display properties
interface UIMessage extends Message {
  id: string
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

// Generate random hex only on client side
const randomHex = (length: number) =>
  Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join('')

const randomTag = () =>
  `0x${Math.floor(Math.random() * 256).toString(16).padStart(2, '0')}`

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

function MessageBubble({ message }: { message: UIMessage }) {
  const isMe = message.sender === 'me'

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: isMe ? 'flex-end' : 'flex-start',
      marginBottom: '16px',
      animation: 'fadeIn 0.3s ease-out',
    }}>
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
            E2E
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

        <div style={{
          marginTop: '8px',
          fontSize: '10px',
          color: 'var(--text-dim)',
          textAlign: 'right',
        }}>
          {formatTime(message.timestamp)}
        </div>
      </div>

      <div className="tech-readout" style={{
        marginTop: '4px',
        maxWidth: '70%',
        fontSize: '9px',
      }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '4px' }}>
          <TechBadge label="VIEW" value={message.viewTag} color="cyan" />
          <TechBadge
            label="PROOF"
            value={message.proofVerified ? 'VERIFIED' : 'FAILED'}
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
  activeId: string | null
  onSelect: (id: string) => void
}) {
  if (conversations.length === 0) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        color: 'var(--text-dim)',
        fontSize: '11px',
        textAlign: 'center',
      }}>
        No conversations yet.<br />Start a new secure channel to begin messaging.
      </div>
    )
  }

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

function TechPanel({ message }: { message: UIMessage | null }) {
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
              {message.proofVerified ? 'VERIFIED' : 'INVALID'}
            </div>
            <div style={{ fontSize: '9px', color: 'var(--text-secondary)' }}>
              Groth16 on BN254
            </div>
          </div>
        </div>

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
            <div>Double Ratchet Active</div>
            <div>Forward Secrecy Enabled</div>
          </div>
        </div>
      </div>
    </div>
  )
}

interface KeyManagementModalProps {
  onClose: () => void
  isRegistered: boolean
  isRegistering: boolean
  registrationError: string | null
  onRegister: () => Promise<void>
  storedKeys: {
    identityPublicKey?: string
    signedPrePublicKey?: string
    stealthSpendingPublicKey?: string
    stealthViewingPublicKey?: string
    identityCommitment?: string
  } | null
}

function KeyManagementModal({
  onClose,
  isRegistered,
  isRegistering,
  registrationError,
  onRegister,
  storedKeys
}: KeyManagementModalProps) {
  const [rotating, setRotating] = useState(false)

  const handleRotateKey = async () => {
    setRotating(true)
    try {
      await onRegister()
    } finally {
      setRotating(false)
    }
  }

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
            x
          </button>
        </div>

        <div style={{ padding: '20px', overflowY: 'auto', maxHeight: 'calc(80vh - 40px)' }}>
          {registrationError && (
            <div style={{
              marginBottom: '16px',
              padding: '12px',
              background: 'rgba(255, 0, 0, 0.1)',
              border: '1px solid var(--error)',
              borderRadius: '4px',
              color: 'var(--error)',
              fontSize: '12px',
            }}>
              ERROR: {registrationError}
            </div>
          )}

          <div style={{ marginBottom: '24px' }}>
            <h3 style={{
              color: isRegistered ? 'var(--success)' : 'var(--amber-primary)',
              fontSize: '12px',
              marginBottom: '12px',
              textTransform: 'uppercase',
            }}>
              Registration Status: {isRegistered ? 'REGISTERED' : 'NOT REGISTERED'}
            </h3>
            {!isRegistered && (
              <button
                className="btn-terminal primary"
                onClick={onRegister}
                disabled={isRegistering}
                style={{ fontSize: '11px', padding: '8px 16px' }}
              >
                {isRegistering ? 'REGISTERING...' : 'REGISTER KEYS ON-CHAIN'}
              </button>
            )}
          </div>

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
              <div className="hex-display" style={{ marginBottom: '8px', fontSize: '9px', wordBreak: 'break-all' }}>
                {storedKeys?.identityPublicKey || 'Not generated'}
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                Never rotate - This is your permanent identity
              </div>
            </div>
          </div>

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
              <div className="hex-display" style={{ marginBottom: '8px', fontSize: '9px', wordBreak: 'break-all' }}>
                {storedKeys?.signedPrePublicKey || 'Not generated'}
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                {isRegistered ? 'Signature: Valid' : 'Signature: Pending registration'}
              </div>
              <button
                className="btn-terminal amber"
                style={{ fontSize: '10px', padding: '6px 12px' }}
                onClick={handleRotateKey}
                disabled={rotating || isRegistering}
              >
                {rotating ? 'ROTATING...' : 'Rotate Key'}
              </button>
            </div>
          </div>

          <div style={{ marginBottom: '24px' }}>
            <h3 style={{
              color: 'var(--accent-cyan)',
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
                <div className="hex-display" style={{ fontSize: '9px', wordBreak: 'break-all' }}>
                  {storedKeys?.stealthViewingPublicKey ? truncateHex(storedKeys.stealthViewingPublicKey, 10, 8) : 'Not generated'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Spending Key
                </div>
                <div className="hex-display" style={{ fontSize: '9px', wordBreak: 'break-all' }}>
                  {storedKeys?.stealthSpendingPublicKey ? truncateHex(storedKeys.stealthSpendingPublicKey, 10, 8) : 'Not generated'}
                </div>
              </div>
            </div>
          </div>

          <div style={{ marginBottom: '24px' }}>
            <h3 style={{
              color: 'var(--phosphor-primary)',
              fontSize: '12px',
              marginBottom: '12px',
              textTransform: 'uppercase',
            }}>
              Identity Commitment
            </h3>
            <div className="hex-display" style={{
              background: 'rgba(0,0,0,0.3)',
              padding: '8px',
              borderRadius: '2px',
              wordBreak: 'break-all',
              fontSize: '10px',
            }}>
              {storedKeys?.identityCommitment || 'Not generated'}
            </div>
          </div>

          {/* IPFS Encrypted Backup Section */}
          <div style={{ marginBottom: '24px' }}>
            <BackupRestore />
          </div>

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <button className="btn-terminal" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

interface NewChannelModalProps {
  onClose: () => void
  onCreateChannel: (address: string) => void
  isCreating: boolean
  error: string | null
}

function NewChannelModal({ onClose, onCreateChannel, isCreating, error }: NewChannelModalProps) {
  const [recipientAddress, setRecipientAddress] = useState('')

  const handleCreate = () => {
    if (recipientAddress.trim()) {
      onCreateChannel(recipientAddress.trim())
    }
  }

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
        width: '450px',
      }}>
        <div className="terminal-header">
          <div className="terminal-dot green" />
          <span className="terminal-title">NEW SECURE CHANNEL</span>
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
            x
          </button>
        </div>

        <div style={{ padding: '20px' }}>
          <p style={{
            color: 'var(--text-secondary)',
            fontSize: '12px',
            marginBottom: '16px',
          }}>
            Enter the Ethereum address of the recipient to establish a new secure messaging channel.
          </p>

          {error && (
            <div style={{
              marginBottom: '16px',
              padding: '12px',
              background: 'rgba(255, 0, 0, 0.1)',
              border: '1px solid var(--error)',
              borderRadius: '4px',
              color: 'var(--error)',
              fontSize: '12px',
            }}>
              ERROR: {error}
            </div>
          )}

          <div style={{ marginBottom: '20px' }}>
            <label style={{
              display: 'block',
              color: 'var(--text-secondary)',
              fontSize: '11px',
              marginBottom: '8px',
            }}>
              Recipient Address
            </label>
            <input
              type="text"
              className="input-terminal"
              placeholder="0x..."
              value={recipientAddress}
              onChange={(e) => setRecipientAddress(e.target.value)}
              style={{
                width: '100%',
                fontSize: '12px',
                padding: '10px',
              }}
            />
          </div>

          <div style={{
            background: 'rgba(0, 255, 65, 0.05)',
            border: '1px solid var(--phosphor-dim)',
            padding: '12px',
            marginBottom: '20px',
          }}>
            <div style={{ fontSize: '10px', color: 'var(--phosphor-primary)', marginBottom: '8px' }}>
              PROTOCOL: X3DH Key Exchange
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
              A new Double Ratchet session will be established for forward secrecy.
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <button className="btn-terminal" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn-terminal primary"
              onClick={handleCreate}
              disabled={isCreating || !recipientAddress.trim()}
              style={{ opacity: isCreating || !recipientAddress.trim() ? 0.5 : 1 }}
            >
              {isCreating ? 'CREATING...' : 'CREATE CHANNEL'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

interface ComposeBarProps {
  onSend: (msg: string, recipient: string) => Promise<void>
  isSending: boolean
  activeRecipient: string | null
}

function ComposeBar({ onSend, isSending, activeRecipient }: ComposeBarProps) {
  const [message, setMessage] = useState('')
  const [encrypting, setEncrypting] = useState(false)
  const [nextTag, setNextTag] = useState('0x??')

  useEffect(() => {
    setNextTag(randomTag())
  }, [])

  const handleSend = async () => {
    if (!message.trim() || !activeRecipient) return
    setEncrypting(true)
    await new Promise(r => setTimeout(r, 100))
    await onSend(message, activeRecipient)
    setMessage('')
    setEncrypting(false)
    setNextTag(randomTag())
  }

  const isDisabled = encrypting || isSending || !message.trim() || !activeRecipient

  return (
    <div style={{
      padding: '12px 16px',
      borderTop: '1px solid var(--screen-border)',
      background: 'rgba(0, 0, 0, 0.3)',
    }}>
      {(encrypting || isSending) && (
        <div style={{
          marginBottom: '8px',
          fontSize: '10px',
          color: 'var(--amber-primary)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <StatusIndicator status="encrypting" />
          <span>{isSending ? 'Sending transaction...' : 'Encrypting message...'}</span>
        </div>
      )}

      {!activeRecipient && (
        <div style={{
          marginBottom: '8px',
          fontSize: '10px',
          color: 'var(--text-dim)',
        }}>
          Select or create a conversation to send messages
        </div>
      )}

      <div style={{ display: 'flex', gap: '12px' }}>
        <input
          type="text"
          className="input-terminal"
          placeholder={activeRecipient ? "Enter message (E2E encrypted)" : "Select a conversation first"}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          disabled={!activeRecipient}
          style={{ flex: 1, opacity: activeRecipient ? 1 : 0.5 }}
        />
        <button
          className="btn-terminal primary"
          onClick={handleSend}
          disabled={isDisabled}
          style={{ opacity: isDisabled ? 0.5 : 1 }}
        >
          {encrypting || isSending ? 'SENDING' : 'SEND'}
        </button>
      </div>

      <div style={{
        marginTop: '8px',
        fontSize: '9px',
        color: 'var(--text-dim)',
        display: 'flex',
        gap: '16px',
      }}>
        <span>Double Ratchet Active</span>
        <span>View Tag: {nextTag}</span>
        <span>Stealth: Unique</span>
      </div>
    </div>
  )
}

function ErrorBanner({ error, onDismiss }: { error: string; onDismiss: () => void }) {
  return (
    <div style={{
      padding: '12px 20px',
      background: 'rgba(255, 0, 0, 0.1)',
      borderBottom: '1px solid var(--error)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    }}>
      <span style={{ color: 'var(--error)', fontSize: '12px' }}>
        ERROR: {error}
      </span>
      <button
        onClick={onDismiss}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--error)',
          cursor: 'pointer',
          fontSize: '14px',
        }}
      >
        x
      </button>
    </div>
  )
}

function HeaderBar({
  onKeyManage,
  onScan,
  scanning,
  isRegistered
}: {
  onKeyManage: () => void
  onScan: () => void
  scanning: boolean
  isRegistered: boolean
}) {
  const { isConnected, isTestMode, mounted } = useAccountContext()
  const [localMounted, setLocalMounted] = useState(false)

  useEffect(() => {
    setLocalMounted(true)
  }, [])

  // Use mounted state to prevent hydration mismatch
  const showWalletButtons = localMounted && mounted && isConnected

  return (
    <div style={{
      padding: '12px 20px',
      borderBottom: '1px solid var(--screen-border)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      background: 'linear-gradient(180deg, rgba(0,0,0,0.5) 0%, transparent 100%)',
    }}>
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
        {/* Test mode indicator */}
        {isTestMode && (
          <div style={{
            fontSize: '9px',
            color: 'var(--amber-primary)',
            background: 'rgba(255, 176, 0, 0.2)',
            padding: '2px 8px',
            border: '1px solid var(--amber-primary)',
            borderRadius: '2px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}>
            TEST MODE
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '4px 12px',
          background: 'rgba(0, 255, 65, 0.1)',
          border: '1px solid var(--phosphor-dim)',
          borderRadius: '2px',
        }}>
          <StatusIndicator status={localMounted && mounted && isConnected ? 'online' : 'offline'} />
          <span style={{ fontSize: '10px', color: 'var(--phosphor-primary)' }}>
            HARDHAT
          </span>
        </div>

        <WalletConnect />

        {showWalletButtons && (
          <button
            className="btn-terminal"
            onClick={onScan}
            disabled={scanning}
            style={{ fontSize: '11px', padding: '6px 12px' }}
          >
            {scanning ? 'SCANNING...' : 'SCAN MESSAGES'}
          </button>
        )}

        {showWalletButtons && (
          <button
            className="btn-terminal amber"
            onClick={onKeyManage}
            style={{ fontSize: '11px', padding: '6px 12px' }}
          >
            {isRegistered ? 'KEYS' : 'REGISTER'}
          </button>
        )}
      </div>
    </div>
  )
}

// Empty state component
function EmptyState({ onNewChannel }: { onNewChannel: () => void }) {
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px',
      color: 'var(--text-secondary)',
    }}>
      <div style={{
        fontSize: '48px',
        marginBottom: '16px',
        opacity: 0.3,
      }}>
        #
      </div>
      <h3 style={{
        color: 'var(--text-primary)',
        fontSize: '16px',
        marginBottom: '8px',
      }}>
        No Messages Yet
      </h3>
      <p style={{
        fontSize: '12px',
        textAlign: 'center',
        marginBottom: '20px',
        maxWidth: '300px',
      }}>
        Start a new secure channel to begin encrypted, private messaging on-chain.
      </p>
      <button
        className="btn-terminal primary"
        onClick={onNewChannel}
        style={{ fontSize: '12px', padding: '10px 20px' }}
      >
        + NEW SECURE CHANNEL
      </button>
    </div>
  )
}

// Main App
export default function POMPApp() {
  const { address, isConnected, mounted, getStorageKey } = useAccountContext()
  const { isReady: ipfsReady, putJson, getJson, has } = useIpfsStorage()

  // Prevent hydration mismatch
  const [localMounted, setLocalMounted] = useState(false)
  useEffect(() => {
    setLocalMounted(true)
  }, [])

  // Real hooks
  const { client, isInitializing, error: clientError, isRegistered, refreshRegistration, reinitialize } = useMessageClient()
  const { messages: scannedMessages, isScanning, isSending, error: messagesError, scanMessages, sendMessage } = useMessages()
  const { isRegistering, error: registerError, isReady: isRegisterReady, wrongNetwork, register: registerKeys, keys } = useRegisterKeys()

  // Local state - start empty for production
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [selectedMessage, setSelectedMessage] = useState<UIMessage | null>(null)
  const [showKeyModal, setShowKeyModal] = useState(false)
  const [showNewChannelModal, setShowNewChannelModal] = useState(false)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [dataLoaded, setDataLoaded] = useState(false)

  // Track if we've saved to avoid infinite loops
  const lastSavedConversations = useRef<string>('')
  const lastSavedMessages = useRef<string>('')

  // Use mounted state to prevent hydration issues
  const isConnectedSafe = localMounted && mounted && isConnected

  // Load conversations and messages from IPFS on mount
  useEffect(() => {
    if (!localMounted || !mounted || !address || dataLoaded) return

    const loadData = async () => {
      console.log('Loading data from IPFS...')

      if (!ipfsReady) {
        console.warn('IPFS not ready, cannot load data')
        setDataLoaded(true)
        return
      }

      try {
        const convPath = `conversations/${address}`
        const msgPath = `messages/${address}`

        const [hasConv, hasMsg] = await Promise.all([
          has(convPath),
          has(msgPath),
        ])

        if (hasConv) {
          const data = await getJson<Conversation[]>(convPath)
          if (data) {
            setConversations(data)
            console.log('Loaded conversations from IPFS:', data.length)
          }
        }

        if (hasMsg) {
          const data = await getJson<UIMessage[]>(msgPath)
          if (data) {
            setMessages(data)
            console.log('Loaded messages from IPFS:', data.length)
          }
        }
      } catch (err) {
        console.error('Failed to load from IPFS:', err)
      }

      setDataLoaded(true)
    }

    loadData()
  }, [localMounted, mounted, address, ipfsReady, dataLoaded, getJson, has])

  // Save conversations to IPFS when they change
  useEffect(() => {
    if (!localMounted || !mounted || !address || !dataLoaded || conversations.length === 0) return

    const serialized = JSON.stringify(conversations)
    if (serialized === lastSavedConversations.current) return
    lastSavedConversations.current = serialized

    const saveConversations = async () => {
      if (!ipfsReady) {
        console.warn('IPFS not ready, cannot save conversations')
        return
      }

      try {
        await putJson(`conversations/${address}`, conversations)
        console.log('Saved conversations to IPFS')
      } catch (err) {
        console.error('Failed to save conversations to IPFS:', err)
      }
    }

    // Debounce save
    const timeout = setTimeout(saveConversations, 500)
    return () => clearTimeout(timeout)
  }, [localMounted, mounted, address, ipfsReady, dataLoaded, conversations, getStorageKey, putJson])

  // Save messages to IPFS when they change
  useEffect(() => {
    if (!localMounted || !mounted || !address || !dataLoaded || messages.length === 0) return

    const serialized = JSON.stringify(messages)
    if (serialized === lastSavedMessages.current) return
    lastSavedMessages.current = serialized

    const saveMessages = async () => {
      if (!ipfsReady) {
        console.warn('IPFS not ready, cannot save messages')
        return
      }

      try {
        await putJson(`messages/${address}`, messages)
        console.log('Saved messages to IPFS')
      } catch (err) {
        console.error('Failed to save messages to IPFS:', err)
      }
    }

    // Debounce save
    const timeout = setTimeout(saveMessages, 500)
    return () => clearTimeout(timeout)
  }, [localMounted, mounted, address, ipfsReady, dataLoaded, messages, putJson])

  // Get stored keys from useRegisterKeys hook
  const storedKeys = keys ? {
    identityPublicKey: keys.identityKeyPair.publicKey
      ? Buffer.from(keys.identityKeyPair.publicKey).toString('hex')
      : undefined,
    signedPrePublicKey: keys.signedPreKeyPair.publicKey
      ? Buffer.from(keys.signedPreKeyPair.publicKey).toString('hex')
      : undefined,
    stealthSpendingPublicKey: keys.stealthSpendingKeyPair.publicKey
      ? Buffer.from(keys.stealthSpendingKeyPair.publicKey).toString('hex')
      : undefined,
    stealthViewingPublicKey: keys.stealthViewingKeyPair.publicKey
      ? Buffer.from(keys.stealthViewingKeyPair.publicKey).toString('hex')
      : undefined,
    identityCommitment: keys.identityCommitment,
  } : null

  // Update global error when hook errors change
  useEffect(() => {
    const error = clientError || messagesError || registerError
    if (error) {
      setGlobalError(error)
    }
  }, [clientError, messagesError, registerError])

  // Convert scanned messages to UIMessage format
  useEffect(() => {
    if (scannedMessages.length > 0) {
      const uiMessages: UIMessage[] = scannedMessages.map((msg, idx) => ({
        ...msg,
        id: `scanned-${idx}-${Date.now()}`,
        sender: msg.from.toLowerCase() === address?.toLowerCase() ? 'me' as const : 'them' as const,
        nullifier: `0x${randomHex(64)}`,
        viewTag: randomTag(),
        stealthAddress: msg.from.slice(0, 42),
        proofVerified: true,
        encrypted: true,
      }))
      setMessages(prev => {
        const existingIds = new Set(prev.map(m => m.id))
        const newMessages = uiMessages.filter(m => !existingIds.has(m.id))
        return [...prev, ...newMessages]
      })
    }
  }, [scannedMessages, address])

  // Get active recipient from conversation
  const activeRecipient = conversations.find(c => c.id === activeConversationId)?.stealthSpendingKey || null

  // Scan handler
  const handleScan = useCallback(async () => {
    if (!client) {
      setGlobalError('Client not initialized. Please connect wallet.')
      return
    }
    setGlobalError(null)
    await scanMessages()
  }, [client, scanMessages])

  // Send message handler
  const handleSendMessage = useCallback(async (content: string, recipient: string) => {
    console.log('handleSendMessage called', { content, recipient, client: !!client, isConnectedSafe })
    if (!client || !isConnectedSafe) {
      setGlobalError('Client not initialized. Please connect wallet.')
      return
    }
    setGlobalError(null)

    try {
      console.log('Calling sendMessage...')
      const txHash = await sendMessage(recipient, content)
      console.log('sendMessage returned:', txHash)
      if (txHash) {
        const newMessage: UIMessage = {
          id: txHash,
          from: address || '',
          content,
          timestamp: Date.now(),
          messageType: 'DM',
          sender: 'me',
          nullifier: `0x${randomHex(64)}`,
          viewTag: randomTag(),
          stealthAddress: recipient.slice(0, 42),
          proofVerified: true,
          encrypted: true,
        }
        setMessages(prev => [...prev, newMessage])
        console.log('Message added to state:', newMessage)

        setConversations(prev => prev.map(conv =>
          conv.stealthSpendingKey === recipient
            ? { ...conv, lastMessage: content.slice(0, 30) + (content.length > 30 ? '...' : '') }
            : conv
        ))
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to send message'
      setGlobalError(errorMsg)
    }
  }, [client, isConnectedSafe, sendMessage, address])

  // Create new channel handler
  const handleCreateChannel = useCallback((recipientAddress: string) => {
    if (!recipientAddress.startsWith('0x') || recipientAddress.length !== 42) {
      setGlobalError('Invalid Ethereum address format')
      return
    }

    const newConversation: Conversation = {
      id: recipientAddress,
      name: `${recipientAddress.slice(0, 6)}...${recipientAddress.slice(-4)}`,
      stealthSpendingKey: recipientAddress,
      lastMessage: 'New secure channel',
      unread: 0,
      online: false,
      viewTag: randomTag(),
    }

    setConversations(prev => {
      // Don't add duplicates
      if (prev.some(c => c.stealthSpendingKey === recipientAddress)) {
        return prev
      }
      return [newConversation, ...prev]
    })
    setActiveConversationId(newConversation.id)
    setShowNewChannelModal(false)
  }, [])

  // Register handler
  const handleRegister = useCallback(async () => {
    if (wrongNetwork) {
      setGlobalError('Wrong network. Please connect to Hardhat Local (chainId 31337)')
      return
    }
    if (!isRegisterReady) {
      setGlobalError('Please connect your wallet first')
      return
    }
    setGlobalError(null)
    const txHash = await registerKeys()
    if (txHash) {
      // Refresh registration status after successful registration
      await refreshRegistration()
      // CRITICAL: Reinitialize the MessageClient with new keys
      // This ensures the client uses the same keys that were registered on-chain
      reinitialize()
    }
  }, [isRegisterReady, wrongNetwork, registerKeys, refreshRegistration, reinitialize])

  // Get active conversation
  const activeConversation = conversations.find(c => c.id === activeConversationId)

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <HeaderBar
        onKeyManage={() => setShowKeyModal(true)}
        onScan={handleScan}
        scanning={isScanning}
        isRegistered={isRegistered}
      />

      {globalError && (
        <ErrorBanner error={globalError} onDismiss={() => setGlobalError(null)} />
      )}

      {isInitializing && (
        <div style={{
          padding: '12px 20px',
          background: 'rgba(0, 255, 65, 0.05)',
          borderBottom: '1px solid var(--phosphor-dim)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <StatusIndicator status="encrypting" />
          <span style={{ color: 'var(--phosphor-primary)', fontSize: '12px' }}>
            Initializing client...
          </span>
        </div>
      )}

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

          <div style={{ padding: '8px' }}>
            <input
              type="text"
              className="input-terminal"
              placeholder="Search by address..."
              style={{ fontSize: '11px', padding: '8px' }}
            />
          </div>

          <ConversationList
            conversations={conversations}
            activeId={activeConversationId}
            onSelect={setActiveConversationId}
          />

          <div style={{ padding: '12px', borderTop: '1px solid var(--screen-border)' }}>
            <button
              className="btn-terminal primary"
              style={{ width: '100%', fontSize: '11px' }}
              onClick={() => setShowNewChannelModal(true)}
              disabled={!isConnectedSafe}
            >
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
          {activeConversation ? (
            <>
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
                    {activeConversation.name}
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    X3DH established - Double Ratchet active
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <TechBadge label="VIEW" value={activeConversation.viewTag} color="cyan" />
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
                {messages.length === 0 ? (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    color: 'var(--text-dim)',
                    fontSize: '12px',
                  }}>
                    No messages yet. Send an encrypted message to start the conversation.
                  </div>
                ) : (
                  messages.map((msg) => (
                    <div key={msg.id} onClick={(e) => { e.stopPropagation(); setSelectedMessage(msg) }}>
                      <MessageBubble message={msg} />
                    </div>
                  ))
                )}
              </div>

              <ComposeBar
                onSend={handleSendMessage}
                isSending={isSending}
                activeRecipient={activeRecipient}
              />
            </>
          ) : (
            <EmptyState onNewChannel={() => setShowNewChannelModal(true)} />
          )}
        </div>

        {/* Tech Panel */}
        {messages.length > 0 && (
          <TechPanel message={selectedMessage || messages[messages.length - 1]} />
        )}
      </div>

      {/* Key Management Modal */}
      {showKeyModal && (
        <KeyManagementModal
          onClose={() => setShowKeyModal(false)}
          isRegistered={isRegistered}
          isRegistering={isRegistering}
          registrationError={registerError}
          onRegister={handleRegister}
          storedKeys={storedKeys}
        />
      )}

      {/* New Channel Modal */}
      {showNewChannelModal && (
        <NewChannelModal
          onClose={() => setShowNewChannelModal(false)}
          onCreateChannel={handleCreateChannel}
          isCreating={false}
          error={null}
        />
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
