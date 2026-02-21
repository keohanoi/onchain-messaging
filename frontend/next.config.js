/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    // Suppress warnings from optional dependencies
    config.ignoreWarnings = [
      // MetaMask SDK trying to import React Native packages in web context
      { module: /@metamask\/sdk/ },
      // WalletConnect pino-pretty optional dependency
      { module: /pino/ },
      // circomlibjs web-worker dynamic require
      { module: /web-worker/ },
    ]

    // Fallback for node modules in browser
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        child_process: false,
        worker_threads: false,
      }
    }

    return config
  },
}

module.exports = nextConfig
