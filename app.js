const $ = (id) => document.getElementById(id);
const CLIMB_WINDOW_MS = 4000;
const EL_DB = 3;

const state = {
  unit: localStorage.getItem("grade-unit") || "m",
  watchId: null,
  pollId: null,
  lastPos: null,
  lastAlt: null,
  lastClimbSample: 0,
  lastFixT: 0,
  lastLat: null,
  lastLon: null,
  climbLog: [],
  profile: [],
  smoothAlt: null,
  vs: 0,
  grade: 0,
  vsReady: false,
  speed: 0,
  odo: 0,
  gain: 0,
  loss: 0,
  lastAltForEl: null,
  drawGrade: 0,
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
  if (!state.vsReady || mps == null || Number.isNaN(mps)) return "0 " + state.unit + "/min";
  const v = Math.round(mps * 60 * (state.unit === "ft" ? 3.28084 : 1));
  return (v > 0 ? "+" : "") + v + " " + state.unit + "/min";
}
function fmtGrade(p) {
  if (p == null || !Number.isFinite(p)) return "0%";
  const v = Math.round(p * 10) / 10;
  if (Math.abs(v) < 0.3) return "0%";
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
function setStatus(kind, text) {
  $("dot").className = "dot " + kind;
  $("statusText").textContent = text;
}
function distM(a, b) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const la1 = a.lat * Math.PI / 180;
  const la2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
function zeroClimb() {
  state.vs = 0;
  state.grade = 0;
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
  state.climbLog = [];
  state.profile = [];
  state.vs = 0;
  state.grade = 0;
  state.vsReady = false;
  state.odo = 0;
  state.gain = 0;
  state.loss = 0;
  state.lastAltForEl = state.smoothAlt;
  state.lastClimbSample = 0;
  state.lastFixT = 0;
  state.drawGrade = 0;
  paint();
  drawIncline();
  drawProfile();
}

function sampleClimb(smoothAlt, speed) {
  const now = Date.now();
  if (smoothAlt == null || !Number.isFinite(smoothAlt)) return;
  state.vsReady = true;
  if (now - state.lastClimbSample < 800) return;
  state.lastClimbSample = now;

  const spd = speed == null || !Number.isFinite(speed) ? 0 : speed;
  const log = state.climbLog;
  log.push({ t: now, alt: smoothAlt, speed: spd });
  while (log.length && now - log[0].t > 10000) log.shift();

  const avgSpeed = log.reduce((s, p) => s + p.speed, 0) / log.length;
  if (avgSpeed < 1.2) {
    zeroClimb();
    return;
  }

  let older = null;
  for (let i = 0; i < log.length; i++) {
    if (now - log[i].t >= CLIMB_WINDOW_MS) older = log[i];
  }
  if (!older) return;

  const dt = (now - older.t) / 1000;
  if (dt < 2) return;

  const rise = smoothAlt - older.alt;
  const run = avgSpeed * dt;
  if (!Number.isFinite(rise) || run < 8) {
    zeroClimb();
    return;
  }

  const rawGrade = (rise / run) * 100;
  if (!Number.isFinite(rawGrade)) return;

  state.grade = state.grade * 0.65 + rawGrade * 0.35;
  if (Math.abs(state.grade) < 0.3) {
    zeroClimb();
    return;
  }
  state.vs = (state.grade / 100) * avgSpeed;
}

function accrueGain(alt) {
  if (alt == null || !Number.isFinite(alt)) return;
  if (state.lastAltForEl == null) {
    state.lastAltForEl = alt;
    return;
  }
  const d = alt - state.lastAltForEl;
  if (d >= EL_DB) {
    state.gain += d;
    state.lastAltForEl = alt;
  } else if (d <= -EL_DB) {
    state.loss += -d;
    state.lastAltForEl = alt;
  }
}

function advanceOdo(now, speed, lat, lon) {
  let spd = 0;
  if (Number.isFinite(speed) && speed > 0) spd = speed;
  const dt = state.lastFixT > 0 ? (now - state.lastFixT) / 1000 : 0;
  let step = 0;
  if (lat != null && lon != null && state.lastLat != null) {
    const geo = distM({ lat: state.lastLat, lon: state.lastLon }, { lat: lat, lon: lon });
    if (Number.isFinite(geo) && geo >= 1.5 && geo < 2000) step = geo;
  }
  if (spd >= 0.5 && dt >= 0.3 && dt <= 4) state.odo += spd * dt;
  else if (step >= 1.5) state.odo += step;
  if (lat != null && lon != null && Number.isFinite(lat)) {
    if (state.lastLat == null || step >= 1.5) {
      state.lastLat = lat;
      state.lastLon = lon;
    }
  }
  state.lastFixT = now;
  state.speed = spd;
}

function pushProfile(now, alt) {
  if (alt == null || !Number.isFinite(alt)) return;
  const p = state.profile;
  const row = { t: now, alt: alt, dist: state.odo };
  if (!p.length) {
    p.push(row);
    return;
  }
  if (now - p[p.length - 1].t < 500) p[p.length - 1] = row;
  else p.push(row);
  if (p.length > 2500) state.profile = p.slice(-1800);
}

function paint() {
  $("alt").textContent = fmtAlt(state.smoothAlt);
  $("grade").textContent = fmtGrade(state.grade);
  $("vs").textContent = fmtVs(state.vs);
  $("speed").textContent = fmtSpeed(state.speed);
  $("gain").textContent = fmtEl(state.gain);
  $("loss").textContent = fmtEl(state.loss);
}

function applyFix(pos) {
  const c = pos.coords;
  const now = Date.now();
  const alt = c.altitude;
  const speed = c.speed;
  advanceOdo(now, speed, c.latitude, c.longitude);

  if (alt != null && Number.isFinite(alt)) {
    if (state.smoothAlt == null) state.smoothAlt = alt;
    else state.smoothAlt = state.smoothAlt * 0.72 + alt * 0.28;
    state.lastAlt = alt;
    sampleClimb(state.smoothAlt, speed);
    accrueGain(state.smoothAlt);
    pushProfile(now, state.smoothAlt);
  }
  paint();

  const acc = c.accuracy;
  if (acc != null && acc <= 12) setStatus("live", "GPS lock");
  else if (acc != null && acc <= 40) setStatus("live", "GPS \u00b1" + Math.round(acc) + " m");
  else if (acc != null) setStatus("wait", "GPS \u00b1" + Math.round(acc) + " m");
  else setStatus("live", "GPS live");
}

function drawIncline() {
  state.drawGrade += (state.grade - state.drawGrade) * 0.18;
  const wedge = $("inclineWedge");
  const bar = $("inclineBar");
  if (!wedge || !bar) return;
  const w = 800, cy = 55, cx = w / 2;
  const clamped = Math.max(-18, Math.min(18, state.drawGrade));
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
  if (!lineEl || !pts.length) {
    if (lineEl) lineEl.setAttribute("d", "");
    if (fillEl) fillEl.setAttribute("d", "");
    if (dotEl) dotEl.setAttribute("cx", "-20");
    if (hint) hint.textContent = "Drive to build profile";
    $("profileRange").textContent = fmtDist(0);
    $("profileX0").textContent = fmtDist(0);
    $("profileX1").textContent = fmtDist(0);
    $("profileX2").textContent = fmtDist(0);
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
  const padY = Math.max((max - min) * 0.12, 8);
  const y0 = min - padY, y1 = max + padY, spanY = y1 - y0 || 1;

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
function stopGps() {
  if (state.watchId != null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
  if (state.pollId) {
    clearInterval(state.pollId);
    state.pollId = null;
  }
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
  stopGps();
  $("gate").classList.remove("show");
  setStatus("wait", "Acquiring GPS");
  const opts = { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 };
  navigator.geolocation.getCurrentPosition(function (pos) {
    state.lastPos = pos;
    applyFix(pos);
    drawProfile();
  }, onError, opts);
  state.watchId = navigator.geolocation.watchPosition(function (pos) {
    state.lastPos = pos;
    applyFix(pos);
  }, onError, opts);
  state.pollId = setInterval(function () {
    navigator.geolocation.getCurrentPosition(function (pos) {
      state.lastPos = pos;
      applyFix(pos);
    }, function () {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 8000 });
  }, 1000);
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
