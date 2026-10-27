// Native validation suite for the PlantSim engine.
//
// Every check compares the engine to a closed-form answer from control theory. The suite also
// writes tests/golden.json, which the TypeScript test suite uses to prove that the browser
// fallback engine and the WebAssembly build give the same numbers.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>

#include "../src/plantsim.hpp"

using namespace rc;

static constexpr double kPi = 3.14159265358979323846;

extern "C" {
int rc_simulate(const double* in, int len, double* out, int cap);
int rc_poles(const double* in, int len, double* out, int cap);
int rc_bode(const double* in, int len, double* out, int cap);
int rc_lqr(const double* in, int len, double* out, int cap);
}

static int failures = 0, passes = 0;

static void check(bool ok, const std::string& name, const std::string& detail) {
  if (ok) {
    ++passes;
    std::printf("  PASS  %-52s %s\n", name.c_str(), detail.c_str());
  } else {
    ++failures;
    std::printf("  FAIL  %-52s %s\n", name.c_str(), detail.c_str());
  }
}

static std::string fmt(const char* f, double a, double b = 0) {
  char buf[160];
  std::snprintf(buf, sizeof buf, f, a, b);
  return buf;
}

static StateSpace fromTf(Vec num, Vec den, double delay = 0) {
  StateSpace s = tf2ss({num, den});
  s.delay = delay;
  return s;
}

static Controller pid(double kp, double ki, double kd, double N = 50) {
  Controller c;
  c.type = CTRL_PID;
  c.kp = kp;
  c.ki = ki;
  c.kd = kd;
  c.N = N;
  return c;
}

static StateSpace pendulumOnCart() {
  // Linearised inverted pendulum on a cart (M = 0.5 kg, m = 0.2 kg, l = 0.3 m, b = 0.1, I = 0.006).
  const double M = 0.5, m = 0.2, b = 0.1, I = 0.006, g = 9.8, l = 0.3;
  const double p = I * (M + m) + M * m * l * l;
  StateSpace s;
  s.n = 4;
  s.A = Mat(4, 4);
  s.A(0, 1) = 1;
  s.A(1, 1) = -(I + m * l * l) * b / p;
  s.A(1, 2) = (m * m * g * l * l) / p;
  s.A(2, 3) = 1;
  s.A(3, 1) = -(m * l * b) / p;
  s.A(3, 2) = m * g * l * (M + m) / p;
  s.B = {0, (I + m * l * l) / p, 0, m * l / p};
  s.C = {1, 0, 0, 0};
  return s;
}

// ---- Packing helpers (mirror src/lib/sim/wasm.ts) -------------------------------------------
static void packProblem(std::vector<double>& v, const StateSpace& p, const Controller& k) {
  v.push_back(p.n);
  for (double a : p.A.a) v.push_back(a);
  for (double a : p.B) v.push_back(a);
  for (double a : p.C) v.push_back(a);
  v.push_back(p.D);
  v.push_back(p.delay);
  v.push_back(k.type);
  v.push_back(k.kp);
  v.push_back(k.ki);
  v.push_back(k.kd);
  v.push_back(k.N);
  v.push_back(k.Nbar);
  for (int i = 0; i < p.n; ++i) v.push_back(i < static_cast<int>(k.K.size()) ? k.K[i] : 0.0);
}

static std::string jsonArr(const Vec& v, int stride = 1) {
  std::ostringstream o;
  o.precision(17);
  o << "[";
  bool first = true;
  for (size_t i = 0; i < v.size(); i += stride) {
    if (!first) o << ",";
    first = false;
    o << v[i];
  }
  o << "]";
  return o.str();
}

static std::string jsonProblem(const StateSpace& p, const Controller& k) {
  std::ostringstream o;
  o.precision(17);
  o << "{\"A\":" << jsonArr(p.A.a) << ",\"B\":" << jsonArr(p.B) << ",\"C\":" << jsonArr(p.C) << ",\"D\":" << p.D
    << ",\"delay\":" << p.delay << ",\"ctrl\":{\"type\":" << k.type << ",\"kp\":" << k.kp << ",\"ki\":" << k.ki
    << ",\"kd\":" << k.kd << ",\"N\":" << k.N << ",\"Nbar\":" << k.Nbar << ",\"K\":" << jsonArr(k.K) << "}}";
  return o.str();
}

