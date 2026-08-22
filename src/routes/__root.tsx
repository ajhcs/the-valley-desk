import { Outlet, createRootRoute } from '@tanstack/react-router'
import { SiteChrome } from '../components/SiteChrome'

const RootLayout = () => (
  <SiteChrome>
    <Outlet />
  </SiteChrome>
)

export const Route = createRootRoute({
  component: RootLayout,
})
