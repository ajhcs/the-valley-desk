import {
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { Layout } from "./ui/Layout";
import { HomePage } from "./ui/HomePage";
import { KindListPage } from "./ui/KindListPage";
import { ItemPage } from "./ui/ItemPage";
import { BriefingPage } from "./ui/BriefingPage";

const rootRoute = createRootRoute({
  component: Layout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

const newsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/news",
  component: () => <KindListPage kind="news" />,
});
const newsSlugRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/news/$slug",
  component: function NewsSlug() {
    const { slug } = newsSlugRoute.useParams();
    return <ItemPage slug={slug} />;
  },
});

const eventsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/events",
  component: () => <KindListPage kind="event" />,
});
const eventsSlugRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/events/$slug",
  component: function EventsSlug() {
    const { slug } = eventsSlugRoute.useParams();
    return <ItemPage slug={slug} />;
  },
});

const voicesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/voices",
  component: () => <KindListPage kind="voice" />,
});
const voicesSlugRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/voices/$slug",
  component: function VoicesSlug() {
    const { slug } = voicesSlugRoute.useParams();
    return <ItemPage slug={slug} />;
  },
});

const policyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/policy",
  component: () => <KindListPage kind="policy" />,
});
const policySlugRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/policy/$slug",
  component: function PolicySlug() {
    const { slug } = policySlugRoute.useParams();
    return <ItemPage slug={slug} />;
  },
});

const aiRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ai",
  component: () => <KindListPage kind="ai" />,
});
const aiSlugRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ai/$slug",
  component: function AiSlug() {
    const { slug } = aiSlugRoute.useParams();
    return <ItemPage slug={slug} />;
  },
});

const briefingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/briefing",
  component: BriefingPage,
});

const briefingSlugRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/briefing/$slug",
  component: function BriefingSlug() {
    const { slug } = briefingSlugRoute.useParams();
    return <ItemPage slug={slug} />;
  },
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  newsRoute,
  newsSlugRoute,
  eventsRoute,
  eventsSlugRoute,
  voicesRoute,
  voicesSlugRoute,
  policyRoute,
  policySlugRoute,
  aiRoute,
  aiSlugRoute,
  briefingRoute,
  briefingSlugRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
