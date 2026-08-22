import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { NAV } from '../content/ia'
import { LogoMark } from './LogoMark'

export function SiteChrome({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-paper text-text">
      <header className="border-b border-ink/20">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-5 py-5">
          <div className="flex items-center gap-3">
            <LogoMark />
            <Link to="/" className="text-2xl font-semibold tracking-tight text-ink">
              The Valley Desk
            </Link>
          </div>
          <nav aria-label="Sections" className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="text-text/80 hover:text-sky [&.active]:font-semibold [&.active]:text-ink"
              >
                {item.label}
              </Link>
            ))}
            <a href="/feed.json" className="ml-auto text-text/70 hover:text-sky">
              /feed.json
            </a>
            <a href="/feed.xml" className="text-text/70 hover:text-sky">
              /feed.xml
            </a>
          </nav>
        </div>
        <div className="h-px bg-admiral" aria-hidden="true" />
      </header>
      <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
      <footer className="border-t border-ink/20">
        <div className="mx-auto max-w-6xl px-5 py-6 text-sm text-text/75">
          <p>Human news + agent feed. Delaware Valley / Greater Philadelphia healthcare technology.</p>
          <p className="mt-2">
            Owner: Cole Lyons (co-founder). Engineering: Knox. Product: Reed. Brand: Mira. CEO: Vale.
          </p>
        </div>
      </footer>
    </div>
  )
}
