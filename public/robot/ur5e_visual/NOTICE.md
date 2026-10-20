# Provenance

`urdf/ur5e.urdf` and `meshes/ur5e/visual/*.dae` are unmodified copies of the
Universal Robots UR5e visual assets from the ROS-Industrial `ur_description`
package:

- Source: https://github.com/ros-industrial/universal_robot/tree/6507bb6756d0065d49b76230ff55f875f099a827/ur_description
- Retrieved via the mirror: https://github.com/Daniella1/urdf_files_dataset/tree/main/urdf_files/ros-industrial/xacro_generated/universal_robots/ur_description
- License: Apache License 2.0 (`LICENSE.txt` in this directory)

Not copied: `meshes/ur5e/collision/*.stl`. `urdf-loader`'s `parseCollision`
option defaults to `false`, so this app never requests them — shipping them
would only add ~400 KB nobody reads.

These files are the "realistic" render style (`ROBOT_RENDER_STYLE.REALISTIC`
in `src/view/robotVisualStyle.js`) — an alternate VISUAL for the exact same
UR5e kinematic chain the app already draws as a primitive-geometry skeleton
(`public/robot/skeleton_arm.urdf`). The two files' joint origins are asserted
to numerically agree in `src/RobotVisualStyleAgreement.test.js`; kinematics,
the TCP seed, and the reach envelope keep deriving solely from
`skeleton_arm.urdf` (ADR-088) — this directory contributes geometry only, so
there is still exactly one source of truth for "where is this arm's flange".

## Derived files (modified)

`meshes/ur5e/visual_lod/*.glb` are **modified** versions of the `.dae` files
above, produced by `scripts/simplify-robot-meshes.mjs` (ADR-166 M8): the same
surfaces with fewer triangles (meshoptimizer, at most 0.2 mm from the source),
positions only (the source is flat-shaded, so the app rebuilds its face
normals), with the Collada's Phong values kept in each material's `extras`.
`manifest.json` records the SHA-256 of each source file they were derived
from; `src/view/RobotMeshLod.test.js` fails if a source changes without the
derived files being regenerated. The app draws the derived files; the `.dae`
files remain the source.
