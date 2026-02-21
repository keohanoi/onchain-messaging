'use client'

import { useState } from 'react'
import { useBackup } from '../hooks/useBackup'

export function BackupRestore() {
  const {
    isBackingUp,
    isRestoring,
    backupCid,
    backupTimestamp,
    error,
    backupKeys,
    restoreKeys,
    clearError,
  } = useBackup()

  const [restoreCid, setRestoreCid] = useState('')
  const [showRestoreInput, setShowRestoreInput] = useState(false)

  const handleBackup = async () => {
    const cid = await backupKeys()
    if (cid) {
      // Copy to clipboard
      await navigator.clipboard.writeText(cid)
      alert(`Backup CID copied to clipboard:\n${cid}\n\nSave this CID to restore your keys later!`)
    }
  }

  const handleRestore = async () => {
    if (!restoreCid.trim()) {
      alert('Please enter a backup CID')
      return
    }
    const success = await restoreKeys(restoreCid.trim())
    if (success) {
      setShowRestoreInput(false)
      setRestoreCid('')
      alert('Keys restored successfully!')
    }
  }

  return (
    <div className="space-y-4">
      <div className="border-t border-gray-700 pt-4 mt-4">
        <h3 className="text-sm font-medium text-gray-300 mb-3">Encrypted Backup (IPFS)</h3>

        {error && (
          <div className="bg-red-900/50 border border-red-500 text-red-200 px-3 py-2 rounded mb-3 text-sm">
            {error}
            <button onClick={clearError} className="ml-2 text-red-400 hover:text-red-300">
              ×
            </button>
          </div>
        )}

        {backupCid && (
          <div className="bg-green-900/30 border border-green-600 text-green-200 px-3 py-2 rounded mb-3 text-sm">
            <div className="font-medium">Backup Available</div>
            <div className="text-xs text-green-300 mt-1 break-all font-mono">CID: {backupCid}</div>
            {backupTimestamp && (
              <div className="text-xs text-green-400 mt-1">
                Created: {new Date(backupTimestamp).toLocaleString()}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          <button
            onClick={handleBackup}
            disabled={isBackingUp || isRestoring}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-sm font-medium transition-colors"
          >
            {isBackingUp ? 'Backing up...' : 'Backup to IPFS'}
          </button>

          <button
            onClick={() => setShowRestoreInput(!showRestoreInput)}
            disabled={isBackingUp || isRestoring}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded text-sm font-medium transition-colors"
          >
            {showRestoreInput ? 'Cancel' : 'Restore from CID'}
          </button>
        </div>

        {showRestoreInput && (
          <div className="mt-3 space-y-2">
            <input
              type="text"
              value={restoreCid}
              onChange={(e) => setRestoreCid(e.target.value)}
              placeholder="Enter backup CID (e.g., Qm...)"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-sm focus:outline-none focus:border-blue-500 font-mono"
            />
            <button
              onClick={handleRestore}
              disabled={isRestoring || !restoreCid.trim()}
              className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-sm font-medium transition-colors"
            >
              {isRestoring ? 'Restoring...' : 'Restore Keys'}
            </button>
            <p className="text-xs text-gray-400">
              You will need to sign a message to decrypt your backup.
            </p>
          </div>
        )}

        <p className="text-xs text-gray-500 mt-3">
          Your keys are encrypted with your wallet signature before uploading to IPFS.
          Only you can decrypt them. Save the CID to restore on another device.
        </p>
      </div>
    </div>
  )
}
