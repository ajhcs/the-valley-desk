import { createFileRoute } from '@tanstack/react-router'
import { SectionList } from '../components/SectionList'
import { store } from '../content/store'

export const Route = createFileRoute('/ai')({
  component: AiPage,
})

function AiPage() {
  return (
    <SectionList
      kicker="Published AI"
      title="AI"
      items={store.byKind('ai')}
      accent="ink"
    />
  )
}
