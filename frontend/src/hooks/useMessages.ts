'use client'

import { useState, useCallback } from 'react'
import { useAccountContext } from '../context/AccountContext'
import { Message } from '../../../src/types'
import { useMessageClient } from './useMessageClient'

export interface UseMessagesReturn {
  messages: Message[]
  isScanning: boolean
  isSending: boolean
  error: string | null
  scanMessages: () => Promise<void>
  sendMessage: (recipient: string, content: string) => Promise<string | null>
}

export function useMessages(): UseMessagesReturn {
  const { isConnected, mounted } = useAccountContext()
  const { client } = useMessageClient()
  const [messages, setMessages] = useState<Message[]>([])
  const [isScanning, setIsScanning] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scanMessages = useCallback(async () => {
    if (!mounted || !isConnected || !client) {
      setError('Wallet not connected or client not initialized')
      return
    }

    setIsScanning(true)
    setError(null)

    try {
      const scannedMessages = await client.scanForMessages()
      setMessages(scannedMessages)
    } catch (err) {
      console.error('Scan failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to scan messages')
    } finally {
      setIsScanning(false)
    }
  }, [mounted, isConnected, client])

  const sendMessage = useCallback(async (
    recipient: string,
    content: string
  ): Promise<string | null> => {
    if (!mounted || !isConnected || !client) {
      setError('Wallet not connected or client not initialized')
      return null
    }

    if (!recipient || !recipient.startsWith('0x')) {
      setError('Invalid recipient address')
      return null
    }

    if (!content.trim()) {
      setError('Message content cannot be empty')
      return null
    }

    setIsSending(true)
    setError(null)

    try {
      const txHash = await client.sendDirectMessage(recipient, content)
      return txHash
    } catch (err) {
      console.error('Send failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to send message')
      return null
    } finally {
      setIsSending(false)
    }
  }, [mounted, isConnected, client])

  return {
    messages,
    isScanning,
    isSending,
    error,
    scanMessages,
    sendMessage
  }
}
