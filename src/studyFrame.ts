import type { LabRoute } from "./navigation";

export interface StudyAction {
  href: string;
  label: string;
  variant: "primary" | "secondary";
}

export interface StudyFrameOptions {
  route: LabRoute;
  pageClassName: string;
  canvasClassName: string;
  canvasLabel: string;
  titleId: string;
  kicker?: string;
  title: string;
  description: string;
  actions: StudyAction[];
}

export interface RendererHandle {
  destroy: () => void;
}

export interface PageHandle {
  destroy: () => void;
}

interface StudyFrameElements {
  canvas: HTMLCanvasElement;
  status: HTMLDivElement;
}

export function mountStudyFrame(
  root: HTMLDivElement,
  options: StudyFrameOptions,
): StudyFrameElements {
  const kickerMarkup = options.kicker
    ? `<p class="study-kicker">${escapeHtml(options.kicker)}</p>`
    : "";

  root.innerHTML = `
    <div class="study-page ${options.pageClassName}" data-route="${options.route}">
      <div class="study-canvas-layer" aria-hidden="true">
        <canvas class="study-canvas ${options.canvasClassName}" aria-label="${escapeHtml(options.canvasLabel)}"></canvas>
      </div>

      <main class="study-hero" aria-labelledby="${options.titleId}">
        ${kickerMarkup}
        <h1 id="${options.titleId}">${escapeHtml(options.title)}</h1>
        <p class="study-subtitle">${escapeHtml(options.description)}</p>
        <div class="study-actions" aria-label="Primary actions">
          ${options.actions.map(createActionMarkup).join("")}
        </div>
      </main>

      <div class="study-status" role="status" hidden></div>
    </div>
  `;

  const canvas = root.querySelector<HTMLCanvasElement>(".study-canvas");
  const status = root.querySelector<HTMLDivElement>(".study-status");

  if (!canvas || !status) {
    throw new Error("The study page frame could not be mounted.");
  }

  return { canvas, status };
}

export function connectStudyRenderer<T extends RendererHandle>(
  canvas: HTMLCanvasElement,
  status: HTMLDivElement,
  startRenderer: (canvas: HTMLCanvasElement) => Promise<T>,
  onRenderer?: (renderer: T) => void,
): PageHandle {
  const abortController = new AbortController();
  let renderer: RendererHandle | null = null;
  let disposed = false;

  const destroy = (): void => {
    if (disposed) {
      return;
    }

    disposed = true;
    abortController.abort();
    renderer?.destroy();
    renderer = null;
  };

  window.addEventListener("pagehide", destroy, { once: true, signal: abortController.signal });

  startRenderer(canvas)
    .then((activeRenderer) => {
      if (disposed) {
        activeRenderer.destroy();
        return;
      }

      renderer = activeRenderer;
      onRenderer?.(activeRenderer);
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

  return { destroy };
}

function createActionMarkup(action: StudyAction): string {
  const className =
    action.variant === "primary"
      ? "study-action study-action--primary"
      : "study-action study-action--secondary";
  return `<a class="${className}" href="${action.href}">${escapeHtml(action.label)}</a>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