int main() {
  std::printf("PlantSim native validation\n");

  // 1. First-order step response vs analytic 1 - e^-t
  {
    SimConfig cfg;
    cfg.tEnd = 12;
    cfg.dt = 1e-3;
    const SimResult r = simulate(fromTf({1}, {1, 1}), Controller{}, cfg);
    double err = 0;
    for (size_t i = 0; i < r.y.size(); ++i) err = std::max(err, std::fabs(r.y[i] - (1 - std::exp(-(i * cfg.dt)))));
    check(err < 1e-3 + 1e-9, "First-order lag matches 1 - e^(-t)", fmt("max err %.2e", err));
    check(std::fabs(r.m.riseTime - std::log(9.0)) < 5e-3, "First-order rise time = ln 9", fmt("%.4f s", r.m.riseTime));
  }
  // 2. Second-order overshoot vs exp(-pi z / sqrt(1 - z^2))
  {
    const double wn = 2, z = 0.3;
    SimConfig cfg;
    cfg.tEnd = 15;
    const SimResult r = simulate(fromTf({wn * wn}, {1, 2 * z * wn, wn * wn}), Controller{}, cfg);
    const double expected = 100 * std::exp(-kPi * z / std::sqrt(1 - z * z));
    check(std::fabs(r.m.overshootPct - expected) < 0.2, "Second-order overshoot formula", fmt("%.3f%% vs %.3f%%", r.m.overshootPct, expected));
    const double tp = kPi / (wn * std::sqrt(1 - z * z));
    check(std::fabs(r.m.peakTime - tp) < 5e-3, "Second-order peak time pi/wd", fmt("%.4f vs %.4f", r.m.peakTime, tp));
  }
  // 3. tf2ss -> ss2tf round trip
  {
    const TransferFunction tf = ss2tf(fromTf({2, 3}, {1, 4, 5, 6}));
    const Vec en = {0, 0, 2, 3}, ed = {1, 4, 5, 6};
    double err = 0;
    for (int i = 0; i < 4; ++i) err = std::max({err, std::fabs(tf.num[i] - en[i]), std::fabs(tf.den[i] - ed[i])});
    check(err < 1e-10, "tf2ss / ss2tf round trip", fmt("max err %.2e", err));
  }
  // 4. Poles
  {
    const CVec p = roots({1, 6, 11, 6});
    const bool ok = p.size() == 3 && std::fabs(p[0].real() + 1) < 1e-9 && std::fabs(p[1].real() + 2) < 1e-9 &&
                    std::fabs(p[2].real() + 3) < 1e-9;
    check(ok, "Roots of (s+1)(s+2)(s+3)", "");
    const CVec q = roots({1, 2, 5});
    check(q.size() == 2 && std::fabs(q[0].real() + 1) < 1e-9 && std::fabs(std::fabs(q[0].imag()) - 2) < 1e-9,
          "Complex roots of s^2 + 2s + 5 = -1 +/- 2j", "");
  }
  // 5. LQR on the double integrator: K = [1, sqrt(3)]
  {
    StateSpace s;
    s.n = 2;
    s.A = Mat(2, 2);
    s.A(0, 1) = 1;
    s.B = {0, 1};
    s.C = {1, 0};
    Vec K;
    const bool ok = lqr(s, {1, 1}, 1, K);
    check(ok && std::fabs(K[0] - 1) < 5e-3 && std::fabs(K[1] - std::sqrt(3.0)) < 5e-3, "LQR double integrator K = [1, sqrt 3]",
          fmt("K = [%.4f, %.4f]", K[0], K[1]));
  }
  // 6. Phase margin of 1/(s(s+1))
  {
    Vec w(800);
    for (int i = 0; i < 800; ++i) w[i] = 1e-3 * std::pow(1e7, i / 799.0);
    Vec mag, ph;
    loopFrequencyResponse(fromTf({1}, {1, 1, 0}), Controller{}, w, mag, ph);
    const Margins m = margins(w, mag, ph);
    check(std::fabs(m.pmDeg - 51.83) < 0.1 && std::fabs(m.wcp - 0.786) < 0.005, "Phase margin of 1/(s(s+1)) = 51.8 deg",
          fmt("PM %.2f deg at %.3f rad/s", m.pmDeg, m.wcp));
  }
  // 7. PI removes steady-state error
  {
    SimConfig cfg;
    cfg.tEnd = 10;
    const SimResult r = simulate(fromTf({1}, {1, 1}), pid(2, 3, 0), cfg);
    check(std::fabs(r.m.ssError) < 1e-3 && r.m.stable == 1, "PI control: zero steady-state error", fmt("e_ss = %.2e", r.m.ssError));
    const SimResult rp = simulate(fromTf({1}, {1, 1}), pid(2, 0, 0), cfg);
    check(std::fabs(rp.m.ssError - 1.0 / 3.0) < 1e-3, "P-only error = 1/(1+Kp)", fmt("e_ss = %.4f", rp.m.ssError));
  }
  // 8. FOPDT identification
  {
    Vec t, y;
    for (int i = 0; i <= 300; ++i) {
      t.push_back(i * 0.02);
      y.push_back(stepFOPDT(2.0, 1.5, 0.4, i * 0.02) * 0.5);
    }
    const Fit f = fitStep(t, y, 0.5, FIT_FOPDT);
    check(std::fabs(f.K - 2) < 0.01 && std::fabs(f.tau - 1.5) < 0.02 && std::fabs(f.theta - 0.4) < 0.02,
          "FOPDT fit recovers K=2, tau=1.5, theta=0.4", fmt("K %.3f tau %.3f", f.K, f.tau) + fmt(" theta %.3f r2 %.5f", f.theta, f.r2));
  }
  // 9. Second-order identification
  {
    Vec t, y;
    for (int i = 0; i <= 400; ++i) {
      t.push_back(i * 0.01);
      y.push_back(stepSOPDT(1.0, 3.0, 0.4, 0.0, i * 0.01));
    }
    const Fit f = fitBest(t, y, 1.0);
    check(f.kind == FIT_SOPDT && std::fabs(f.wn - 3) < 0.03 && std::fabs(f.zeta - 0.4) < 0.01,
          "Second-order fit recovers wn=3, zeta=0.4", fmt("wn %.3f zeta %.3f", f.wn, f.zeta));
  }
  // 10. LQR stabilises an inverted pendulum
  {
    const StateSpace s = pendulumOnCart();
    bool openUnstable = false;
    for (const Complex& z : eig(s.A))
      if (z.real() > 0.1) openUnstable = true;
    Controller c;
    c.type = CTRL_SF;
    const bool ok = lqr(s, {5000, 0, 100, 0}, 1, c.K);
    c.Nbar = computeNbar(s, c.K);
    SimConfig cfg;
    cfg.tEnd = 6;
    cfg.ref = 0.2;
    const SimResult r = simulate(s, c, cfg);
    check(openUnstable && ok && r.m.stable == 1 && std::fabs(r.m.ssError) < 1e-3,
          "LQR balances an inverted pendulum on a cart", fmt("final %.4f m, Ts %.2f s", r.m.finalValue, r.m.settlingTime));
  }
  // 11. Saturation with anti-windup
  {
    SimConfig cfg;
    cfg.tEnd = 20;
    cfg.uMax = 1.5;
    cfg.uMin = -1.5;
    const SimResult r = simulate(fromTf({1}, {1, 1}), pid(5, 10, 0), cfg);
    check(r.m.maxAbsU <= 1.5 + 1e-12 && r.m.overshootPct < 15 && r.m.saturatedFrac > 0, "Actuator limit respected, windup contained",
          fmt("max |u| %.3f, OS %.2f%%", r.m.maxAbsU, r.m.overshootPct));
  }
  // 12. Dead time
  {
    SimConfig cfg;
    cfg.tEnd = 3;
    const SimResult r = simulate(fromTf({1}, {1, 1}, 0.5), Controller{}, cfg);
    const double atDelay = r.y[static_cast<int>(0.5 / cfg.dt)];
    const double later = r.y[static_cast<int>(1.5 / cfg.dt)];
    check(std::fabs(atDelay) < 1e-9 && std::fabs(later - (1 - std::exp(-1.0))) < 3e-3, "Dead time delays the response",
          fmt("y(0.5)=%.2e y(1.5)=%.4f", atDelay, later));
  }
  // 13. Closed-loop poles of P control on 1/(s(s+1)): s^2 + s + K
  {
    const CVec p = closedLoopPoles(fromTf({1}, {1, 1, 0}), pid(4.25, 0, 0));
    check(p.size() == 2 && std::fabs(p[0].real() + 0.5) < 1e-9 && std::fabs(std::fabs(p[0].imag()) - 2) < 1e-9,
          "Closed-loop poles of s^2 + s + 4.25 = -0.5 +/- 2j", "");
  }

  // ---- Golden data for the TypeScript cross-check -------------------------------------------
  std::ofstream g("tests/golden.json");
  g.precision(17);
  g << "{\"cases\":[";
  struct Case {
    std::string name;
    StateSpace p;
    Controller k;
    SimConfig cfg;
  };
  std::vector<Case> cases;
  {
    SimConfig c;
    c.tEnd = 4;
    c.dt = 2e-3;
    cases.push_back({"dc-motor-pid", fromTf({8}, {0.05, 1.05, 1.0}), pid(3, 4, 0.08, 60), c});
    SimConfig c2 = c;
    c2.tEnd = 8;
    c2.uMax = 2;
    c2.uMin = -2;
    c2.distTime = 5;
    c2.distMag = -0.5;
    c2.noiseStd = 0.01;
    c2.seed = 42;
    cases.push_back({"thermal-sat-noise-dist", fromTf({0.9}, {12, 1}, 0.6), pid(4, 0.5, 2, 20), c2});
    Controller sf;
    sf.type = CTRL_SF;
    const StateSpace pend = pendulumOnCart();
    lqr(pend, {5000, 0, 100, 0}, 1, sf.K);
    sf.Nbar = computeNbar(pend, sf.K);
    SimConfig c3 = c;
    c3.ref = 0.2;
    c3.tEnd = 5;
    cases.push_back({"pendulum-lqr", pend, sf, c3});
    SimConfig c4 = c;
    c4.tEnd = 6;
    cases.push_back({"open-loop-2nd", fromTf({4}, {1, 1.2, 4}), Controller{}, c4});
  }
  for (size_t ci = 0; ci < cases.size(); ++ci) {
    const Case& cs = cases[ci];
    std::vector<double> in;
    packProblem(in, cs.p, cs.k);
    std::vector<double> simIn = in;
    for (double v : {cs.cfg.tEnd, cs.cfg.dt, cs.cfg.ref, cs.cfg.distTime, cs.cfg.distMag, cs.cfg.uMin, cs.cfg.uMax, cs.cfg.noiseStd,
                     static_cast<double>(cs.cfg.seed)})
      simIn.push_back(v);
    std::vector<double> out(200000);
    const int len = rc_simulate(simIn.data(), static_cast<int>(simIn.size()), out.data(), static_cast<int>(out.size()));
    const int steps = static_cast<int>(out[0]);
    Vec metrics(out.begin() + 1, out.begin() + 13), y(out.begin() + 13, out.begin() + 13 + steps),
        u(out.begin() + 13 + steps, out.begin() + 13 + 2 * steps);
    std::vector<double> pout(64);
    const int plen = rc_poles(in.data(), static_cast<int>(in.size()), pout.data(), 64);
    std::vector<double> bin = in;
    bin.push_back(400);
    bin.push_back(1e-2);
    bin.push_back(1e3);
    std::vector<double> bout(2000);
    const int blen = rc_bode(bin.data(), static_cast<int>(bin.size()), bout.data(), 2000);
    check(len > 0 && plen > 0 && blen > 0, "C ABI round trip: " + cs.name, fmt("%.0f samples", steps));
    g << (ci ? "," : "") << "{\"name\":\"" << cs.name << "\",\"problem\":" << jsonProblem(cs.p, cs.k) << ",\"cfg\":{\"tEnd\":" << cs.cfg.tEnd
      << ",\"dt\":" << cs.cfg.dt << ",\"ref\":" << cs.cfg.ref << ",\"distTime\":" << cs.cfg.distTime << ",\"distMag\":" << cs.cfg.distMag
      << ",\"uMin\":" << cs.cfg.uMin << ",\"uMax\":" << cs.cfg.uMax << ",\"noiseStd\":" << cs.cfg.noiseStd << ",\"seed\":" << cs.cfg.seed
      << "},\"metrics\":" << jsonArr(metrics) << ",\"y\":" << jsonArr(y, 10) << ",\"u\":" << jsonArr(u, 10)
      << ",\"poles\":" << jsonArr(Vec(pout.begin() + 1, pout.begin() + plen)) << ",\"margins\":"
      << jsonArr(Vec(bout.begin() + blen - 4, bout.begin() + blen)) << "}";
  }
  g << "]}\n";

  std::printf("\n%d passed, %d failed\n", passes, failures);
  return failures == 0 ? 0 : 1;
}
