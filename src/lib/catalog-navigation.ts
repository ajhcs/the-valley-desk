function separateReadSurface(pathname: string) {
  return /^\/(?:policy-watch|technology-watch)(?:\/|$)/.test(pathname) || /^\/policy\/?$/.test(pathname);
}

export function catalogDependentPath(pathname: string) {
  return pathname === "/" || /^\/(?:news|events|voices|lab)(?:\/|$)/.test(pathname);
}

/** The legacy catalog is initialized once per document. Refresh it before any
 * legacy view after visiting a surface with an independent read model. */
export function createCatalogNavigationBoundary(initialPathname = "/") {
  let separateReadVisited = separateReadSurface(initialPathname);
  return {
    shouldReload(pathname: string, preload = false) {
      if (preload) return false;
      if (separateReadSurface(pathname)) separateReadVisited = true;
      return separateReadVisited && catalogDependentPath(pathname);
    },
  };
}

export function sameOriginDocumentHref(href: string, origin: string) {
  const target = new URL(href, origin);
  if (target.origin !== new URL(origin).origin || target.username || target.password) {
    throw new TypeError("Catalog navigation must remain same-origin");
  }
  return `${target.pathname}${target.search}${target.hash}`;
}

type BrowserNavigation = {
  location: Pick<Location, "origin" | "pathname" | "search" | "hash" | "reload">;
  history: Pick<History, "state" | "replaceState">;
};

export function reloadActiveCatalogDocument(href: string, browser: BrowserNavigation) {
  const target = new URL(sameOriginDocumentHref(href, browser.location.origin), browser.location.origin);
  if (target.pathname !== browser.location.pathname || target.search !== browser.location.search) return false;
  // Replacing a current URL with a fragment may stay in the same document.
  if (target.hash !== browser.location.hash) browser.history.replaceState(browser.history.state, "", href);
  browser.location.reload();
  return true;
}
