# robotics-wasm — C++ → WebAssembly measurement-instrument lane

The Emscripten build lane defined by **ADR-053 §4** (and bootstrapped in
**§11**). It compiles two C++ robotics libraries into a single WASM module
exposed to JavaScript via embind:

| Library | Role (ADR-053) | KPI |
|---|---|---|
| [Orocos KDL](https://github.com/orocos/orocos_kinematics_dynamics) `v1.5.1` | FK / IK / Jacobian, singularity analysis | reach (§7.1), self-collision margin |
| [ruckig](https://github.com/pantor/ruckig) `v0.9.2` | jerk-limited **offline** trajectory generation | cycle time (§7.4) |
| [Eigen](https://gitlab.com/libeigen/eigen) `3.4.0` | linear algebra (KDL dependency) | — |

The vendored sources live under `vendor/` as pinned **git submodules**.

This lane sits *alongside* the existing Rust → wasm-pack lane (`wasm-engine/`,
ADR-027). Both feed the `ComputeBackend` seam (ADR-053 §3); the pure-JS
`LocalComputeBackend` (ADR-053 §10) remains the default until the WASM kernels
are wired in behind that seam.

## Layout

```
robotics-wasm/
├── CMakeLists.txt              # emcmake build (KDL + ruckig + Eigen → 1 module)
├── src/bindings.cpp           # embind surface (pure functions, PHILOSOPHY #3)
├── robotics_engine.test.mjs   # node --test smoke test (imports committed artifact)
└── vendor/                    # pinned submodules: ruckig, orocos_kdl, eigen

src/engine/robotics-wasm/      # COMMITTED build output (robotics_engine.mjs + .wasm)
```

## Build

The compiled `robotics_engine.mjs` + `.wasm` are **committed to git** (same
policy as the Rust engine, ADR-027), so `vite build` and GitHub Pages CI need
no C++ toolchain. You only rebuild when the bindings or vendored versions change.

```bash
pnpm setup:toolchain        # one-time: wasm-pack + Emscripten SDK + submodules
pnpm build:robotics-wasm    # emcmake/emmake → src/engine/robotics-wasm/
pnpm test:robotics-wasm     # node --test smoke test (FK + trajectory correctness)
```

`build:robotics-wasm` is intentionally **not** part of `pnpm build` — the
Emscripten toolchain is heavy and the artifact is checked in.

## Current surface (initial introduction)

`src/bindings.cpp` exposes a minimal-but-real proof that each library compiles,
links, and runs correctly under Emscripten:

- `ruckigMoveDuration(distance, vMax, aMax, jMax)` → duration [s] of a 1-DoF
  rest-to-rest move (`-1` if infeasible).
- `planar2rFk(l1, l2, th1, th2)` → `[x, y, z]` TCP position of a planar 2R arm
  via `KDL::ChainFkSolverPos_recursive`.
- `kdlVersion()` → KDL version string (link probe).

The full FK-sampling reach, Jacobian singularity margin, IK solver, and
three-mesh-bvh collision surfaces are subsequent phases — they slot in behind
the same module and the same `ComputeBackend.run(job)` seam.
