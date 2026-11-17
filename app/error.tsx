'use client'

import ErrorState from '@/components/fashion/ErrorState'

/**
 * Shown when a page outside the dashboard throws while rendering, instead of a
 * blank page. The error itself is not shown and not sent anywhere.
 */
export default function RootError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-screen items-center bg-background px-4 py-12">
      <ErrorState
        title="Something went wrong"
        message="This page could not be shown. Try again. If it keeps happening, reload the page."
        note={null}
        onRetry={reset}
      />
    </main>
  )
}
