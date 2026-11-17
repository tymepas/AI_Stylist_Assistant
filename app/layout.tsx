import type { Metadata, Viewport } from 'next'
import { Instrument_Serif, Inter } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'

export const metadata: Metadata = {
  title: 'Verdict — Know Before You Buy',
  description:
    'An AI Fashion Decision Assistant that helps you make confident clothing purchase decisions before you spend money.',
}

// Self-hosted by Next.js at build time: no request to a font CDN from the browser.
const sans = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-sans' })
const display = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], display: 'swap', variable: '--font-display' })

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#100f0e',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${sans.variable} ${display.variable}`} suppressHydrationWarning>
      <body className="bg-background text-foreground antialiased" suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
