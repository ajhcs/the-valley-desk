import { Link } from '@tanstack/react-router'
import type { NewsItem } from '../content/schema'
import { formatPublished } from '../lib/format'

export function NewsRail({ items }: { items: NewsItem[] }) {
  return (
    <section aria-labelledby="news-rail-heading" className="border-l-4 border-ink pl-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 id="news-rail-heading" className="text-sm font-semibold uppercase tracking-[0.14em] text-ink">
          Latest
        </h2>
        <Link to="/news" className="text-sm text-ink/70 hover:text-sky">
          All news
        </Link>
      </div>
      <ul className="divide-y divide-ink/15">
        {items.map((item) => (
          <li key={item.id} className="py-4 first:pt-0">
            <p className="text-xs uppercase tracking-wide text-ink/70">
              {formatPublished(item)}
            </p>
            <h3 className="mt-1 text-xl leading-snug text-ink">{item.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-text/80">{item.dek}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
