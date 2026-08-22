import { createFileRoute } from '@tanstack/react-router'
import { SectionList } from '../components/SectionList'
import { store } from '../content/store'

export const Route = createFileRoute('/events')({
  component: EventsPage,
})

function EventsPage() {
  return (
    <SectionList
      kicker="Published events"
      title="Events"
      items={store.byKind('event')}
      accent="events"
    />
  )
}
