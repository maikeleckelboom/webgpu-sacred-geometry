# Architectural network R&D note

## Project inspection

The app is a small Vite + TypeScript WebGPU project with route selection in `src/main.ts`, page modules per study, and renderer modules that own their GPU setup. The confusing part was that the `/flow-field` and `/topography` pages still used personal portfolio labels, contact navigation, career copy, and a bottom card rail. That made the project read like a renamed portfolio page instead of a WebGPU study set. The new route keeps the useful raw TypeScript/WebGPU infrastructure, but the navigation and page labels now describe the studies directly.

## Visual direction

The chosen direction is a high-key black and white technical field: a real 3D lattice of clustered nodes, routed rails, and translucent planes. The composition keeps negative space for title and context, pushes the densest structure toward the center/right of the stage, and uses depth, focus, and restrained motion instead of random particle noise. The inter-cluster graph is deliberately architectural: skewed sheet planes, bundled rails, tower-like trusses, and sparse cluster ports rather than direct all-to-all diagonals. The reference image was treated only as directional: monochrome editorial contrast, architectural node-line density, and atmospheric depth.

## Technical references

- WebGPU Samples particles: useful for the pattern of instanced quad rendering backed by GPU buffers and a render loop. https://webgpu.github.io/webgpu-samples/samples/particles/
- WebGPU Samples points: useful for point sprites rendered as quads in the vertex shader rather than relying on fixed-function point size. https://webgpu.github.io/webgpu-samples/?sample=points
- WebGPU Fundamentals canvas resizing: useful for the resize/DPR constraints around matching the canvas drawing buffer to display size. https://webgpufundamentals.org/webgpu/lessons/webgpu-resizing-the-canvas.html
- WebGPU Fundamentals multisampling: useful for the MSAA render target and resolve pattern used by the architecture route. https://webgpufundamentals.org/webgpu/lessons/webgpu-multisampling.html
- `webgpu-instanced-lines`: useful as a reference point for treating thick lines as generated geometry instead of native line primitives. https://github.com/rreusser/webgpu-instanced-lines

## Rendering approach

The architecture route generates a static structured graph on the CPU once: clustered node grids, sheet meshes, relay junctions, bundled rails, and translucent plane quads. WebGPU then renders three passes in one render pass: planes, instanced line quads, and instanced node sprites. The frame loop updates only a compact uniform buffer for camera drift, focus depth, quiet local pointer focus, and reduced-motion behavior. That keeps CPU work low and makes cleanup explicit: animation frame cancellation, event listener aborting, GPU texture destruction, resize handling, page visibility pause, and route/pagehide disposal.

## Fit for this project

This fits the project because it extends the existing no-framework WebGPU study structure while moving the new visual away from a portfolio hero. The scene is original, spatial, and intentionally architectural: it reads as routed infrastructure or system topology rather than generic AI network art.
