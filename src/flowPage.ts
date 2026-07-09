import { setPageBodyClass } from "./bodyClasses";
import { startFlowFieldRenderer, type FieldMode, type FlowFieldRenderer } from "./flowRenderer";
import { mountStudyFrame, type PageHandle } from "./studyFrame";

const ROUTE_TO_MODE: Record<string, FieldMode> = {
  "flow-field": "flow",
  topography: "topo",
  architecture: "arch",
  waves: "waves",
};

export function mountFlowFieldPage(root: HTMLDivElement): PageHandle {
  setPageBodyClass("flow-page-body");

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

  let renderer: FlowFieldRenderer | null = null;
  let disposed = false;
  const abortController = new AbortController();

  const navLinks = Array.from(
    document.querySelectorAll<HTMLAnchorElement>(".lab-nav__link[data-route]"),
  );

  const handlePointerEnter = (event: Event): void => {
    const link = event.currentTarget;
    if (!(link instanceof HTMLAnchorElement)) {
      return;
    }
    const route = link.dataset.route;
    if (!route) {
      return;
    }
    const mode = ROUTE_TO_MODE[route] ?? "flow";
    renderer?.setMode(mode);
  };

  const handlePointerLeave = (event: Event): void => {
    const link = event.currentTarget;
    if (!(link instanceof HTMLAnchorElement)) {
      return;
    }
    if (link.classList.contains("is-active")) {
      return;
    }
    renderer?.setMode("flow");
  };

  navLinks.forEach((link) => {
    link.addEventListener("pointerenter", handlePointerEnter, { signal: abortController.signal });
    link.addEventListener("pointerleave", handlePointerLeave, { signal: abortController.signal });
  });

  startFlowFieldRenderer(canvas)
    .then((activeRenderer) => {
      if (disposed) {
        activeRenderer.destroy();
        return;
      }
      renderer = activeRenderer;
    })
    .catch((error: unknown) => {
      if (disposed) {
        return;
      }
      const message = error instanceof Error ? error.message : "WebGPU initialization failed.";
      canvas.hidden = true;
      status.hidden = false;
      status.textContent = message;
    });

  return {
    destroy: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      abortController.abort();
      renderer?.destroy();
      renderer = null;
    },
  };
}
