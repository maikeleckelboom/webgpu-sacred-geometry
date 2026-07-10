import { setPageBodyClass } from "./bodyClasses";
import { startFlowFieldRenderer, type FlowTheme } from "./flowRenderer";
import { startInkFlowRenderer } from "./inkFlowRenderer";
import { connectStudyRenderer, mountStudyFrame, type PageHandle } from "./studyFrame";

const HERO_FLOW_THEME_STORAGE_KEY = "hero-flow-theme";

// Portfolio hero prototype: the dark theme runs the existing aurora flow
// field untouched, while the light theme swaps in the "northern ink"
// renderer (navy streamlines + glowing ring on paper). Each toggle tears
// down the active renderer and boots the other one on a fresh canvas.
export function mountHeroFlowPage(root: HTMLDivElement): PageHandle {
  setPageBodyClass("hero-flow-page-body");
  let currentTheme = getInitialHeroFlowTheme();
  let rendererHandle: PageHandle | null = null;

  const { canvas, status } = mountStudyFrame(root, {
    route: "hero-flow",
    pageClassName: "study-page--hero-flow",
    canvasClassName: "hero-flow-canvas",
    canvasLabel: "WebGPU particle flow field hero background",
    titleId: "hero-flow-title",
    kicker: "WebGPU study 02 / aurora compute flow",
    title: "Particle flow field under northern light.",
    description:
      "A luminous field of routed particles, drifting curtains, and reactive wake lines moving through soft attractors.",
    actions: [
      { href: "/topography", label: "Open topography", variant: "primary" },
      { href: "/architecture", label: "View architecture", variant: "secondary" },
    ],
  });

  const page = root.querySelector<HTMLElement>(".study-page--hero-flow");

  if (!page) {
    throw new Error("The hero flow study page could not be mounted.");
  }

  let currentCanvas = canvas;

  const startRendererForTheme = (theme: FlowTheme): void => {
    rendererHandle?.destroy();
    rendererHandle = null;

    // A fresh canvas per renderer keeps the two WebGPU contexts from
    // fighting over the same surface configuration.
    const freshCanvas = currentCanvas.cloneNode(false) as HTMLCanvasElement;
    freshCanvas.hidden = false;
    currentCanvas.replaceWith(freshCanvas);
    currentCanvas = freshCanvas;
    status.hidden = true;

    rendererHandle = connectStudyRenderer(freshCanvas, status, (targetCanvas) =>
      theme === "dark" ? startFlowFieldRenderer(targetCanvas, "dark") : startInkFlowRenderer(targetCanvas),
    );
  };

  const themeToggle = createHeroFlowThemeToggle();
  page.append(themeToggle);

  const applyTheme = (theme: FlowTheme, restartRenderer: boolean): void => {
    currentTheme = theme;
    page.classList.toggle("is-flow-light", theme === "light");
    document.body.classList.toggle("hero-flow-page-body--light", theme === "light");
    currentCanvas.dataset.flowTheme = theme;
    updateHeroFlowThemeToggle(themeToggle, theme);
    persistHeroFlowTheme(theme);

    if (restartRenderer) {
      startRendererForTheme(theme);
    }
  };

  const handleToggleClick = (): void => {
    applyTheme(currentTheme === "light" ? "dark" : "light", true);
  };

  themeToggle.addEventListener("click", handleToggleClick);
  applyTheme(currentTheme, false);
  startRendererForTheme(currentTheme);

  return {
    destroy: () => {
      themeToggle.removeEventListener("click", handleToggleClick);
      document.body.classList.remove("hero-flow-page-body--light");
      rendererHandle?.destroy();
      rendererHandle = null;
    },
  };
}

function createHeroFlowThemeToggle(): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "flow-theme-toggle";
  button.type = "button";
  button.innerHTML = `
    <span class="flow-theme-toggle__track" aria-hidden="true">
      <span class="flow-theme-toggle__thumb"></span>
    </span>
    <span class="flow-theme-toggle__label"></span>
  `;
  return button;
}

function updateHeroFlowThemeToggle(button: HTMLButtonElement, theme: FlowTheme): void {
  const label = button.querySelector<HTMLSpanElement>(".flow-theme-toggle__label");
  const isLight = theme === "light";

  button.classList.toggle("is-light", isLight);
  button.setAttribute("aria-pressed", String(isLight));
  button.setAttribute(
    "aria-label",
    isLight ? "Switch hero flow to dark theme" : "Switch hero flow to light theme",
  );

  if (label) {
    label.textContent = isLight ? "Light" : "Dark";
  }
}

function getInitialHeroFlowTheme(): FlowTheme {
  try {
    const storedTheme = window.localStorage.getItem(HERO_FLOW_THEME_STORAGE_KEY);
    return storedTheme === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function persistHeroFlowTheme(theme: FlowTheme): void {
  try {
    window.localStorage.setItem(HERO_FLOW_THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can be disabled; the toggle should still work for this page view.
  }
}
