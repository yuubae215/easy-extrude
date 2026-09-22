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
