'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { History, LayoutDashboard, LucideIcon, Settings, Sparkles, UserCircle2 } from 'lucide-react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

interface NavItem {
  label: string
  href: string
  icon: LucideIcon
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'New analysis', href: '/dashboard/analysis', icon: Sparkles },
  { label: 'Style profile', href: '/dashboard/profile', icon: UserCircle2 },
  { label: 'History', href: '/dashboard/history', icon: History },
  { label: 'Settings', href: '/dashboard/settings', icon: Settings },
]

function SidebarContent({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <Link href="/" onClick={onNavigate} className="focus-ring mx-3 mt-4 flex items-baseline gap-2 rounded-lg px-3 py-3" aria-label="Verdict home">
        <span className="font-display text-3xl text-foreground">Verdict</span>
        <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
      </Link>

      <nav className="mt-6 flex-1 space-y-1 px-3" aria-label="Primary">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'focus-ring press flex items-center gap-3 rounded-full px-4 py-2.5 text-sm transition-colors',
                active ? 'bg-primary/10 font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
              )}
            >
              <item.icon className={cn('h-4 w-4 shrink-0', active && 'text-primary')} aria-hidden="true" />
              {item.label}
            </Link>
          )
        })}
      </nav>

      <p className="px-6 py-6 text-xs leading-relaxed text-muted-foreground/80">
        Verdicts are calculated by the app from six ratings. The AI never sets them.
      </p>
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
        <SheetContent side="left" className="w-72 border-border bg-sidebar p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarContent pathname={pathname} onNavigate={() => onMobileOpenChange(false)} />
        </SheetContent>
      </Sheet>
    </>
  )
}
