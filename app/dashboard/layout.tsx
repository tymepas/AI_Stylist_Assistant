'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import Sidebar from '@/components/fashion/Sidebar'
import { Button } from '@/components/ui/button'

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/dashboard/profile': 'Style Profile',
  '/dashboard/analysis': 'Analysis',
  '/dashboard/settings': 'Settings',
  '/dashboard/history': 'History',
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()
  const title = PAGE_TITLES[pathname] ?? 'Dashboard'

  return (
    <div className="min-h-screen bg-background">
      <Sidebar mobileOpen={mobileOpen} onMobileOpenChange={setMobileOpen} />
      <div className="md:pl-64">
        <header className="sticky top-0 z-40 flex h-16 items-center gap-4 border-b border-border bg-background/80 px-6 backdrop-blur-xl md:px-10">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-medium text-foreground">{title}</h1>
        </header>
        <main className="p-6 md:p-10">{children}</main>
      </div>
    </div>
  )
}
