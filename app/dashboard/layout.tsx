'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, Sparkles } from 'lucide-react'
import Sidebar from '@/components/fashion/Sidebar'
import { Button } from '@/components/ui/button'

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/dashboard/profile': 'Style profile',
  '/dashboard/analysis': 'New analysis',
  '/dashboard/settings': 'Settings',
  '/dashboard/history': 'History',
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()
  const title = PAGE_TITLES[pathname] ?? 'Dashboard'
  const onAnalysis = pathname === '/dashboard/analysis'

  return (
    <div className="min-h-screen bg-background">
      <Sidebar mobileOpen={mobileOpen} onMobileOpenChange={setMobileOpen} />
      <div className="md:pl-64">
        <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-xl sm:px-6 md:px-10">
          <Button variant="ghost" size="icon" className="focus-ring md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu className="h-5 w-5" aria-hidden="true" />
          </Button>
          <h1 className="eyebrow min-w-0 flex-1 truncate">{title}</h1>
          {!onAnalysis ? (
            <Button asChild size="sm" className="focus-ring">
              <Link href="/dashboard/analysis"><Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> New analysis</Link>
            </Button>
          ) : null}
        </header>
        {/* Keyed by the route, so each page eases in when it is opened. Instant when motion is reduced. */}
        <main key={pathname} className="animate-page-in px-4 py-8 sm:px-6 md:px-10 md:py-12">{children}</main>
      </div>
    </div>
  )
}
