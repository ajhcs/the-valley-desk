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
import type { ContentItem } from "./content/schema";

const rootRoute = createRootRoute({
  component: Layout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

function section(path: string, kind: ContentItem["kind"]) {
  const list = createRoute({
    getParentRoute: () => rootRoute,
    path,
    component: () => <KindListPage kind={kind} />,
  });
  const detail = createRoute({
    getParentRoute: () => rootRoute,
    path: path + "/$slug",
    component: function Detail() {
      const { slug } = detail.useParams();
      return <ItemPage slug={slug} />;
    },
  });
  return [list, detail];
}

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

// Reed v1 lock: do not mint /org/{id} or generate entity pages from the seed.
const routeTree = rootRoute.addChildren([
  indexRoute,
  ...section("/news", "news"),
  ...section("/events", "event"),
  ...section("/voices", "voice"),
  briefingRoute,
  briefingSlugRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
