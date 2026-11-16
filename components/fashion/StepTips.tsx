interface StepTipsProps {
  title: string
  tips: string[]
}

/** Short guidance shown beside a step of the analysis. Purely presentational. */
export default function StepTips({ title, tips }: StepTipsProps) {
  return (
    <aside className="surface-quiet h-fit p-5">
      <h4 className="eyebrow">{title}</h4>
      <ul className="mt-3 space-y-2.5">
        {tips.map((tip) => (
          <li key={tip} className="flex gap-2.5 text-sm leading-relaxed text-muted-foreground">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary/70" aria-hidden="true" />
            {tip}
          </li>
        ))}
      </ul>
    </aside>
  )
}
