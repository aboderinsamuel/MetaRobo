// PlantSim: a small, dependency-free control-systems engine.
//
// It is compiled two ways from the same sources:
//   * to WebAssembly (build-wasm.sh) for the browser studio, and
//   * natively (CMake / g++) for the unit tests in engine/tests.
//
// Conventions: SISO plants, polynomials in descending powers of s, time in seconds.
#pragma once

#include <complex>
#include <vector>

namespace rc {

using Vec = std::vector<double>;
using Complex = std::complex<double>;
using CVec = std::vector<Complex>;

struct Mat {
  int r = 0, c = 0;
  Vec a;
  Mat() = default;
  Mat(int rows, int cols) : r(rows), c(cols), a(static_cast<size_t>(rows) * cols, 0.0) {}
  double& operator()(int i, int j) { return a[static_cast<size_t>(i) * c + j]; }
  double operator()(int i, int j) const { return a[static_cast<size_t>(i) * c + j]; }
  static Mat eye(int n);
};

Mat matmul(const Mat& x, const Mat& y);
Mat matadd(const Mat& x, const Mat& y, double s = 1.0);  // x + s*y
Mat transpose(const Mat& x);
bool inverse(const Mat& x, Mat& out);

// x' = A x + B u,  y = C x + D u
struct StateSpace {
  int n = 0;
  Mat A;
  Vec B, C;
  double D = 0.0;
  double delay = 0.0;  // pure input delay in seconds (simulation + frequency response)
};

struct TransferFunction {
  Vec num, den;  // descending powers of s
};

StateSpace tf2ss(const TransferFunction& tf);  // controllable canonical form
TransferFunction ss2tf(const StateSpace& ss);  // Faddeev-LeVerrier
Vec charpoly(const Mat& A);                    // monic, descending
CVec roots(const Vec& poly);                   // Aberth-Ehrlich
CVec eig(const Mat& A);

enum CtrlType { CTRL_OPEN = 0, CTRL_PID = 1, CTRL_SF = 2 };

struct Controller {
  int type = CTRL_OPEN;
  double kp = 0, ki = 0, kd = 0, N = 50;  // PID, derivative filter N (rad/s)
  Vec K;                                  // state feedback gain (size n)
  double Nbar = 1.0;                      // reference pre-gain for state feedback
};

struct SimConfig {
  double tEnd = 10, dt = 1e-3, ref = 1;
  double distTime = -1, distMag = 0;  // input disturbance step
  double uMin = -1e9, uMax = 1e9;     // actuator saturation
  double noiseStd = 0;                // measurement noise
  unsigned seed = 1;
};

struct Metrics {
  double riseTime = -1, settlingTime = -1, overshootPct = 0, peak = 0, peakTime = 0;
  double finalValue = 0, ssError = 0, iae = 0, ise = 0, maxAbsU = 0;
  double stable = 1, saturatedFrac = 0;
};
constexpr int kMetricCount = 12;

struct SimResult {
  Vec y, u, r;
  Metrics m;
};

SimResult simulate(const StateSpace& p, const Controller& k, const SimConfig& cfg);
Metrics computeMetrics(const Vec& y, const Vec& u, const Vec& r, double dt, double windowEnd, double satFrac);

Mat closedLoopA(const StateSpace& p, const Controller& k);
CVec closedLoopPoles(const StateSpace& p, const Controller& k);

// Open-loop L(jw) = C(jw) P(jw) e^{-jw delay}. For state feedback the loop is broken at the plant input.
struct Margins {
  double gmDb = 1e9, pmDeg = 1e9, wcg = -1, wcp = -1;
};
void loopFrequencyResponse(const StateSpace& p, const Controller& k, const Vec& w, Vec& magDb, Vec& phaseDeg);
Margins margins(const Vec& w, const Vec& magDb, const Vec& phaseDeg);

bool lqr(const StateSpace& p, const Vec& Qdiag, double R, Vec& K);
double computeNbar(const StateSpace& p, const Vec& K);

// System identification from a step test (input step of amplitude uStep at t = 0).
enum FitKind { FIT_FOPDT = 1, FIT_SOPDT = 2 };
struct Fit {
  int kind = FIT_FOPDT;
  double K = 0, tau = 0, wn = 0, zeta = 0, theta = 0;
  double sse = 0, r2 = 0;
};
Fit fitStep(const Vec& t, const Vec& y, double uStep, int kind);
Fit fitBest(const Vec& t, const Vec& y, double uStep);

double stepFOPDT(double K, double tau, double theta, double t);
double stepSOPDT(double K, double wn, double zeta, double theta, double t);

}  // namespace rc
