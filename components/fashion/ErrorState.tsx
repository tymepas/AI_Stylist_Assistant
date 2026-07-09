'use client'

import { LucideIcon, AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ErrorStateProps {
  title: string
  message: string
  icon?: LucideIcon
  onRetry: () => void
  retryLabel?: string
}

export default function ErrorState({ title, message, icon: Icon = AlertTriangle, onRetry, retryLabel = 'Try Again' }: ErrorStateProps) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-border bg-card/40 px-6 py-20 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
        <Icon className="h-6 w-6 text-destructive" />
      </div>
      <h3 className="mt-6 text-lg font-medium text-foreground">{title}</h3>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">{message}</p>
      <Button onClick={onRetry} className="mt-8" variant="outline">
        <RotateCcw className="mr-2 h-4 w-4" />
        {retryLabel}
      </Button>
    </div>
  )
}
