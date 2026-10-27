#include "plantsim.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <functional>

namespace rc {

static constexpr double kPi = 3.14159265358979323846;

// ---------------------------------------------------------------------------
// Dense linear algebra (small n, so plain O(n^3) is fine)
// ---------------------------------------------------------------------------

Mat Mat::eye(int n) {
  Mat m(n, n);
  for (int i = 0; i < n; ++i) m(i, i) = 1.0;
  return m;
}

Mat matmul(const Mat& x, const Mat& y) {
  Mat out(x.r, y.c);
  for (int i = 0; i < x.r; ++i)
    for (int k = 0; k < x.c; ++k) {
      const double v = x(i, k);
      if (v == 0.0) continue;
      for (int j = 0; j < y.c; ++j) out(i, j) += v * y(k, j);
    }
  return out;
}

Mat matadd(const Mat& x, const Mat& y, double s) {
  Mat out = x;
  for (size_t i = 0; i < out.a.size(); ++i) out.a[i] += s * y.a[i];
  return out;
}

Mat transpose(const Mat& x) {
  Mat out(x.c, x.r);
  for (int i = 0; i < x.r; ++i)
    for (int j = 0; j < x.c; ++j) out(j, i) = x(i, j);
  return out;
}

// Gauss-Jordan with partial pivoting.
bool inverse(const Mat& x, Mat& out) {
  const int n = x.r;
  Mat m = x;
  out = Mat::eye(n);
  for (int col = 0; col < n; ++col) {
    int piv = col;
    for (int i = col + 1; i < n; ++i)
      if (std::fabs(m(i, col)) > std::fabs(m(piv, col))) piv = i;
    if (std::fabs(m(piv, col)) < 1e-300) return false;
    if (piv != col)
      for (int j = 0; j < n; ++j) {
        std::swap(m(col, j), m(piv, j));
        std::swap(out(col, j), out(piv, j));
      }
    const double d = m(col, col);
    for (int j = 0; j < n; ++j) {
      m(col, j) /= d;
      out(col, j) /= d;
    }
    for (int i = 0; i < n; ++i) {
      if (i == col) continue;
      const double f = m(i, col);
      if (f == 0.0) continue;
      for (int j = 0; j < n; ++j) {
        m(i, j) -= f * m(col, j);
        out(i, j) -= f * out(col, j);
      }
    }
  }
  return true;
}

// Solves (s I - A) x = b for complex s, b real. Returns false when singular.
static bool solveShifted(const Mat& A, Complex s, const Vec& b, CVec& x) {
  const int n = A.r;
  std::vector<CVec> m(n, CVec(n + 1));
  for (int i = 0; i < n; ++i) {
    for (int j = 0; j < n; ++j) m[i][j] = -A(i, j);
    m[i][i] += s;
    m[i][n] = b[i];
  }
  for (int col = 0; col < n; ++col) {
    int piv = col;
    for (int i = col + 1; i < n; ++i)
      if (std::abs(m[i][col]) > std::abs(m[piv][col])) piv = i;
    if (std::abs(m[piv][col]) < 1e-300) return false;
    std::swap(m[col], m[piv]);
    for (int i = col + 1; i < n; ++i) {
      const Complex f = m[i][col] / m[col][col];
      for (int j = col; j <= n; ++j) m[i][j] -= f * m[col][j];
    }
  }
  x.assign(n, Complex(0, 0));
  for (int i = n - 1; i >= 0; --i) {
    Complex acc = m[i][n];
    for (int j = i + 1; j < n; ++j) acc -= m[i][j] * x[j];
    x[i] = acc / m[i][i];
  }
  return true;
}

// ---------------------------------------------------------------------------
// Model conversions
// ---------------------------------------------------------------------------

static Vec trimLeading(const Vec& p) {
  size_t i = 0;
  while (i + 1 < p.size() && std::fabs(p[i]) < 1e-14) ++i;
  return Vec(p.begin() + static_cast<long>(i), p.end());
}

StateSpace tf2ss(const TransferFunction& tf) {
  Vec den = trimLeading(tf.den);
  Vec num = trimLeading(tf.num);
  const int n = static_cast<int>(den.size()) - 1;
  StateSpace ss;
  ss.n = n;
  ss.A = Mat(n, n);
  ss.B.assign(n, 0.0);
  ss.C.assign(n, 0.0);
  if (n <= 0) {
    ss.D = (den.empty() || den[0] == 0.0 || num.empty()) ? 0.0 : num.back() / den[0];
    return ss;
  }
  const double a0 = den[0];
  for (double& v : den) v /= a0;
  for (double& v : num) v /= a0;
  // Pad the numerator to n+1 coefficients.
  Vec b(n + 1, 0.0);
  const int off = n + 1 - static_cast<int>(num.size());
  for (size_t i = 0; i < num.size(); ++i)
    if (off + static_cast<int>(i) >= 0) b[off + i] = num[i];
  ss.D = b[0];
  for (int j = 0; j < n; ++j) ss.A(0, j) = -den[j + 1];
  for (int i = 1; i < n; ++i) ss.A(i, i - 1) = 1.0;
  ss.B[0] = 1.0;
  for (int j = 0; j < n; ++j) ss.C[j] = b[j + 1] - den[j + 1] * b[0];
  return ss;
}

// Faddeev-LeVerrier: also yields adj(sI - A), which gives the numerator.
static void faddeev(const Mat& A, Vec& p, std::vector<Mat>& M) {
  const int n = A.r;
  p.assign(n + 1, 0.0);
  p[0] = 1.0;
  M.clear();
  Mat Mk = Mat::eye(n);
  for (int k = 1; k <= n; ++k) {
    if (k > 1) {
      Mk = matmul(A, M.back());
      for (int i = 0; i < n; ++i) Mk(i, i) += p[k - 1];
    }
    M.push_back(Mk);
    Mat AM = matmul(A, Mk);
    double tr = 0;
    for (int i = 0; i < n; ++i) tr += AM(i, i);
    p[k] = -tr / k;
  }
}

Vec charpoly(const Mat& A) {
  Vec p;
  std::vector<Mat> M;
  faddeev(A, p, M);
  return p;
}

TransferFunction ss2tf(const StateSpace& ss) {
  TransferFunction tf;
  const int n = ss.n;
  Vec p;
  std::vector<Mat> M;
  faddeev(ss.A, p, M);
  tf.den = p;
  tf.num.assign(n + 1, 0.0);
  for (int k = 0; k <= n; ++k) tf.num[k] = ss.D * p[k];
  for (int k = 1; k <= n; ++k) {
    double v = 0;
    for (int i = 0; i < n; ++i)
      for (int j = 0; j < n; ++j) v += ss.C[i] * M[k - 1](i, j) * ss.B[j];
    tf.num[k] += v;
  }
  for (double& v : tf.num)
    if (std::fabs(v) < 1e-12 * (1.0 + std::fabs(p.back()))) v = 0.0;
  return tf;
}

// Aberth-Ehrlich simultaneous root finding.
CVec roots(const Vec& polyIn) {
  Vec poly = trimLeading(polyIn);
  const int m = static_cast<int>(poly.size()) - 1;
  if (m <= 0 || poly[0] == 0.0) return {};
  // Strip zero roots exactly.
  int zeroRoots = 0;
  while (static_cast<int>(poly.size()) > 1 && poly.back() == 0.0) {
    poly.pop_back();
    ++zeroRoots;
  }
  const int d = static_cast<int>(poly.size()) - 1;
  CVec z;
  if (d > 0) {
    const double a0 = poly[0];
    for (double& v : poly) v /= a0;
    double radius = 0;
    for (int k = 1; k <= d; ++k) radius = std::max(radius, std::pow(std::fabs(poly[k]), 1.0 / k));
    radius = std::max(radius, 1e-6);
    z.resize(d);
    for (int i = 0; i < d; ++i) {
      const double ang = 2 * kPi * i / d + 0.4;
      z[i] = Complex(radius * std::cos(ang), radius * std::sin(ang));
    }
    for (int it = 0; it < 800; ++it) {
      double maxStep = 0;
      for (int i = 0; i < d; ++i) {
        Complex pv = 1.0, dp = 0.0;
        for (int k = 1; k <= d; ++k) {
          dp = dp * z[i] + pv;
          pv = pv * z[i] + poly[k];
        }
        if (std::abs(pv) == 0.0) continue;
        const Complex ratio = pv / dp;
        Complex sum = 0.0;
        for (int j = 0; j < d; ++j)
          if (j != i) sum += 1.0 / (z[i] - z[j]);
        const Complex w = ratio / (1.0 - ratio * sum);
        z[i] -= w;
        maxStep = std::max(maxStep, std::abs(w) / std::max(1.0, std::abs(z[i])));
      }
      if (maxStep < 1e-15) break;
    }
    for (Complex& r : z)
      if (std::fabs(r.imag()) < 1e-9 * std::max(1.0, std::abs(r))) r = Complex(r.real(), 0.0);
  }
  for (int i = 0; i < zeroRoots; ++i) z.push_back(Complex(0, 0));
  std::sort(z.begin(), z.end(), [](const Complex& a, const Complex& b) {
    // Conjugate pairs share a real part up to rounding; order them by imaginary part instead.
    if (std::fabs(a.real() - b.real()) > 1e-9 * std::max(1.0, std::abs(a))) return a.real() > b.real();
    return a.imag() > b.imag();
  });
  return z;
}

CVec eig(const Mat& A) { return roots(charpoly(A)); }

// ---------------------------------------------------------------------------
// Closed loop
// ---------------------------------------------------------------------------

Mat closedLoopA(const StateSpace& p, const Controller& k) {
  const int n = p.n;
  if (k.type == CTRL_SF) {
    Mat A = p.A;
    for (int i = 0; i < n; ++i)
      for (int j = 0; j < n; ++j) A(i, j) -= p.B[i] * (j < static_cast<int>(k.K.size()) ? k.K[j] : 0.0);
    return A;
  }
  if (k.type != CTRL_PID) return p.A;
  // PID with filtered derivative D(s) = kd N s / (s + N), written as
  //   u = (kp + kd N) e + ki xi - kd N^2 xf,  xi' = e,  xf' = -N xf + e,  e = -y.
  const bool useI = k.ki != 0.0;
  const bool useD = k.kd != 0.0;
  const int m = n + (useI ? 1 : 0) + (useD ? 1 : 0);
  const int iI = n, iD = n + (useI ? 1 : 0);
  const double G = k.kp + (useD ? k.kd * k.N : 0.0);
  Mat A(m, m);
  for (int i = 0; i < n; ++i) {
    for (int j = 0; j < n; ++j) A(i, j) = p.A(i, j) - p.B[i] * G * p.C[j];
    if (useI) A(i, iI) = p.B[i] * k.ki;
    if (useD) A(i, iD) = -p.B[i] * k.kd * k.N * k.N;
  }
  if (useI)
    for (int j = 0; j < n; ++j) A(iI, j) = -p.C[j];
  if (useD) {
    for (int j = 0; j < n; ++j) A(iD, j) = -p.C[j];
    A(iD, iD) = -k.N;
  }
  return A;
}

CVec closedLoopPoles(const StateSpace& p, const Controller& k) { return eig(closedLoopA(p, k)); }

// ---------------------------------------------------------------------------
// Time-domain simulation
// ---------------------------------------------------------------------------

namespace {
struct Rng {
  uint32_t s;
  explicit Rng(uint32_t seed) : s(seed ? seed : 0x9E3779B9u) {}
  double uniform() {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (static_cast<double>(s) + 0.5) / 4294967296.0;
  }
  double gauss() {
    const double u1 = uniform(), u2 = uniform();
    return std::sqrt(-2.0 * std::log(u1)) * std::cos(2.0 * kPi * u2);
  }
};

double clamp(double v, double lo, double hi) { return v < lo ? lo : (v > hi ? hi : v); }
}  // namespace

Metrics computeMetrics(const Vec& y, const Vec& u, const Vec& r, double dt, double windowEnd, double satFrac) {
  Metrics m;
  const int len = static_cast<int>(y.size());
  if (len == 0) return m;
  const int kEnd = std::max(0, std::min(len - 1, static_cast<int>(std::floor(windowEnd / dt + 1e-9))));
  const double ref = r[0];
  const int tail = std::max(1, (kEnd + 1) / 20);
  double fin = 0;
  for (int k = kEnd - tail + 1; k <= kEnd; ++k) fin += y[k];
  fin /= tail;
  m.finalValue = fin;
  m.ssError = ref - fin;

  int kPeak = 0;
  for (int k = 0; k <= kEnd; ++k) {
    if (fin >= 0 ? y[k] > y[kPeak] : y[k] < y[kPeak]) kPeak = k;
  }
  m.peak = y[kPeak];
  m.peakTime = kPeak * dt;
  m.overshootPct = std::fabs(fin) > 1e-12 ? std::max(0.0, (m.peak - fin) / fin * 100.0) : 0.0;

  if (std::fabs(fin) > 1e-12) {
    int k10 = -1, k90 = -1;
    for (int k = 0; k <= kEnd; ++k) {
      const double f = y[k] / fin;
      if (k10 < 0 && f >= 0.1) k10 = k;
      if (k90 < 0 && f >= 0.9) {
        k90 = k;
        break;
      }
    }
    if (k10 >= 0 && k90 >= 0) m.riseTime = (k90 - k10) * dt;
    const double band = 0.02 * std::fabs(fin);
    int kLast = -1;
    for (int k = kEnd; k >= 0; --k)
      if (std::fabs(y[k] - fin) > band) {
        kLast = k;
        break;
      }
    if (kLast < 0)
      m.settlingTime = 0;
    else if (kLast < kEnd - tail)
      m.settlingTime = (kLast + 1) * dt;
    else
      m.settlingTime = -1;
  }

  for (int k = 0; k < len; ++k) {
    const double e = r[k] - y[k];
    m.iae += std::fabs(e) * dt;
    m.ise += e * e * dt;
    m.maxAbsU = std::max(m.maxAbsU, std::fabs(u[k]));
  }
  m.saturatedFrac = satFrac;
  return m;
}

SimResult simulate(const StateSpace& p, const Controller& k, const SimConfig& cfg) {
  SimResult res;
  const int n = p.n;
  const double dt = cfg.dt;
  const int steps = static_cast<int>(std::floor(cfg.tEnd / dt + 1e-9)) + 1;
  res.y.assign(steps, 0.0);
  res.u.assign(steps, 0.0);
  res.r.assign(steps, 0.0);

  Vec x(n, 0.0), k1(n), k2(n), k3(n), k4(n), tmp(n);
  const int nd = std::max(0, static_cast<int>(std::lround(p.delay / dt)));
  Vec delayBuf(nd + 1, 0.0);
  int head = 0;
  Rng rng(cfg.seed);

  const bool useI = k.ki != 0.0, useD = k.kd != 0.0;
  double xi = 0.0, xf = 0.0, uPlantPrev = 0.0;
  bool diverged = false;
  int satCount = 0;

  auto deriv = [&](const Vec& xs, double u, Vec& out) {
    for (int i = 0; i < n; ++i) {
      double acc = p.B[i] * u;
      for (int j = 0; j < n; ++j) acc += p.A(i, j) * xs[j];
      out[i] = acc;
    }
  };
  auto output = [&](const Vec& xs, double u) {
    double acc = p.D * u;
    for (int j = 0; j < n; ++j) acc += p.C[j] * xs[j];
    return acc;
  };

  for (int s = 0; s < steps; ++s) {
    const double t = s * dt;
    const double r = cfg.ref;
    const double yTrue = output(x, uPlantPrev);
    const double ym = yTrue + (cfg.noiseStd > 0 ? cfg.noiseStd * rng.gauss() : 0.0);
    if (s == 0 && useD) xf = -ym / k.N;  // start the derivative filter at rest: no kick

    double uUn = 0.0;
    if (k.type == CTRL_PID) {
      const double e = r - ym;
      const double dTerm = useD ? k.kd * k.N * (-ym - k.N * xf) : 0.0;
      uUn = k.kp * e + k.ki * xi + dTerm;
      // Conditional integration anti-windup.
      const bool pushHigh = uUn > cfg.uMax && k.ki * e > 0;
      const bool pushLow = uUn < cfg.uMin && k.ki * e < 0;
      if (useI && !pushHigh && !pushLow) xi += e * dt;
      if (useD) xf = (xf + dt * (-ym)) / (1.0 + k.N * dt);
    } else if (k.type == CTRL_SF) {
      uUn = k.Nbar * r;
      for (int j = 0; j < n && j < static_cast<int>(k.K.size()); ++j) uUn -= k.K[j] * x[j];
    } else {
      uUn = r;
    }
    const double u = clamp(uUn, cfg.uMin, cfg.uMax);
    if (u != uUn) ++satCount;

    res.y[s] = yTrue;
    res.u[s] = u;
    res.r[s] = r;

    delayBuf[head] = u;
    const double uDel = delayBuf[(head + 1) % (nd + 1)];
    head = (head + 1) % (nd + 1);
    const double dist = (cfg.distTime >= 0 && t >= cfg.distTime) ? cfg.distMag : 0.0;
    const double uPlant = (nd == 0 ? u : uDel) + dist;

    if (!diverged) {
      deriv(x, uPlant, k1);
      for (int i = 0; i < n; ++i) tmp[i] = x[i] + 0.5 * dt * k1[i];
      deriv(tmp, uPlant, k2);
      for (int i = 0; i < n; ++i) tmp[i] = x[i] + 0.5 * dt * k2[i];
      deriv(tmp, uPlant, k3);
      for (int i = 0; i < n; ++i) tmp[i] = x[i] + dt * k3[i];
      deriv(tmp, uPlant, k4);
      for (int i = 0; i < n; ++i) {
        x[i] += dt / 6.0 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
        if (!std::isfinite(x[i]) || std::fabs(x[i]) > 1e8) diverged = true;
      }
      if (diverged)
        for (int i = 0; i < n; ++i) x[i] = std::isfinite(x[i]) ? clamp(x[i], -1e8, 1e8) : 0.0;
    }
    uPlantPrev = uPlant;
  }

  const double windowEnd = (cfg.distTime > 0 && cfg.distTime < cfg.tEnd) ? cfg.distTime : cfg.tEnd;
  res.m = computeMetrics(res.y, res.u, res.r, dt, windowEnd, static_cast<double>(satCount) / steps);

  bool stable = !diverged;
  if (stable && nd == 0) {
    for (const Complex& pole : closedLoopPoles(p, k))
      if (pole.real() >= -1e-9) stable = false;
  } else if (stable) {
    // With a delay the rational poles don't tell the whole story: check the oscillation envelope.
    const int q = steps / 4;
    double a = 0, b = 0;
    for (int s = steps - 2 * q; s < steps - q; ++s) a = std::max(a, std::fabs(res.y[s] - res.m.finalValue));
    for (int s = steps - q; s < steps; ++s) b = std::max(b, std::fabs(res.y[s] - res.m.finalValue));
    if (b > 1.05 * a && b > 0.01 * std::max(1.0, std::fabs(cfg.ref))) stable = false;
  }
  res.m.stable = stable ? 1.0 : 0.0;
  return res;
}

// ---------------------------------------------------------------------------
// Frequency response
// ---------------------------------------------------------------------------

void loopFrequencyResponse(const StateSpace& p, const Controller& k, const Vec& w, Vec& magDb, Vec& phaseDeg) {
  const size_t N = w.size();
  magDb.assign(N, 0.0);
  phaseDeg.assign(N, 0.0);
  double prev = 0;
  for (size_t i = 0; i < N; ++i) {
    const Complex s(0.0, w[i]);
    CVec xs;
    Complex L(0, 0);
    if (solveShifted(p.A, s, p.B, xs)) {
      if (k.type == CTRL_SF) {
        for (int j = 0; j < p.n && j < static_cast<int>(k.K.size()); ++j) L += k.K[j] * xs[j];
      } else {
        Complex P = p.D;
        for (int j = 0; j < p.n; ++j) P += p.C[j] * xs[j];
        if (k.type == CTRL_PID) {
          Complex Cs = k.kp + k.ki / s;
          if (k.kd != 0.0) Cs += k.kd * k.N * s / (s + k.N);
          L = Cs * P;
        } else {
          L = P;
        }
      }
    } else {
      L = Complex(1e12, 0);
    }
    magDb[i] = 20.0 * std::log10(std::max(std::abs(L), 1e-300));
    double ph = std::arg(L) * 180.0 / kPi;
    if (i > 0) {
      while (ph - prev > 180.0) ph -= 360.0;
      while (ph - prev < -180.0) ph += 360.0;
    }
    prev = ph;
    phaseDeg[i] = ph;
  }
  for (size_t i = 0; i < N; ++i) phaseDeg[i] -= w[i] * p.delay * 180.0 / kPi;
}

Margins margins(const Vec& w, const Vec& magDb, const Vec& phaseDeg) {
  Margins m;
  const size_t N = w.size();
  for (size_t i = 0; i + 1 < N; ++i) {
    if (magDb[i] >= 0.0 && magDb[i + 1] < 0.0) {
      const double f = magDb[i] / (magDb[i] - magDb[i + 1]);
      m.wcp = std::exp(std::log(w[i]) + f * (std::log(w[i + 1]) - std::log(w[i])));
      double pm = 180.0 + phaseDeg[i] + f * (phaseDeg[i + 1] - phaseDeg[i]);
      while (pm > 180.0) pm -= 360.0;
      while (pm <= -180.0) pm += 360.0;
      m.pmDeg = pm;
      break;
    }
  }
  for (size_t i = 0; i + 1 < N; ++i) {
    const double a = phaseDeg[i] + 180.0, b = phaseDeg[i + 1] + 180.0;
    if ((a > 0.0 && b <= 0.0) || (a < 0.0 && b >= 0.0)) {
      const double f = a / (a - b);
      m.wcg = std::exp(std::log(w[i]) + f * (std::log(w[i + 1]) - std::log(w[i])));
      m.gmDb = -(magDb[i] + f * (magDb[i + 1] - magDb[i]));
      break;
    }
  }
  return m;
}

// ---------------------------------------------------------------------------
// LQR via the structure-preserving doubling algorithm on a fine discretisation
// ---------------------------------------------------------------------------

bool lqr(const StateSpace& p, const Vec& Qdiag, double R, Vec& K) {
  const int n = p.n;
  K.assign(n, 0.0);
  if (n == 0 || R <= 0) return false;
  double normA = 0;
  for (int i = 0; i < n; ++i) {
    double row = 0;
    for (int j = 0; j < n; ++j) row += std::fabs(p.A(i, j));
    normA = std::max(normA, row);
  }
  const double h = std::min(1e-3, 1e-2 / std::max(1.0, normA));
  Mat Ad = Mat::eye(n);
  for (size_t i = 0; i < Ad.a.size(); ++i) Ad.a[i] += p.A.a[i] * h;
  Mat G(n, n), H(n, n);
  for (int i = 0; i < n; ++i) {
    for (int j = 0; j < n; ++j) G(i, j) = p.B[i] * h * p.B[j] * h / (R * h);
    H(i, i) = (i < static_cast<int>(Qdiag.size()) ? Qdiag[i] : 1.0) * h;
  }
  Mat A = Ad;
  const Mat I = Mat::eye(n);
  bool converged = false;
  for (int it = 0; it < 200; ++it) {
    Mat W = matadd(I, matmul(G, H)), Winv;
    if (!inverse(W, Winv)) return false;
    const Mat AWinv = matmul(A, Winv);
    const Mat At = transpose(A);
    const Mat A1 = matmul(AWinv, A);
    const Mat G1 = matadd(G, matmul(matmul(AWinv, G), At));
    const Mat H1 = matadd(H, matmul(matmul(At, H), matmul(Winv, A)));
    double diff = 0, norm = 0;
    for (size_t i = 0; i < H.a.size(); ++i) {
      diff = std::max(diff, std::fabs(H1.a[i] - H.a[i]));
      norm = std::max(norm, std::fabs(H1.a[i]));
    }
    A = A1;
    G = G1;
    H = H1;
    for (double v : H.a)
      if (!std::isfinite(v)) return false;
    if (diff <= 1e-13 * std::max(1.0, norm)) {
      converged = true;
      break;
    }
  }
  if (!converged) return false;
  // K = (R h + Bd' P Bd)^-1 Bd' P Ad, with Bd = B h.
  Vec PB(n, 0.0);
  for (int i = 0; i < n; ++i)
    for (int j = 0; j < n; ++j) PB[i] += H(i, j) * p.B[j] * h;
  double denom = R * h;
  for (int i = 0; i < n; ++i) denom += p.B[i] * h * PB[i];
  for (int j = 0; j < n; ++j) {
    double acc = 0;
    for (int i = 0; i < n; ++i) acc += PB[i] * Ad(i, j);
    K[j] = acc / denom;
    if (!std::isfinite(K[j])) return false;
  }
  return true;
}

double computeNbar(const StateSpace& p, const Vec& K) {
  Controller c;
  c.type = CTRL_SF;
  c.K = K;
  Mat Acl = closedLoopA(p, c), inv;
  if (!inverse(Acl, inv)) return 1.0;
  double dc = p.D;
  for (int i = 0; i < p.n; ++i)
    for (int j = 0; j < p.n; ++j) dc -= p.C[i] * inv(i, j) * p.B[j];
  return std::fabs(dc) < 1e-12 ? 1.0 : 1.0 / dc;
}

// ---------------------------------------------------------------------------
// Step-response system identification (Nelder-Mead)
// ---------------------------------------------------------------------------

double stepFOPDT(double K, double tau, double theta, double t) {
  if (t <= theta) return 0.0;
  return K * (1.0 - std::exp(-(t - theta) / tau));
}

double stepSOPDT(double K, double wn, double zeta, double theta, double t) {
  if (t <= theta) return 0.0;
  const double tt = t - theta;
  if (zeta < 1.0 - 1e-6) {
    const double wd = wn * std::sqrt(1.0 - zeta * zeta);
    return K * (1.0 - std::exp(-zeta * wn * tt) *
                          (std::cos(wd * tt) + zeta / std::sqrt(1.0 - zeta * zeta) * std::sin(wd * tt)));
  }
  if (zeta <= 1.0 + 1e-6) return K * (1.0 - (1.0 + wn * tt) * std::exp(-wn * tt));
  const double sq = std::sqrt(zeta * zeta - 1.0);
  const double p1 = wn * (zeta - sq), p2 = wn * (zeta + sq);
  return K * (1.0 - (p2 * std::exp(-p1 * tt) - p1 * std::exp(-p2 * tt)) / (p2 - p1));
}

static Vec nelderMead(const std::function<double(const Vec&)>& f, Vec x0, const Vec& step, int iters) {
  const int n = static_cast<int>(x0.size());
  std::vector<Vec> s(n + 1, x0);
  for (int i = 0; i < n; ++i) s[i + 1][i] += step[i];
  Vec fv(n + 1);
  for (int i = 0; i <= n; ++i) fv[i] = f(s[i]);
  for (int it = 0; it < iters; ++it) {
    std::vector<int> idx(n + 1);
    for (int i = 0; i <= n; ++i) idx[i] = i;
    std::sort(idx.begin(), idx.end(), [&](int a, int b) { return fv[a] < fv[b]; });
    std::vector<Vec> s2;
    Vec f2;
    for (int i : idx) {
      s2.push_back(s[i]);
      f2.push_back(fv[i]);
    }
    s = s2;
    fv = f2;
    if (std::fabs(fv[n] - fv[0]) <= 1e-14 * (std::fabs(fv[0]) + 1e-20)) break;
    Vec c(n, 0.0);
    for (int i = 0; i < n; ++i)
      for (int j = 0; j < n; ++j) c[j] += s[i][j] / n;
    auto along = [&](double a) {
      Vec v(n);
      for (int j = 0; j < n; ++j) v[j] = c[j] + a * (s[n][j] - c[j]);
      return v;
    };
    Vec xr = along(-1.0);
    const double fr = f(xr);
    if (fr < fv[0]) {
      Vec xe = along(-2.0);
      const double fe = f(xe);
      if (fe < fr) {
        s[n] = xe;
        fv[n] = fe;
      } else {
        s[n] = xr;
        fv[n] = fr;
      }
    } else if (fr < fv[n - 1]) {
      s[n] = xr;
      fv[n] = fr;
    } else {
      Vec xc = along(fr < fv[n] ? -0.5 : 0.5);
      const double fc = f(xc);
      if (fc < std::min(fr, fv[n])) {
        s[n] = xc;
        fv[n] = fc;
      } else {
        for (int i = 1; i <= n; ++i) {
          for (int j = 0; j < n; ++j) s[i][j] = s[0][j] + 0.5 * (s[i][j] - s[0][j]);
          fv[i] = f(s[i]);
        }
      }
    }
  }
  int best = 0;
  for (int i = 1; i <= n; ++i)
    if (fv[i] < fv[best]) best = i;
  return s[best];
}

Fit fitStep(const Vec& t, const Vec& y, double uStep, int kind) {
  Fit fit;
  fit.kind = kind;
  const size_t N = std::min(t.size(), y.size());
  if (N < 5 || uStep == 0.0) return fit;
  const int tail = std::max<int>(1, static_cast<int>(N) / 10);
  double yf = 0;
  for (size_t i = N - tail; i < N; ++i) yf += y[i];
  yf /= tail;
  const double K0 = yf / uStep;
  double t63 = t[N - 1] / 3, t05 = 0, ypk = yf;
  bool got05 = false, got63 = false;
  for (size_t i = 0; i < N; ++i) {
    const double f = yf != 0.0 ? y[i] / yf : 0.0;
    if (!got05 && f >= 0.05) {
      t05 = t[i];
      got05 = true;
    }
    if (!got63 && f >= 0.632) {
      t63 = t[i];
      got63 = true;
    }
    if (yf >= 0 ? y[i] > ypk : y[i] < ypk) ypk = y[i];
  }
  const double theta0 = std::max(0.0, t05 * 0.5);
  const double tau0 = std::max(1e-3, t63 - theta0);

  auto sse = [&](double K, double a, double b, double theta) {
    double acc = 0;
    for (size_t i = 0; i < N; ++i) {
      const double model = kind == FIT_FOPDT ? stepFOPDT(K, a, theta, t[i]) * uStep
                                             : stepSOPDT(K, a, b, theta, t[i]) * uStep;
      const double e = y[i] - model;
      acc += e * e;
    }
    return acc;
  };

  Vec best;
  if (kind == FIT_FOPDT) {
    auto f = [&](const Vec& v) { return sse(v[0], std::exp(v[1]), 0, v[2] * v[2]); };
    Vec x0 = {K0, std::log(tau0), std::sqrt(theta0)};
    best = nelderMead(f, x0, {0.1 * std::fabs(K0) + 1e-3, 0.5, 0.2 + 0.1 * std::sqrt(theta0)}, 3000);
    best = nelderMead(f, best, {0.05 * std::fabs(best[0]) + 1e-4, 0.2, 0.1}, 3000);
    fit.K = best[0];
    fit.tau = std::exp(best[1]);
    fit.theta = best[2] * best[2];
    fit.sse = f(best);
  } else {
    const double mp = yf != 0.0 ? (ypk - yf) / yf : 0.0;
    double z0 = 0.9;
    if (mp > 0.005) {
      const double l = std::log(mp);
      z0 = -l / std::sqrt(kPi * kPi + l * l);
    }
    const double wn0 = 1.8 / std::max(1e-3, t63 - theta0);
    auto f = [&](const Vec& v) { return sse(v[0], std::exp(v[1]), std::exp(v[2]), v[3] * v[3]); };
    Vec x0 = {K0, std::log(wn0), std::log(z0), std::sqrt(theta0)};
    best = nelderMead(f, x0, {0.1 * std::fabs(K0) + 1e-3, 0.4, 0.4, 0.2 + 0.1 * std::sqrt(theta0)}, 4000);
    best = nelderMead(f, best, {0.05 * std::fabs(best[0]) + 1e-4, 0.15, 0.15, 0.1}, 4000);
    fit.K = best[0];
    fit.wn = std::exp(best[1]);
    fit.zeta = std::exp(best[2]);
    fit.theta = best[3] * best[3];
    fit.sse = f(best);
  }
  double mean = 0;
  for (size_t i = 0; i < N; ++i) mean += y[i];
  mean /= N;
  double sst = 0;
  for (size_t i = 0; i < N; ++i) sst += (y[i] - mean) * (y[i] - mean);
  fit.r2 = sst > 0 ? 1.0 - fit.sse / sst : 0.0;
  return fit;
}

Fit fitBest(const Vec& t, const Vec& y, double uStep) {
  const Fit a = fitStep(t, y, uStep, FIT_FOPDT);
  const Fit b = fitStep(t, y, uStep, FIT_SOPDT);
  const double n = static_cast<double>(std::min(t.size(), y.size()));
  const double aicA = n * std::log(std::max(a.sse, 1e-300) / n) + 2 * 3;
  const double aicB = n * std::log(std::max(b.sse, 1e-300) / n) + 2 * 4;
  return aicB + 2.0 < aicA ? b : a;
}

}  // namespace rc
