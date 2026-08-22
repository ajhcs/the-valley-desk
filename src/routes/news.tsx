import { createFileRoute } from '@tanstack/react-router'
import { SectionList } from '../components/SectionList'
import { store } from '../content/store'

export const Route = createFileRoute('/news')({
  component: NewsPage,
})

function NewsPage() {
  return (
    <SectionList
      kicker="Published news"
      title="News"
      items={store.byKind('news')}
      accent="ink"
    />
  )
}
