# robotics-wasm — C++ → WebAssembly measurement-instrument kernel (ADR-053 §4)
#
# Builds the Orocos KDL (FK/IK/Jacobian) + ruckig (jerk-limited offline
# trajectory) C++ libraries into a single Emscripten WASM module exposed to
# JavaScript via embind. This is the C++ build lane that sits ALONGSIDE the
# existing Rust → wasm-pack lane (wasm-engine/, ADR-027); both feed the
# ComputeBackend seam (ADR-053 §3) behind which the pure-JS LocalComputeBackend
# is the current default (ADR-053 §10).
#
# Invoke through scripts/build-robotics-wasm.sh (which wraps emcmake / emmake);
# never `cmake` directly — the toolchain file comes from the activated emsdk.
#
# The compiled output (robotics_engine.mjs + .wasm) is committed under
# src/engine/robotics-wasm/ — same policy as the Rust engine (ADR-027): the
# WASM artifact is checked into git so `vite build` needs no C++ toolchain.

cmake_minimum_required(VERSION 3.13)
project(robotics_engine CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT EMSCRIPTEN)
  message(FATAL_ERROR
    "robotics-wasm must be configured through Emscripten. "
    "Use scripts/build-robotics-wasm.sh (emcmake cmake ...), not plain cmake.")
endif()

set(VENDOR ${CMAKE_CURRENT_SOURCE_DIR}/vendor)

# --- Eigen (header-only; KDL dependency) -------------------------------------
set(EIGEN_INC ${VENDOR}/eigen)

# --- ruckig (jerk-limited trajectory; core only, no python/cloud client) -----
set(RUCKIG_INC ${VENDOR}/ruckig/include)
set(RUCKIG_SRC
  ${VENDOR}/ruckig/src/ruckig/brake.cpp
  ${VENDOR}/ruckig/src/ruckig/position-step1.cpp
  ${VENDOR}/ruckig/src/ruckig/position-step2.cpp
  ${VENDOR}/ruckig/src/ruckig/velocity-step1.cpp
  ${VENDOR}/ruckig/src/ruckig/velocity-step2.cpp)

# --- Orocos KDL (FK/IK/Jacobian) ---------------------------------------------
# KDL needs a generated config.h (kinfam_io.hpp -> tree.hpp -> config.h is
# pulled in transitively even by the Chain solvers). We generate it with the
# OLD Tree interface (KDL_USE_NEW_TREE_INTERFACE undefined) so no Boost
# dependency is introduced — serial robot kinematics never touches Tree, and
# emscripten's libc++ supports the old interface's incomplete-type containers.
set(KDL_DIR ${VENDOR}/orocos_kdl/orocos_kdl)
set(KDL_VERSION 1.5.1)
set(KDL_VERSION_MAJOR 1)
set(KDL_VERSION_MINOR 5)
set(KDL_VERSION_PATCH 1)
# Leave HAVE_STL_CONTAINER_INCOMPLETE_TYPES / KDL_USE_NEW_TREE_INTERFACE unset
# so #cmakedefine resolves to /* #undef ... */ (old interface, no Boost).
configure_file(${KDL_DIR}/src/config.h.in
               ${CMAKE_BINARY_DIR}/kdl_gen/config.h)

file(GLOB KDL_SRC
  ${KDL_DIR}/src/*.cpp
  ${KDL_DIR}/src/utilities/*.cpp
  ${KDL_DIR}/src/utilities/*.cxx)

add_executable(robotics_engine
  ${CMAKE_CURRENT_SOURCE_DIR}/src/bindings.cpp
  ${RUCKIG_SRC}
  ${KDL_SRC})

target_include_directories(robotics_engine PRIVATE
  ${EIGEN_INC}
  ${RUCKIG_INC}
  ${KDL_DIR}/src
  ${CMAKE_BINARY_DIR}/kdl_gen)

# Eigen 3.4 emits -Wdeprecated-* noise under clang; silence vendor warnings.
target_compile_options(robotics_engine PRIVATE -O3 -w)

# Emscripten link flags. ES6 module so it imports cleanly in the Vite bundle
# AND under `node --test` (web,worker,node) for the smoke test.
set_target_properties(robotics_engine PROPERTIES SUFFIX ".mjs")
target_link_options(robotics_engine PRIVATE
  -lembind
  -O3
  "SHELL:-s MODULARIZE=1"
  "SHELL:-s EXPORT_ES6=1"
  "SHELL:-s ENVIRONMENT=web,worker,node"
  "SHELL:-s ALLOW_MEMORY_GROWTH=1"
  "SHELL:-s EXPORT_NAME=createRoboticsEngine")
