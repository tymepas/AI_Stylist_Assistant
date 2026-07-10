interface StepTipsProps {
  title: string
  tips: string[]
}

/** Small contextual guidance panel shown alongside each analysis step. Purely presentational. */
export default function StepTips({ title, tips }: StepTipsProps) {
  return (
    <div className="rounded-2xl border border-border bg-background/40 p-5">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      <ul className="mt-3 space-y-2.5">
        {tips.map((tip) => (
          <li key={tip} className="flex gap-2 text-sm leading-relaxed text-muted-foreground">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary/60" aria-hidden="true" />
            {tip}
          </li>
        ))}
      </ul>
    </div>
  )
}
