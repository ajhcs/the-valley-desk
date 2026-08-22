import { createFileRoute } from '@tanstack/react-router'
import { SectionList } from '../components/SectionList'
import { store } from '../content/store'

export const Route = createFileRoute('/voices')({
  component: VoicesPage,
})

function VoicesPage() {
  return (
    <SectionList
      kicker="Published voices"
      title="Voices"
      items={store.byKind('voice')}
      accent="ink"
    />
  )
}
