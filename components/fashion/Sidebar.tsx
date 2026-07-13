'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  UserCircle2,
  Sparkles,
  Settings,
  LucideIcon,
} from 'lucide-react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

interface NavItem {
  label: string
  href: string
  icon: LucideIcon
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Style Profile', href: '/dashboard/profile', icon: UserCircle2 },
  { label: 'Analysis', href: '/dashboard/analysis', icon: Sparkles },
  { label: 'Settings', href: '/dashboard/settings', icon: Settings },
]

function SidebarContent({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <Link href="/" onClick={onNavigate} className="focus-ring flex items-center gap-2 rounded-lg px-6 py-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
          <Sparkles className="h-4 w-4 text-primary-foreground" aria-hidden="true" />
        </div>
        <span className="text-lg font-semibold tracking-tight text-foreground">Verdict</span>
      </Link>
      <nav className="flex-1 space-y-1 px-3" aria-label="Primary">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'focus-ring relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              )}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary" aria-hidden="true" />
              )}
              <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {item.label}
            </Link>
          )
        })}
      </nav>
      <div className="px-6 py-6">
        <div className="rounded-xl border border-border bg-card/50 px-3 py-2 text-center text-[11px] text-muted-foreground">
          Phase 1 MVP · v0.1
        </div>
      </div>
    </div>
  )
}

interface SidebarProps {
  mobileOpen: boolean
  onMobileOpenChange: (open: boolean) => void
}

export default function Sidebar({ mobileOpen, onMobileOpenChange }: SidebarProps) {
  const pathname = usePathname()

  return (
    <>
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-border bg-sidebar md:flex">
        <SidebarContent pathname={pathname} />
      </aside>
      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetContent side="left" className="w-64 border-border bg-sidebar p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarContent pathname={pathname} onNavigate={() => onMobileOpenChange(false)} />
        </SheetContent>
      </Sheet>
    </>
  )
}
