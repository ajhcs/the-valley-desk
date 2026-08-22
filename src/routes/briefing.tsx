import { createFileRoute } from '@tanstack/react-router'
import { SectionList } from '../components/SectionList'
import { store } from '../content/store'

export const Route = createFileRoute('/briefing')({
  component: BriefingPage,
})

function BriefingPage() {
  return (
    <SectionList
      kicker="Published briefings"
      title="Briefing"
      items={store.byKind('briefing')}
      accent="ink"
    />
  )
}
