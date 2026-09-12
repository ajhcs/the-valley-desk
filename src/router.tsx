import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from "@tanstack/react-router";
import { Layout } from "./ui/Layout";
import { HomePage } from "./ui/HomePage";
import { KindListPage } from "./ui/KindListPage";
import { EventsPage } from "./ui/EventsPage";
import { ItemPage } from "./ui/ItemPage";
import { NotFound } from "./ui/NotFound";
import { OpsPage } from "./ui/OpsPage";
import { PolicyBaselinePage } from "./ui/PolicyBaselinePage";
import { LabIndexPage } from "./ui/lab/LabIndexPage";
import { LabChronoPage } from "./ui/lab/LabChronoPage";
import { LabSystemsPage } from "./ui/lab/LabSystemsPage";
import { LabHorizonPage } from "./ui/lab/LabHorizonPage";
import { LabCalendarPage } from "./ui/lab/LabCalendarPage";
import { parsePlainSearch, stringifyPlainSearch } from "./lib/plain-search";

const WatchDirectoryPage = lazyRouteComponent(() => import("./ui/watch/WatchDirectoryPage"), "WatchDirectoryPage");
const WatchDetailPage = lazyRouteComponent(() => import("./ui/watch/WatchDetailPage"), "WatchDetailPage");

const rootRoute = createRootRoute({
  component: Layout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

const opsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ops",
  component: OpsPage,
});
const policyRoute = createRoute({ getParentRoute: () => rootRoute, path: "/policy", component: PolicyBaselinePage });

const labIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/lab",
  component: LabIndexPage,
});

const labBriefingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/lab/briefing",
  component: LabChronoPage,
});

const labSystemsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/lab/systems",
  component: LabSystemsPage,
});

const labHorizonRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/lab/horizon",
  component: LabHorizonPage,
});

const labCalendarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/lab/calendar",
  component: LabCalendarPage,
});

function section<TPath extends string>(path: TPath, kind: "news" | "event" | "voice") {
  const list = createRoute({
    getParentRoute: () => rootRoute,
    path,
    component: () => kind === "event" ? <EventsPage /> : <KindListPage kind={kind} />,
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

function watchSection<TPath extends string>(path: TPath, kind: "policy" | "technology") {
  const pendingComponent = () => <p role="status">Loading Watch...</p>;
  const directory = createRoute({ getParentRoute: () => rootRoute, path, wrapInSuspense: true, pendingComponent,
    component: () => <WatchDirectoryPage kind={kind} /> });
  const detail = createRoute({ getParentRoute: () => rootRoute, path: `${path}/$slug` as `${TPath}/$slug`, wrapInSuspense: true, pendingComponent,
    component: function WatchDetail() {
      const { slug } = detail.useParams() as { slug: string };
      return <WatchDetailPage kind={kind} slug={slug} />;
    },
  });
  return [directory, detail];
}

// Reed v1 lock: do not mint org-id routes or generate entity pages from the seed.
// Briefing stays unpublished. Worker 404s unpublished, /org, and unknown as HTML shell.
const routeTree = rootRoute.addChildren([
  indexRoute,
  opsRoute,
  policyRoute,
  ...section("/news", "news"),
  ...section("/events", "event"),
  ...section("/voices", "voice"),
  ...watchSection("/policy-watch", "policy"),
  ...watchSection("/technology-watch", "technology"),
  labIndexRoute,
  labBriefingRoute,
  labSystemsRoute,
  labHorizonRoute,
  labCalendarRoute,
]);

export const router = createRouter({
  routeTree,
  // Existing consumers use scalar list fields; object-valued query state is unsupported.
  parseSearch: parsePlainSearch,
  stringifySearch: stringifyPlainSearch,
  defaultNotFoundComponent: NotFound,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
