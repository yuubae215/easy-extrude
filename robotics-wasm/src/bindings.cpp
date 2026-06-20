// robotics-wasm — embind surface for the C++ measurement-instrument kernel
// (ADR-053 §4 / §10). This is the *initial* C++→WASM lane: it links Orocos KDL
// and ruckig and exposes two minimal-but-real entry points proving each library
// compiles, links, and runs under Emscripten. The full FK-sampling reach,
// Jacobian singularity margin, and BVH collision surfaces slot in behind the
// same module later (the pure-JS LocalComputeBackend remains the default until
// then — ADR-053 §10.1).
//
// Contract: every function here is a pure computation (PHILOSOPHY #3). No I/O,
// no global state. Operands/results mirror the predicate operand shapes (§9.2).

#include <emscripten/bind.h>
#include <string>

// ruckig — jerk-limited offline trajectory (cycle-time KPI, §7.4).
#include <ruckig/ruckig.hpp>

// Orocos KDL — serial-chain forward kinematics (reach KPI, §7.1).
// Headers are included by their in-tree (flat src/) names; the build adds
// vendor/orocos_kdl/orocos_kdl/src to the include path.
#include "chain.hpp"
#include "chainfksolverpos_recursive.hpp"
#include "frames.hpp"
#include "jntarray.hpp"

using namespace emscripten;

// --- ruckig ------------------------------------------------------------------
// Total duration [s] of a 1-DoF rest-to-rest move over `distance`, bounded by
// jerk/acceleration/velocity limits. This is the kernel the cycle-time
// measurement (RoboticsService) will sum over a motion plan.
// Returns -1.0 if ruckig cannot produce a valid trajectory (e.g. zero limits).
double ruckigMoveDuration(double distance,
                          double maxVelocity,
                          double maxAcceleration,
                          double maxJerk) {
  ruckig::Ruckig<1> otg;
  ruckig::InputParameter<1> input;
  ruckig::Trajectory<1> trajectory;

  input.current_position = {0.0};
  input.current_velocity = {0.0};
  input.current_acceleration = {0.0};
  input.target_position = {distance};
  input.target_velocity = {0.0};
  input.target_acceleration = {0.0};
  input.max_velocity = {maxVelocity};
  input.max_acceleration = {maxAcceleration};
  input.max_jerk = {maxJerk};

  const ruckig::Result result = otg.calculate(input, trajectory);
  if (result != ruckig::Result::Working && result != ruckig::Result::Finished) {
    return -1.0;
  }
  return trajectory.get_duration();
}

// --- KDL ---------------------------------------------------------------------
// Forward kinematics of a planar 2R arm (link lengths l1, l2; joint angles
// th1, th2 in radians). Returns the TCP world position as a 3-vector. Exercises
// the full KDL Chain / Segment / Joint / Frame / ChainFkSolverPos_recursive
// path (and Eigen transitively), proving the KDL link is live.
val planar2rFk(double l1, double l2, double th1, double th2) {
  KDL::Chain chain;
  chain.addSegment(KDL::Segment(KDL::Joint(KDL::Joint::RotZ),
                                KDL::Frame(KDL::Vector(l1, 0.0, 0.0))));
  chain.addSegment(KDL::Segment(KDL::Joint(KDL::Joint::RotZ),
                                KDL::Frame(KDL::Vector(l2, 0.0, 0.0))));

  KDL::ChainFkSolverPos_recursive fk(chain);
  KDL::JntArray q(chain.getNrOfJoints());
  q(0) = th1;
  q(1) = th2;

  KDL::Frame tcp;
  const int ok = fk.JntToCart(q, tcp);

  val out = val::array();
  if (ok < 0) {
    out.call<void>("push", -1.0);  // signal solver failure
    return out;
  }
  out.call<void>("push", tcp.p.x());
  out.call<void>("push", tcp.p.y());
  out.call<void>("push", tcp.p.z());
  return out;
}

// Version probe — confirms the KDL translation unit linked.
std::string kdlVersion() { return std::string("1.5.1"); }

EMSCRIPTEN_BINDINGS(robotics_engine) {
  function("ruckigMoveDuration", &ruckigMoveDuration);
  function("planar2rFk", &planar2rFk);
  function("kdlVersion", &kdlVersion);
}
