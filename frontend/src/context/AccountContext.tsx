'use client'

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { useAccount, useWalletClient, useBalance } from 'wagmi'
import { Signer } from 'ethers'
import { walletClientToSigner } from '../lib/ethers-adapter'
import {
  TEST_USERS,
  TestUser,
  isTestMode,
  getTestUser,
  setTestUser,
  enableTestMode,
  disableTestMode,
  getStorageKeySuffix,
} from '../config/testUsers'

interface AccountContextValue {
  // Address and connection state
  address: string | undefined
  isConnected: boolean
  isTestMode: boolean

  // Signer (either from wallet or test user)
  signer: Signer | null

  // Test mode specific
  testUser: TestUser | null
  switchTestUser: (userName: string) => void
  availableTestUsers: Record<string, TestUser>

  // Mode toggling
  enableTestMode: () => void
  disableTestMode: () => void

  // Storage helpers
  getStorageKey: (baseKey: string) => string

  // Balance
  balance: { formatted: string; symbol: string } | null

  // Mounted state for hydration
  mounted: boolean
}

const AccountContext = createContext<AccountContextValue | null>(null)

export function useAccountContext(): AccountContextValue {
  const context = useContext(AccountContext)
  if (!context) {
    throw new Error('useAccountContext must be used within AccountProvider')
  }
  return context
}

interface AccountProviderProps {
  children: ReactNode
}

export function AccountProvider({ children }: AccountProviderProps) {
  const [testModeEnabled, setTestModeEnabled] = useState(false)
  const [currentTestUser, setCurrentTestUser] = useState<TestUser | null>(null)
  const [mounted, setMounted] = useState(false)

  // Wagmi hooks for production mode
  const { address: wagmiAddress, isConnected: wagmiConnected } = useAccount()
  const { data: walletClient } = useWalletClient()
  const { data: balanceData } = useBalance({ address: wagmiAddress })

  // Initialize test mode state on mount
  useEffect(() => {
    setMounted(true)
    const enabled = isTestMode()
    setTestModeEnabled(enabled)
    if (enabled) {
      setCurrentTestUser(getTestUser())
    }
  }, [])

  // Derive values based on mode
  const address = testModeEnabled ? currentTestUser?.address : wagmiAddress
  const isConnected = testModeEnabled ? !!currentTestUser : wagmiConnected

  // Get signer based on mode
  const signer = testModeEnabled
    ? currentTestUser?.wallet || null
    : (walletClient ? walletClientToSigner(walletClient) : null)

  // Switch test user
  const handleSwitchTestUser = useCallback((userName: string) => {
    setTestUser(userName)
    const user = TEST_USERS[userName]
    if (user) {
      setCurrentTestUser(user)
    }
  }, [])

  // Enable test mode
  const handleEnableTestMode = useCallback(() => {
    enableTestMode()
    setTestModeEnabled(true)
    const user = getTestUser()
    setCurrentTestUser(user)
  }, [])

  // Disable test mode
  const handleDisableTestMode = useCallback(() => {
    disableTestMode()
    setTestModeEnabled(false)
    setCurrentTestUser(null)
  }, [])

  // Get storage key with test mode suffix
  const getStorageKey = useCallback((baseKey: string): string => {
    if (testModeEnabled && currentTestUser) {
      return `${baseKey}-${getStorageKeySuffix(true, currentTestUser.name.toLowerCase())}`
    }
    const addr = address || ''
    return `${baseKey}-${addr}`
  }, [testModeEnabled, currentTestUser, address])

  const value: AccountContextValue = {
    address,
    isConnected,
    isTestMode: testModeEnabled,
    signer,
    testUser: currentTestUser,
    switchTestUser: handleSwitchTestUser,
    availableTestUsers: TEST_USERS,
    enableTestMode: handleEnableTestMode,
    disableTestMode: handleDisableTestMode,
    getStorageKey,
    balance: balanceData ? { formatted: balanceData.formatted, symbol: balanceData.symbol } : null,
    mounted,
  }

  return (
    <AccountContext.Provider value={value}>
      {children}
    </AccountContext.Provider>
  )
}
