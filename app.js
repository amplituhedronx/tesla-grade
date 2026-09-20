const $ = (id) => document.getElementById(id);

const EL_DB = 3;
const MIN_MOVE = 2;
const MAX_VS = 6;
const MAX_GRADE = 25;

const state = {
  unit: localStorage.getItem("grade-unit") || "m",
  watchId: null,
  lastStamp: 0,
  lastAlt: null,
  lastAltTs: 0,
  lastVsAlt: null,
  lastFixT: 0,
  lastLat: null,
  lastLon: null,
  lastElAlt: null,
  lastProfileT: 0,
  lastProfileD: 0,
  profile: [],
  smoothAlt: null,
  vs: null,
  grade: 0,
  drawGrade: 0,
  speed: 0,
  odo: 0,
  gain: 0,
  loss: 0,
  starting: false
};

const isTesla = /Tesla/i.test(navigator.userAgent);
const isAppleTouch = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function toDisp(m) {
  if (m == null || Number.isNaN(m)) return null;
  return state.unit === "ft" ? m * 3.28084 : m;
}
function fmtAlt(m) {
  const v = toDisp(m);
  return v == null ? "\u2014" : (Math.round(v * 10) / 10).toFixed(1);
}
function fmtVs(mps) {
  if (mps == null || !Number.isFinite(mps)) return "0 " + state.unit + "/min";
  const v = Math.round(mps * 60 * (state.unit === "ft" ? 3.28084 : 1));
  if (Math.abs(v) < 1) return "0 " + state.unit + "/min";
  return (v > 0 ? "+" : "") + v + " " + state.unit + "/min";
}
function fmtGrade(p) {
  if (p == null || !Number.isFinite(p)) return "0%";
  const v = Math.round(p * 10) / 10;
  if (Math.abs(v) < 0.4) return "0%";
  return (v > 0 ? "+" : "") + v.toFixed(1) + "%";
}
function fmtSpeed(mps) {
  if (mps == null || Number.isNaN(mps)) return "\u2014";
  if (state.unit === "ft") return Math.round(mps * 2.23694) + " mph";
  return Math.round(mps * 3.6) + " km/h";
}
function fmtDist(m) {
  const n = Number.isFinite(m) && m > 0 ? m : 0;
  if (state.unit === "ft") return (n / 1609.344).toFixed(2) + " mi";
  return (n / 1000).toFixed(2) + " km";
}
function fmtEl(m) {
  return Math.round(toDisp(m) || 0) + " " + state.unit;
}
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}
function setStatus(kind, text) {
  $("dot").className = "dot " + kind;
  $("statusText").textContent = text;
}

function setUnit(u) {
  state.unit = u;
  localStorage.setItem("grade-unit", u);
  $("btnM").classList.toggle("on", u === "m");
  $("btnFt").classList.toggle("on", u === "ft");
  $("altUnit").textContent = u;
  paint();
  drawProfile();
}

function resetSession() {
  state.profile = [];
  state.vs = null;
  state.grade = 0;
  state.drawGrade = 0;
  state.odo = 0;
  state.gain = 0;
  state.loss = 0;
  state.lastElAlt = state.smoothAlt;
  state.lastVsAlt = state.smoothAlt;
  state.lastAltTs = 0;
  state.lastFixT = 0;
  state.lastProfileT = 0;
  state.lastProfileD = 0;
  paint();
  drawIncline();
  drawProfile();
}

function paint() {
  $("alt").textContent = fmtAlt(state.smoothAlt);
  $("grade").textContent = fmtGrade(state.grade);
  $("vs").textContent = fmtVs(state.vs);
  $("speed").textContent = fmtSpeed(state.speed);
  $("gain").textContent = fmtEl(state.gain);
  $("loss").textContent = fmtEl(state.loss);
}

function accrueGain(alt) {
  if (alt == null || !Number.isFinite(alt)) return;
  if (state.lastElAlt == null) {
    state.lastElAlt = alt;
    return;
  }
  const d = alt - state.lastElAlt;
  if (d >= EL_DB) {
    state.gain += d;
    state.lastElAlt = alt;
  } else if (d <= -EL_DB) {
    state.loss += -d;
    state.lastElAlt = alt;
  }
}

function advanceOdo(now, speed) {
  const spd = Number.isFinite(speed) && speed > 0 ? speed : 0;
  const dt = state.lastFixT > 0 ? (now - state.lastFixT) / 1000 : 0;
  if (spd >= 0.5 && dt >= 0.4 && dt <= 4) state.odo += spd * dt;
  state.lastFixT = now;
  state.speed = spd;
}

