import { createFileRoute } from '@tanstack/react-router'
import { EventsRail } from '../components/EventsRail'
import { NewsRail } from '../components/NewsRail'
import { store } from '../content/store'

export const Route = createFileRoute('/')({
  component: HomePage,
})

function HomePage() {
  const news = store.latestNews()
  const events = store.upcomingEvents()

  return (
    <div className="grid gap-12 lg:grid-cols-2">
      <NewsRail items={news} />
      <EventsRail items={events} />
    </div>
  )
}
