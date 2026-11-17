'use client'

import { AlertTriangle, LucideIcon, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ErrorStateProps {
  title: string
  message: string
  icon?: LucideIcon
  onRetry: () => void
  retryLabel?: string
  /** A line under the message. Defaults to the reassurance that fits a failed analysis; pass null where it would not be true. */
  note?: string | null
}

/**
 * A failed or impossible analysis. It says what happened in plain words and
 * offers one way forward. Nothing is retried automatically: every attempt is a
 * new request, so the user decides.
 */
export default function ErrorState({ title, message, icon: Icon = AlertTriangle, onRetry, retryLabel = 'Try Again', note = 'Your photos and choices are still here.' }: ErrorStateProps) {
  return (
    <div className="surface animate-rise mx-auto flex min-h-[420px] max-w-3xl flex-col items-start justify-center p-6 sm:p-12" role="alert">
      <span className="flex h-12 w-12 items-center justify-center rounded-full border border-verdict-low/30 bg-verdict-low/10">
        <Icon className="h-5 w-5 text-verdict-low" aria-hidden="true" />
      </span>
      <h3 className="mt-6 font-display text-4xl text-foreground sm:text-5xl">{title}</h3>
      <p className="mt-3 max-w-lg text-base leading-relaxed text-muted-foreground">{message}</p>
      {note ? <p className="mt-2 text-sm text-muted-foreground/80">{note}</p> : null}
      <Button onClick={onRetry} size="lg" className="focus-ring mt-8">
        <RotateCcw className="h-4 w-4" aria-hidden="true" />
        {retryLabel}
      </Button>
    </div>
  )
}
