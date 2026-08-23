import {
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { Layout } from "./ui/Layout";
import { HomePage } from "./ui/HomePage";
import { KindListPage } from "./ui/KindListPage";
import { ItemPage } from "./ui/ItemPage";

const rootRoute = createRootRoute({
  component: Layout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

function section<TPath extends string>(path: TPath, kind: "news" | "event" | "voice") {
  const list = createRoute({
    getParentRoute: () => rootRoute,
    path,
    component: () => <KindListPage kind={kind} />,
  });
  const detail = createRoute({
    getParentRoute: () => rootRoute,
    path: `${path}/$slug` as `${TPath}/$slug`,
    component: function Detail() {
      const { slug } = detail.useParams() as { slug: string };
      return <ItemPage slug={slug} section={kind} />;
    },
  });
  return [list, detail];
}

// Reed v1 lock: do not mint org-id routes or generate entity pages from the seed.
// Briefing stays unpublished. Worker 404s /briefing as text/plain.
const routeTree = rootRoute.addChildren([
  indexRoute,
  ...section("/news", "news"),
  ...section("/events", "event"),
  ...section("/voices", "voice"),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
