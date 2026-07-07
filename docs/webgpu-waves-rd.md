# WebGPU graphite waves R&D

The reference is not a particle field. It reads as a high-key editorial hero with a static graphite streamline or contour field rendered on paper.

Visual findings:

- The canvas is light, nearly white, with the line field doing almost all of the work.
- The line density is highest around a vortex slightly right of center and slightly above vertical center.
- The curves are parallel streamlines, not random trails. Most lines travel left to right, then compress around the central basin and relax toward the right edge.
- The lines use layered alpha: a soft broad pass creates blur, a narrow pass creates the graphite core, and only a few central arcs become dark.
- The left copy area is masked by a strong white wash, leaving the lines visible but low contrast behind the text.

Implementation notes:

- `/waves` generates deterministic streamlines in normalized page coordinates and renders each segment as an instanced WebGPU quad.
- The line source is a horizontal streamline lattice warped through one dominant vortex, two supporting lobes, and broad vertical sweeps.
- Each segment is duplicated into soft and sharp layers so the result resembles antialiased pencil/ink lines without using the source JPEG as a texture.
- CSS handles only the paper wash and cropped editorial copy; the graphite field itself is procedural WebGPU geometry.
