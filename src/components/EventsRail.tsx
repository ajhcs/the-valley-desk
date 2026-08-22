import { Link } from '@tanstack/react-router'
import type { EventItem } from '../content/schema'
import { formatEventPlace, formatEventWhen } from '../lib/format'

export function EventsRail({ items }: { items: EventItem[] }) {
  return (
    <section aria-labelledby="events-rail-heading" className="border-l-4 border-events pl-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2
          id="events-rail-heading"
          className="text-sm font-semibold uppercase tracking-[0.14em] text-events"
        >
          Upcoming
        </h2>
        <Link to="/events" className="text-sm text-events/80 hover:text-sky">
          All events
        </Link>
      </div>
      <ul className="divide-y divide-events/25">
        {items.map((item) => (
          <li key={item.id} className="py-4 first:pt-0">
            <p className="text-xs uppercase tracking-wide text-events">{formatEventWhen(item)}</p>
            <h3 className="mt-1 text-xl leading-snug text-events">{item.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-text/80">{item.dek}</p>
            <p className="mt-1 text-sm text-text/70">
              {[formatEventPlace(item), item.hostOrg].filter(Boolean).join(' · ')}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}
