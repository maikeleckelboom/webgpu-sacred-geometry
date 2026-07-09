import { setPageBodyClass } from "./bodyClasses";
import { startFlowFieldRenderer, type FlowFieldRenderer, type FlowTheme } from "./flowRenderer";
import { connectStudyRenderer, mountStudyFrame, type PageHandle } from "./studyFrame";

const FLOW_THEME_STORAGE_KEY = "flow-field-theme";

export function mountFlowFieldPage(root: HTMLDivElement): PageHandle {
  setPageBodyClass("flow-page-body");
  let currentTheme = getInitialFlowTheme();
  let renderer: FlowFieldRenderer | null = null;

  const { canvas, status } = mountStudyFrame(root, {
    route: "flow-field",
    pageClassName: "study-page--flow",
    canvasClassName: "flow-canvas",
    canvasLabel: "Aurora WebGPU particle flow field",
    titleId: "flow-title",
    kicker: "WebGPU study 02 / aurora compute flow",
    title: "Particle flow field under northern light.",
    description:
      "A luminous field of routed particles, drifting curtains, and reactive wake lines moving through soft attractors.",
    actions: [
      { href: "/topography", label: "Open topography", variant: "primary" },
      { href: "/architecture", label: "View architecture", variant: "secondary" },
    ],
  });

  const page = root.querySelector<HTMLElement>(".study-page--flow");

  if (!page) {
    throw new Error("The flow study page could not be mounted.");
  }

  const themeToggle = createFlowThemeToggle();
  page.append(themeToggle);

  const applyTheme = (theme: FlowTheme): void => {
    currentTheme = theme;
    page.classList.toggle("is-flow-light", theme === "light");
    document.body.classList.toggle("flow-page-body--light", theme === "light");
    canvas.dataset.flowTheme = theme;
    renderer?.setTheme(theme);
    updateFlowThemeToggle(themeToggle, theme);
    persistFlowTheme(theme);
  };

  const handleToggleClick = (): void => {
    applyTheme(currentTheme === "light" ? "dark" : "light");
  };

  themeToggle.addEventListener("click", handleToggleClick);
  applyTheme(currentTheme);

  const pageHandle = connectStudyRenderer(
    canvas,
    status,
    (targetCanvas) => startFlowFieldRenderer(targetCanvas, currentTheme),
    (activeRenderer) => {
      renderer = activeRenderer;
      activeRenderer.setTheme(currentTheme);
    },
  );

  return {
    destroy: () => {
      themeToggle.removeEventListener("click", handleToggleClick);
      document.body.classList.remove("flow-page-body--light");
      pageHandle.destroy();
      renderer = null;
    },
  };
}

function createFlowThemeToggle(): HTMLButtonElement {
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

function updateFlowThemeToggle(button: HTMLButtonElement, theme: FlowTheme): void {
  const label = button.querySelector<HTMLSpanElement>(".flow-theme-toggle__label");
  const isLight = theme === "light";

  button.classList.toggle("is-light", isLight);
  button.setAttribute("aria-pressed", String(isLight));
  button.setAttribute(
    "aria-label",
    isLight ? "Switch flow field to dark theme" : "Switch flow field to light theme",
  );

  if (label) {
    label.textContent = isLight ? "Light" : "Dark";
  }
}

function getInitialFlowTheme(): FlowTheme {
  try {
    const storedTheme = window.localStorage.getItem(FLOW_THEME_STORAGE_KEY);
    return storedTheme === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function persistFlowTheme(theme: FlowTheme): void {
  try {
    window.localStorage.setItem(FLOW_THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can be disabled; the toggle should still work for this page view.
  }
}
