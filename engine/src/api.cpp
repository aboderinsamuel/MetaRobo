// Flat C ABI over the engine. Every call takes a packed double array in and writes a packed
// double array out, so the JavaScript side only needs one shared heap buffer and no glue code.
//
// Packed "problem" (shared by most calls):
//   n, A[n*n] (row-major), B[n], C[n], D, delay,
//   ctrlType, kp, ki, kd, N, Nbar, K[n]
//
// Each function returns the number of doubles written, or -(needed) if `cap` is too small.
#include <cmath>
#include <cstdlib>

#include "plantsim.hpp"

using namespace rc;

namespace {

bool readProblem(const double* in, int len, int& i, StateSpace& p, Controller& k) {
  if (len < 1) return false;
  const int n = static_cast<int>(in[i++]);
  if (n < 0 || n > 16) return false;
  const int need = 1 + n * n + 2 * n + 2 + 6 + n;
  if (len < need) return false;
  p.n = n;
  p.A = Mat(n, n);
  for (int a = 0; a < n * n; ++a) p.A.a[a] = in[i++];
  p.B.assign(in + i, in + i + n);
  i += n;
  p.C.assign(in + i, in + i + n);
  i += n;
  p.D = in[i++];
  p.delay = in[i++];
  k.type = static_cast<int>(in[i++]);
  k.kp = in[i++];
  k.ki = in[i++];
  k.kd = in[i++];
  k.N = in[i++];
  k.Nbar = in[i++];
  k.K.assign(in + i, in + i + n);
  i += n;
  if (k.N <= 0) k.N = 50;
  return true;
}

}  // namespace

extern "C" {

double* rc_alloc(int count) { return static_cast<double*>(std::malloc(sizeof(double) * (count > 0 ? count : 1))); }
void rc_free(double* p) { std::free(p); }
int rc_version() { return 3; }

int rc_simulate(const double* in, int len, double* out, int cap) {
  int i = 0;
  StateSpace p;
  Controller k;
  if (!readProblem(in, len, i, p, k) || len < i + 9) return 0;
  SimConfig cfg;
  cfg.tEnd = in[i++];
  cfg.dt = in[i++];
  cfg.ref = in[i++];
  cfg.distTime = in[i++];
  cfg.distMag = in[i++];
  cfg.uMin = in[i++];
  cfg.uMax = in[i++];
  cfg.noiseStd = in[i++];
  cfg.seed = static_cast<unsigned>(in[i++]);
  if (cfg.dt <= 0 || cfg.tEnd <= 0) return 0;
  const int steps = static_cast<int>(cfg.tEnd / cfg.dt + 1e-9) + 1;
  const int need = 1 + kMetricCount + 3 * steps;
  if (cap < need) return -need;
  const SimResult r = simulate(p, k, cfg);
  int o = 0;
  out[o++] = static_cast<double>(r.y.size());
  const Metrics& m = r.m;
  const double ms[kMetricCount] = {m.riseTime, m.settlingTime, m.overshootPct, m.peak,    m.peakTime, m.finalValue,
                                   m.ssError,  m.iae,          m.ise,          m.maxAbsU, m.stable,   m.saturatedFrac};
  for (double v : ms) out[o++] = v;
  for (double v : r.y) out[o++] = v;
  for (double v : r.u) out[o++] = v;
  for (double v : r.r) out[o++] = v;
  return o;
}

int rc_poles(const double* in, int len, double* out, int cap) {
  int i = 0;
  StateSpace p;
  Controller k;
  if (!readProblem(in, len, i, p, k)) return 0;
  const CVec poles = closedLoopPoles(p, k);
  const int need = 1 + 2 * static_cast<int>(poles.size());
  if (cap < need) return -need;
  int o = 0;
  out[o++] = static_cast<double>(poles.size());
  for (const Complex& z : poles) {
    out[o++] = z.real();
    out[o++] = z.imag();
  }
  return o;
}

int rc_bode(const double* in, int len, double* out, int cap) {
  int i = 0;
  StateSpace p;
  Controller k;
  if (!readProblem(in, len, i, p, k) || len < i + 3) return 0;
  const int nw = static_cast<int>(in[i++]);
  const double wMin = in[i++], wMax = in[i++];
  if (nw < 2 || wMin <= 0 || wMax <= wMin) return 0;
  const int need = 1 + 3 * nw + 4;
  if (cap < need) return -need;
  Vec w(nw), mag, ph;
  for (int a = 0; a < nw; ++a) w[a] = wMin * std::pow(wMax / wMin, static_cast<double>(a) / (nw - 1));
  loopFrequencyResponse(p, k, w, mag, ph);
  const Margins m = margins(w, mag, ph);
  int o = 0;
  out[o++] = nw;
  for (double v : w) out[o++] = v;
  for (double v : mag) out[o++] = v;
  for (double v : ph) out[o++] = v;
  out[o++] = m.gmDb;
  out[o++] = m.pmDeg;
  out[o++] = m.wcg;
  out[o++] = m.wcp;
  return o;
}

int rc_lqr(const double* in, int len, double* out, int cap) {
  int i = 0;
  StateSpace p;
  Controller k;
  if (!readProblem(in, len, i, p, k) || len < i + 1 + p.n) return 0;
  const double R = in[i++];
  Vec Q(in + i, in + i + p.n);
  const int need = 2 + p.n;
  if (cap < need) return -need;
  Vec K;
  const bool ok = lqr(p, Q, R, K);
  int o = 0;
  out[o++] = ok ? 1.0 : 0.0;
  for (double v : K) out[o++] = v;
  out[o++] = ok ? computeNbar(p, K) : 1.0;
  return o;
}

int rc_fit(const double* in, int len, double* out, int cap) {
  if (len < 3) return 0;
  const int N = static_cast<int>(in[0]);
  const double uStep = in[1];
  const int kind = static_cast<int>(in[2]);
  if (N < 5 || len < 3 + 2 * N) return 0;
  if (cap < 8) return -8;
  Vec t(in + 3, in + 3 + N), y(in + 3 + N, in + 3 + 2 * N);
  const Fit f = kind == 0 ? fitBest(t, y, uStep) : fitStep(t, y, uStep, kind);
  out[0] = f.kind;
  out[1] = f.K;
  out[2] = f.tau;
  out[3] = f.wn;
  out[4] = f.zeta;
  out[5] = f.theta;
  out[6] = f.sse;
  out[7] = f.r2;
  return 8;
}

int rc_ss2tf(const double* in, int len, double* out, int cap) {
  int i = 0;
  StateSpace p;
  Controller k;
  if (!readProblem(in, len, i, p, k)) return 0;
  const int need = 1 + 2 * (p.n + 1);
  if (cap < need) return -need;
  const TransferFunction tf = ss2tf(p);
  int o = 0;
  out[o++] = p.n;
  for (double v : tf.num) out[o++] = v;
  for (double v : tf.den) out[o++] = v;
  return o;
}

}  // extern "C"
