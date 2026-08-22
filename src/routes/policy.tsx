import { createFileRoute } from '@tanstack/react-router'
import { SectionList } from '../components/SectionList'
import { store } from '../content/store'

export const Route = createFileRoute('/policy')({
  component: PolicyPage,
})

function PolicyPage() {
  return (
    <SectionList
      kicker="Published policy"
      title="Policy"
      items={store.byKind('policy')}
      accent="ink"
    />
  )
}
