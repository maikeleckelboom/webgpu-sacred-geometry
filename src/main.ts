import "./style.css";
import { mountAuroraPage } from "./auroraPage";
import { mountFlowFieldPage } from "./flowPage";
import { mountFlowSheetPage } from "./flowSheetPage";
import { mountHeroFlowPage } from "./heroFlowPage";
import { mountLivingGlassPage } from "./livingGlassPage";
import { createLabHeader, setLabHeaderActive, type LabRoute } from "./navigation";
import { mountTopographyPage } from "./topographyPage";
import type { PageHandle } from "./studyFrame";

interface PageRoute {
  mount: (root: HTMLDivElement) => PageHandle;
  route: LabRoute;
}

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("The app root could not be mounted.");
}

const appRoot = app;

const pageRoutes: Record<string, PageRoute> = {
  "/": { mount: mountFlowFieldPage, route: "flow-field" },
  "/flow-field": { mount: mountFlowFieldPage, route: "flow-field" },
  "/flow-sheet": { mount: mountFlowSheetPage, route: "flow-sheet" },
  "/hero-flow": { mount: mountHeroFlowPage, route: "hero-flow" },
  "/aurora": { mount: mountAuroraPage, route: "aurora" },
  "/topography": { mount: mountTopographyPage, route: "topography" },
  "/living-glass": { mount: mountLivingGlassPage, route: "living-glass" },
};

const initialPageRoute = getPageRoute(normalizePathname(window.location.pathname));
appRoot.innerHTML = `
  ${createLabHeader(initialPageRoute.route)}
  <div class="study-route-root" data-study-route-root></div>
`;

const routeRoot = appRoot.querySelector<HTMLDivElement>("[data-study-route-root]");

if (!routeRoot) {
  throw new Error("The route root could not be mounted.");
}

const routeRootElement = routeRoot;

let activePage: PageHandle | null = null;
let activeRouteKey = "";

mountCurrentUrl(false);

document.addEventListener("click", (event) => {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.altKey ||
    event.ctrlKey ||
    event.shiftKey
  ) {
    return;
  }

  const target = event.target;

  if (!(target instanceof Element)) {
    return;
  }

  const link = target.closest<HTMLAnchorElement>("a[href]");

  if (!link || link.target || link.hasAttribute("download")) {
    return;
  }

  const nextUrl = new URL(link.href);

  if (
    nextUrl.origin !== window.location.origin ||
    !isKnownRoute(normalizePathname(nextUrl.pathname))
  ) {
    return;
  }

  event.preventDefault();

  const nextRouteKey = createRouteKey(nextUrl);

  if (nextRouteKey === activeRouteKey) {
    return;
  }

  history.pushState(null, "", nextUrl);
  mountCurrentUrl(true);
});

window.addEventListener("popstate", () => {
  mountCurrentUrl(true);
});

function mountCurrentUrl(animateCanvas: boolean): void {
  const nextUrl = new URL(window.location.href);
  const updatePage = (): void => {
    activePage?.destroy();
    activePage = null;
    window.scrollTo(0, 0);

    const nextPath = normalizePathname(nextUrl.pathname);
    const nextRoute = getPageRoute(nextPath);
    activePage = nextRoute.mount(routeRootElement);
    setLabHeaderActive(nextRoute.route);
    activeRouteKey = createRouteKey(nextUrl);

    if (animateCanvas && !prefersReducedMotion()) {
      animateCanvasFallback();
    }
  };

  updatePage();
}

function animateCanvasFallback(): void {
  const page = routeRootElement.querySelector(".study-page");

  if (!(page instanceof HTMLElement)) {
    return;
  }

  page.classList.add("is-canvas-entering");
  window.setTimeout(() => {
    page.classList.remove("is-canvas-entering");
  }, 460);
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function normalizePathname(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, "");
  return normalized === "" ? "/" : normalized;
}

function createRouteKey(url: URL): string {
  return `${normalizePathname(url.pathname)}${url.search}`;
}

function isKnownRoute(pathname: string): boolean {
  return pathname in pageRoutes;
}

function getPageRoute(pathname: string): PageRoute {
  return pageRoutes[pathname] ?? pageRoutes["/"];
}