function pushProfile(now, alt) {
  if (alt == null || !Number.isFinite(alt)) return;
  const moved = state.odo - state.lastProfileD;
  if (state.profile.length && now - state.lastProfileT < 800 && moved < 8) {
    state.profile[state.profile.length - 1] = { t: now, alt: alt, dist: state.odo };
    return;
  }
  if (state.profile.length && moved < 6 && now - state.lastProfileT < 2000) return;
  state.profile.push({ t: now, alt: alt, dist: state.odo });
  state.lastProfileT = now;
  state.lastProfileD = state.odo;
  if (state.profile.length > 2500) state.profile = state.profile.slice(-1800);
}

function updateClimb(smoothAlt, speed, t) {
  if (smoothAlt == null || !Number.isFinite(smoothAlt)) return;

  if (!state.lastAltTs) {
    state.lastAltTs = t;
    state.lastVsAlt = smoothAlt;
    return;
  }

  const dt = (t - state.lastAltTs) / 1000;
  if (dt < 2 || dt >= 15) {
    if (dt >= 15) {
      state.lastAltTs = t;
      state.lastVsAlt = smoothAlt;
    }
    return;
  }

  let rawVs = (smoothAlt - state.lastVsAlt) / dt;
  if (!Number.isFinite(rawVs)) return;
  rawVs = clamp(rawVs, -MAX_VS, MAX_VS);

  state.vs = state.vs == null ? rawVs : state.vs * 0.65 + rawVs * 0.35;
  state.lastAltTs = t;
  state.lastVsAlt = smoothAlt;

  const spd = Number.isFinite(speed) ? speed : 0;
  if (spd >= MIN_MOVE && state.vs != null) {
    const rawGrade = clamp((state.vs / spd) * 100, -MAX_GRADE, MAX_GRADE);
    state.grade = state.grade * 0.7 + rawGrade * 0.3;
  } else {
    state.grade *= 0.82;
    if (Math.abs(state.grade) < 0.4) state.grade = 0;
    if (state.vs != null) state.vs *= 0.82;
  }
}

function applyFix(pos) {
  const c = pos.coords;
  const t = pos.timestamp || Date.now();
  if (t <= state.lastStamp) return;
  state.lastStamp = t;

  const alt = c.altitude;
  const speed = c.speed;
  advanceOdo(t, speed);

  if (alt != null && Number.isFinite(alt)) {
    if (state.smoothAlt == null) state.smoothAlt = alt;
    else state.smoothAlt = state.smoothAlt * 0.72 + alt * 0.28;
    state.lastAlt = alt;
    updateClimb(state.smoothAlt, speed, t);
    accrueGain(state.smoothAlt);
    pushProfile(t, state.smoothAlt);
  }

  paint();

  const acc = c.accuracy;
  if (acc != null && acc <= 12) setStatus("live", "GPS lock");
  else if (acc != null && acc <= 40) setStatus("live", "GPS \u00b1" + Math.round(acc) + " m");
  else if (acc != null) setStatus("wait", "GPS \u00b1" + Math.round(acc) + " m");
  else setStatus("live", "GPS live");
}

function drawIncline() {
  state.drawGrade += (state.grade - state.drawGrade) * 0.16;
  const wedge = $("inclineWedge");
  const bar = $("inclineBar");
  if (!wedge || !bar) return;
  const w = 800, cy = 55, cx = w / 2;
  const clamped = clamp(state.drawGrade, -18, 18);
  const vis = Math.atan(clamped / 100) * 180 / Math.PI * 2.2;
  const rad = (-vis * Math.PI) / 180;
  const barW = w * 0.78;
  const hx = (barW / 2) * Math.cos(rad);
  const hy = (barW / 2) * Math.sin(rad);
  const fillA = Math.min(0.4, 0.08 + Math.abs(clamped) / 32);
  wedge.setAttribute("points",
    (cx - hx) + "," + (cy - hy) + " " +
    (cx + hx) + "," + (cy + hy) + " " +
    (cx + hx) + "," + cy + " " +
    (cx - hx) + "," + cy);
  wedge.setAttribute("fill", "rgba(62,106,225," + fillA + ")");
  bar.setAttribute("transform", "translate(" + cx + " " + cy + ") rotate(" + (rad * 180 / Math.PI) + ")");
}

