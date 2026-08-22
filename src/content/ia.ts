import type { ContentKind } from './schema'

export const NAV = [
  { kind: 'news' as const, to: '/news', label: 'News' },
  { kind: 'event' as const, to: '/events', label: 'Events' },
  { kind: 'voice' as const, to: '/voices', label: 'Voices' },
  { kind: 'policy' as const, to: '/policy', label: 'Policy' },
  { kind: 'ai' as const, to: '/ai', label: 'AI' },
  { kind: 'briefing' as const, to: '/briefing', label: 'Briefing' },
] as const

export function sectionMeta(kind: Exclude<ContentKind, 'interview'>): {
  to: (typeof NAV)[number]['to']
  label: string
  kicker: string
} {
  switch (kind) {
    case 'news':
      return { to: '/news', label: 'News', kicker: 'Published news' }
    case 'event':
      return { to: '/events', label: 'Events', kicker: 'Published events' }
    case 'voice':
      return { to: '/voices', label: 'Voices', kicker: 'Published voices' }
    case 'policy':
      return { to: '/policy', label: 'Policy', kicker: 'Published policy' }
    case 'ai':
      return { to: '/ai', label: 'AI', kicker: 'Published AI' }
    case 'briefing':
      return { to: '/briefing', label: 'Briefing', kicker: 'Published briefings' }
  }
}
