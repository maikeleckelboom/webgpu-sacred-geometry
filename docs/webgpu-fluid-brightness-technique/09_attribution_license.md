# 09 — Attribution and License Guidance

## Upstream project

This technique analysis is based on the public project:

```txt
Project:  WebGL Fluid Simulation
Author:   Pavel Dobryakov / PavelDoGreat
Repo:     https://github.com/PavelDoGreat/WebGL-Fluid-Simulation
Demo:     https://paveldogreat.github.io/WebGL-Fluid-Simulation/
License:  MIT
```

The upstream repository states that the code is available under the MIT license. The source file itself also carries an MIT license header.

## Practical policy for our implementation

### Clean reimplementation

Safe path:

```txt
Use the algorithmic ideas, equations, pass order, and parameter ranges.
Write our own TypeScript/WebGPU/WGSL code.
Keep a source/reference note in docs.
```

This is what these docs are designed for.

### Direct copying or close translation

Allowed by MIT, but only if license requirements are followed:

```txt
- Preserve the copyright notice.
- Preserve the MIT permission notice.
- Include it in copies or substantial portions of the software.
```

If we directly copy GLSL code, JavaScript code, or closely translate a full shader/function, include the upstream MIT notice in the relevant source tree or third-party notices file.

### Do not do this

```txt
- Do not remove Pavel Dobryakov's copyright notice from copied code.
- Do not present a direct copy as original work.
- Do not mix copied code into proprietary areas without tracking license notice obligations.
```

## Suggested `NOTICE` entry

```txt
This product includes or is inspired by techniques from WebGL Fluid Simulation
by Pavel Dobryakov / PavelDoGreat.

Source: https://github.com/PavelDoGreat/WebGL-Fluid-Simulation
License: MIT

Copyright (c) 2017 Pavel Dobryakov
```

If no code is copied and the implementation is a clean rewrite, keep a softer reference in engineering docs rather than bundling a third-party code notice in distributed software.

## MIT license text for upstream code reuse

Include this if copying substantial upstream code:

```txt
MIT License

Copyright (c) 2017 Pavel Dobryakov

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Documentation sources

Primary upstream source:

- `https://github.com/PavelDoGreat/WebGL-Fluid-Simulation`
- `https://github.com/PavelDoGreat/WebGL-Fluid-Simulation/blob/master/script.js`

Background fluid simulation reference used by upstream:

- Mark J. Harris, “Fast Fluid Dynamics Simulation on the GPU”, GPU Gems Chapter 38, NVIDIA.
- `https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu`

WebGPU presentation/color references:

- MDN `GPUCanvasContext.configure()`
- MDN `GPU.getPreferredCanvasFormat()`
- Chrome for Developers, WebGPU canvas tone mapping / HDR support notes
