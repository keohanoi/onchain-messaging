import type { Metadata } from 'next'
import './globals.css'
import { Providers } from '../src/providers'

export const metadata: Metadata = {
  title: 'POMP - Private Onchain Messaging Protocol',
  description: 'Privacy-preserving messaging on the blockchain',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="crt-screen matrix-bg">
            <div className="screen-curve" />
            <div className="noise-overlay" />
            {children}
          </div>
        </Providers>
      </body>
    </html>
  )
}