function drawProfile() {
  const lineEl = $("profileLine");
  const fillEl = $("profileFill");
  const dotEl = $("profileDot");
  const hint = $("profileHint");
  const pts = state.profile;
  if (!lineEl) return;
  if (!pts.length) {
    lineEl.setAttribute("d", "");
    if (fillEl) fillEl.setAttribute("d", "");
    if (dotEl) dotEl.setAttribute("cx", "-20");
    if (hint) hint.textContent = "Drive to build profile";
    $("profileRange").textContent = fmtDist(0);
    $("profileX0").textContent = fmtDist(0);
    $("profileX1").textContent = "";
    $("profileX2").textContent = fmtDist(0);
    $("profileMax").textContent = "";
    $("profileMin").textContent = "";
    return;
  }
  hint.textContent = "";
  const padL = 88, padR = 24, padT = 16, padB = 34;
  const iw = 1000 - padL - padR, ih = 220 - padT - padB;
  const d0 = pts[0].dist;
  const d1 = pts[pts.length - 1].dist;
  const spanX = Math.max(d1 - d0, state.odo, 1);
  let min = toDisp(pts[0].alt), max = min;
  for (let i = 1; i < pts.length; i++) {
    const a = toDisp(pts[i].alt);
    if (a < min) min = a;
    if (a > max) max = a;
  }
  const padY = Math.max((max - min) * 0.12, 6);
  let y0 = min - padY;
  let y1 = max + padY;
  if (y1 - y0 < 40) {
    const mid = (y0 + y1) / 2;
    y0 = mid - 20;
    y1 = mid + 20;
  }
  const spanY = y1 - y0 || 1;

  function xy(p) {
    const x = padL + ((p.dist - d0) / spanX) * iw;
    const y = padT + (1 - (toDisp(p.alt) - y0) / spanY) * ih;
    return [x, y];
  }

  let line = "", area = "";
  for (let i = 0; i < pts.length; i++) {
    const pt = xy(pts[i]);
    line += (i ? " L" : "M") + pt[0].toFixed(1) + " " + pt[1].toFixed(1);
    area += (i ? " L" : "M") + pt[0].toFixed(1) + " " + pt[1].toFixed(1);
  }
  const last = xy(pts[pts.length - 1]);
  const base = padT + ih;
  area += " L" + last[0].toFixed(1) + " " + base + " L" + padL.toFixed(1) + " " + base + " Z";
  lineEl.setAttribute("d", line);
  fillEl.setAttribute("d", area);
  dotEl.setAttribute("cx", last[0].toFixed(1));
  dotEl.setAttribute("cy", last[1].toFixed(1));
  $("profileMax").textContent = Math.round(max) + " " + state.unit;
  $("profileMin").textContent = Math.round(min) + " " + state.unit;
  $("profileX0").textContent = fmtDist(0);
  $("profileX1").textContent = fmtDist(spanX / 2);
  $("profileX2").textContent = fmtDist(spanX);
  $("profileRange").textContent = fmtDist(spanX);
}

function loop() {
  drawIncline();
  requestAnimationFrame(loop);
}

function showGate(title, text) {
  $("gateTitle").textContent = title;
  $("gateText").textContent = text;
  $("gate").classList.add("show");
}

function onError(err) {
  const code = err && err.code;
  if (code === 1) {
    setStatus("off", "Location blocked");
    showGate("Location blocked", isAppleTouch
      ? "Settings \u2192 Safari \u2192 Location \u2192 Ask or Allow, then reload and tap Enable location."
      : "Allow location in site settings, then tap Enable location.");
  } else if (code === 2) setStatus("wait", "GPS unavailable");
  else if (code === 3) setStatus("wait", "GPS timeout");
  else setStatus("wait", err && err.message ? err.message : "GPS error");
}

function startWatch() {
  if (state.starting) return;
  state.starting = true;
  setTimeout(function () { state.starting = false; }, 1500);
  if (!window.isSecureContext) {
    setStatus("off", "Needs HTTPS");
    showGate("Needs HTTPS", "Open the Render URL (https).");
    return;
  }
  if (!navigator.geolocation) {
    setStatus("off", "No geolocation");
    showGate("No geolocation", "This browser does not expose GPS.");
    return;
  }
  if (state.watchId != null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
  $("gate").classList.remove("show");
  setStatus("wait", "Acquiring GPS");
  const opts = { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 };
  navigator.geolocation.getCurrentPosition(function (pos) {
    applyFix(pos);
    drawProfile();
    state.watchId = navigator.geolocation.watchPosition(function (next) {
      applyFix(next);
    }, onError, opts);
  }, onError, opts);
}

$("btnM").addEventListener("click", function () { setUnit("m"); });
$("btnFt").addEventListener("click", function () { setUnit("ft"); });
$("btnReset").addEventListener("click", function () { resetSession(); });
$("askLoc").addEventListener("click", function (e) { e.preventDefault(); startWatch(); });
$("askLoc").addEventListener("touchend", function (e) { e.preventDefault(); startWatch(); }, { passive: false });

setUnit(state.unit);
drawIncline();
drawProfile();
loop();
setInterval(drawProfile, 1000);

if (isTesla) startWatch();
else {
  setStatus("wait", "Tap to enable GPS");
  showGate("Enable location", isAppleTouch
    ? "On iPhone, Safari only asks for GPS after a tap. Tap the button, then Allow."
    : "Tap to allow GPS.");
}

document.addEventListener("visibilitychange", function () {
  if (document.visibilityState === "visible" && isTesla) startWatch();
});
