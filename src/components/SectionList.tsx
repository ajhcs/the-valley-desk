import type { ContentItem } from '../content/schema'
import { formatEventPlace, formatEventWhen, formatPublished } from '../lib/format'

export function SectionList({
  kicker,
  title,
  items,
  accent,
}: {
  kicker: string
  title: string
  items: ContentItem[]
  accent: 'ink' | 'events'
}) {
  const rule = accent === 'events' ? 'border-events' : 'border-ink'
  const kickerColor = accent === 'events' ? 'text-events' : 'text-ink'
  const titleColor = accent === 'events' ? 'text-events' : 'text-ink'

  return (
    <section className={`border-l-4 ${rule} pl-5`}>
      <p className={`text-sm font-semibold uppercase tracking-[0.14em] ${kickerColor}`}>
        {kicker}
      </p>
      <h1 className={`mt-2 text-3xl ${titleColor}`}>{title}</h1>
      {items.length === 0 ? (
        <p className="mt-6 text-text/75">Nothing published in this section yet.</p>
      ) : (
        <ul className="mt-6 divide-y divide-ink/15">
          {items.map((item) => (
            <li key={item.id} className="py-5">
              <p className={`text-xs uppercase tracking-wide ${kickerColor}`}>
                {item.kind === 'event'
                  ? formatEventWhen(item)
                  : formatPublished(item) ?? item.kind}
              </p>
              <h2 className={`mt-1 text-xl leading-snug ${titleColor}`}>{item.title}</h2>
              <p className="mt-1 text-sm leading-relaxed text-text/80">{item.dek}</p>
              {item.kind === 'event' ? (
                <p className="mt-1 text-sm text-text/70">
                  {[formatEventPlace(item), item.hostOrg].filter(Boolean).join(' · ')}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
