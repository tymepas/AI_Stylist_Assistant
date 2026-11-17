'use client'

import ErrorState from '@/components/fashion/ErrorState'

/**
 * Shown when a dashboard page throws while rendering. Without it an unexpected
 * error leaves a blank page with no way forward. The navigation around it stays
 * usable, and "Try Again" renders the page afresh.
 *
 * The error itself is not shown and not sent anywhere: it can contain what the
 * user entered.
 */
export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorState
      title="Something went wrong"
      message="This page could not be shown. Try again. If it keeps happening, reload the page."
      note={null}
      onRetry={reset}
    />
  )
}
