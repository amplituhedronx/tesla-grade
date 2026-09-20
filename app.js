const $ = (id) => document.getElementById(id);
const CLIMB_WINDOW_MS = 4000;
const EL_DB = 3;
const SEGMENTS = [
  { dt: 18, grade: 1.4, speedKmh: 78 },
  { dt: 22, grade: 6.8, speedKmh: 46 },
  { dt: 16, grade: 11.2, speedKmh: 36 },
  { dt: 14, grade: 4.6, speedKmh: 44 },
  { dt: 10, grade: 0.5, speedKmh: 52 },
  { dt: 20, grade: -8.4, speedKmh: 58 },
  { dt: 14, grade: -3.1, speedKmh: 72 }
];
const CYCLE = SEGMENTS.reduce((s, x) => s + x.dt, 0);

const state = {
  unit: localStorage.getItem("grade-unit") || "m",
  mode: "gps",
  watchId: null, pollId: null, simId: null, tickId: null,
  lastPos: null, lastAlt: null, lastClimbSample: 0, lastFixT: 0, lastMoveT: 0,
  climbLog: [], profile: [],
  smoothAlt: null, vs: 0, grade: 0, vsReady: false,
  speed: 0, odo: 0, gain: 0, loss: 0, lastAltForEl: null,
  lastElevFetch: 0, lastElevAt: null, terrain: null,
  starting: false, drawGrade: 0, sim: null, lastLat: null, lastLon: null
};

const isTesla = /Tesla/i.test(navigator.userAgent);
const isAppleTouch = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function setUnit(u) {
  state.unit = u;
  localStorage.setItem("grade-unit", u);
  $("btnM").classList.toggle("on", u === "m");
  $("btnFt").classList.toggle("on", u === "ft");
  $("altUnit").textContent = u;
  paintReadouts();
  drawProfile();
}
function setMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  $("btnSim").classList.toggle("on", mode === "sim");
  $("btnGps").classList.toggle("on", mode === "gps");
  stopGps(); stopSim(); resetSession();
  $("gate").classList.remove("show");
  if (mode === "sim") startSim(); else startWatch();
}
function resetSession() {
  state.climbLog = []; state.profile = [];
  state.smoothAlt = null; state.vs = 0; state.grade = 0; state.vsReady = false;
  state.speed = 0; state.odo = 0; state.gain = 0; state.loss = 0;
  state.lastAltForEl = null; state.lastClimbSample = 0; state.lastFixT = 0; state.lastMoveT = 0;
  state.lastPos = null; state.lastAlt = null; state.drawGrade = 0;
  state.terrain = null; state.lastLat = null; state.lastLon = null;
  paintReadouts(); drawIncline(); drawProfile();
}
function toDisp(m) { if (m == null || Number.isNaN(m)) return null; return state.unit === "ft" ? m * 3.28084 : m; }
function fmtAlt(m) { const v = toDisp(m); return v == null ? "\u2014" : Math.round(v).toString(); }
function fmtAlt1(m) { const v = toDisp(m); return v == null ? "\u2014" : (Math.round(v * 10) / 10).toFixed(1); }
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
function setStatus(kind, text) { $("dot").className = "dot " + kind; $("statusText").textContent = text; }
function distM(a, b) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lon - a.lon) * Math.PI / 180;
  const la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
function zeroClimb() { state.vs = 0; state.grade = 0; }

function sampleClimb(smoothAlt, speed, lat, lon, now) {
  now = now || Date.now();
  if (smoothAlt == null || !Number.isFinite(smoothAlt)) return;
  state.vsReady = true;
  if (now - state.lastClimbSample < 800) return;
  state.lastClimbSample = now;
  const spd = speed == null || !Number.isFinite(speed) ? 0 : speed;
  const log = state.climbLog;
  log.push({ t: now, alt: smoothAlt, speed: spd, lat: lat, lon: lon });
  while (log.length && now - log[0].t > 10000) log.shift();
  let older = null;
  for (let i = 0; i < log.length; i++) if (now - log[i].t >= CLIMB_WINDOW_MS) older = log[i];
  if (!older) return;
  const last = log[log.length - 1];
  const dt = (now - older.t) / 1000;
  if (dt < 2) return;
  const rise = smoothAlt - older.alt;
  let run = 0;
  if (older.lat != null && last.lat != null) run = distM({ lat: older.lat, lon: older.lon }, { lat: last.lat, lon: last.lon });
  if (run < 8) {
    const avgSpeed = log.reduce((s, p) => s + p.speed, 0) / log.length;
    run = avgSpeed * dt;
  }
  if (!Number.isFinite(rise) || run < 8) {
    if (spd < 1.2 && run < 8) zeroClimb();
    return;
  }
  const rawGrade = (rise / run) * 100;
  if (!Number.isFinite(rawGrade)) return;
  state.grade = state.grade * 0.65 + rawGrade * 0.35;
  if (Math.abs(state.grade) < 0.3) { zeroClimb(); return; }
  state.vs = (state.grade / 100) * (run / dt);
}

function accrueGain(alt) {
  if (alt == null || !Number.isFinite(alt)) return;
  if (state.lastAltForEl == null) { state.lastAltForEl = alt; return; }
  const d = alt - state.lastAltForEl;
  if (d >= EL_DB) { state.gain += d; state.lastAltForEl = alt; }
  else if (d <= -EL_DB) { state.loss += -d; state.lastAltForEl = alt; }
}

function pushProfile(now, alt) {
  if (alt == null || !Number.isFinite(alt)) return;
  const p = state.profile;
  const row = { t: now, alt: alt, dist: state.odo, lat: state.lastLat, lon: state.lastLon };
  if (!p.length) { p.push(row); return; }
  if (now - p[p.length - 1].t < 400) p[p.length - 1] = row;
  else p.push(row);
  if (p.length > 4000) {
    const kept = [], cut = Math.floor(p.length / 2);
    for (let i = 0; i < cut; i += 2) kept.push(p[i]);
    for (let i = cut; i < p.length; i++) kept.push(p[i]);
    state.profile = kept;
  }
}

function advanceOdo(now, speed, lat, lon) {
  let spd = 0;
  if (Number.isFinite(speed) && speed > 0) spd = speed > 70 ? speed / 3.6 : speed;
  let geo = 0;
  if (lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon) && state.lastLat != null) {
    const step = distM({ lat: state.lastLat, lon: state.lastLon }, { lat: lat, lon: lon });
    if (Number.isFinite(step) && step >= 1.5 && step < 8000) geo = step;
  }

  const dtSpeed = state.lastFixT > 0 ? (now - state.lastFixT) / 1000 : 0;
  const dtGeo = state.lastMoveT > 0 ? (now - state.lastMoveT) / 1000 : dtSpeed;

  // Prefer GPS speed when the car reports it. Tesla often returns the same
  // cached lat/lon on the 1 Hz poll; those duplicates must not reset the
  // movement clock or we reject the next real jump as a teleport.
  if (spd >= 0.5 && dtSpeed >= 0.35 && dtSpeed <= 8) {
    state.odo += spd * dtSpeed;
    state.lastFixT = now;
  } else if (geo >= 1.5) {
    const implied = dtGeo > 0.4 ? geo / dtGeo : 0;
    if (implied === 0 || implied <= 70) {
      state.odo += geo;
      if (spd < 0.5 && implied > 0) spd = implied;
      state.lastFixT = now;
    }
  } else if (dtSpeed > 15) {
    state.lastFixT = now;
  }
  if (state.lastFixT === 0) state.lastFixT = now;

  if (lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon)) {
    if (state.lastLat == null || geo >= 1.5) {
      state.lastLat = lat;
      state.lastLon = lon;
      state.lastMoveT = now;
    } else if (!state.lastMoveT) {
      state.lastMoveT = now;
    }
  }
  state.speed = spd;
  return spd;
}

async function fetchTerrain(lat, lon) {
  if (state.mode === "sim") return;
  const now = Date.now();
  if (now - state.lastElevFetch < 20000) return;
  if (state.lastElevAt && distM(state.lastElevAt, { lat: lat, lon: lon }) < 40) return;
  state.lastElevFetch = now;
  try {
    const res = await fetch("https://api.open-meteo.com/v1/elevation?latitude=" + lat + "&longitude=" + lon);
    if (!res.ok) return;
    const data = await res.json();
    const el = Array.isArray(data.elevation) ? data.elevation[0] : data.elevation;
    if (typeof el === "number") {
      state.terrain = el;
      state.lastElevAt = { lat: lat, lon: lon };
      paintReadouts();
    }
  } catch (_) {}
}

function paintReadouts() {
  $("alt").textContent = fmtAlt(state.smoothAlt);
  $("gpsAlt").textContent = state.lastAlt == null ? "\u2014" : fmtAlt1(state.lastAlt) + " " + state.unit;
  $("terrainAlt").textContent = state.terrain == null ? "\u2014" : fmtAlt1(state.terrain) + " " + state.unit;
  $("vs").textContent = fmtVs(state.vs);
  $("grade").textContent = fmtGrade(state.grade);
  $("speed").textContent = fmtSpeed(state.speed);
  const u = state.unit;
  $("gain").textContent = "\u2191 " + Math.round(toDisp(state.gain) || 0) + " " + u;
  $("loss").textContent = "\u2193 " + Math.round(toDisp(state.loss) || 0) + " " + u;
}

function applyFix(alt, speed, lat, lon, now) {
  now = now || Date.now();
  const spd = advanceOdo(now, speed, lat, lon);
  if (alt != null && Number.isFinite(alt)) {
    if (state.smoothAlt == null) state.smoothAlt = alt;
    else state.smoothAlt = state.smoothAlt * 0.72 + alt * 0.28;
    state.lastAlt = alt;
  }
  if (state.smoothAlt != null) {
    accrueGain(state.smoothAlt);
    sampleClimb(state.smoothAlt, spd, lat, lon, now);
    pushProfile(now, state.smoothAlt);
  }
  paintReadouts();
}

function render(pos, nowOverride) {
  const c = pos.coords;
  applyFix(c.altitude, c.speed, c.latitude, c.longitude, nowOverride || Date.now());
  if (state.mode !== "sim") {
    const acc = c.accuracy;
    if (acc != null && acc <= 12) setStatus("live", "GPS lock");
    else if (acc != null && acc <= 40) setStatus("live", "GPS \u00b1" + Math.round(acc) + " m");
    else if (acc != null) setStatus("wait", "GPS \u00b1" + Math.round(acc) + " m");
    else setStatus("live", "GPS live");
    if (c.latitude != null) fetchTerrain(c.latitude, c.longitude);
  }
}

function drawIncline() {
  state.drawGrade += (state.grade - state.drawGrade) * 0.16;
  const wedge = $("inclineWedge");
  const bar = $("inclineBar");
  if (!wedge || !bar) return;
  const w = 800, cy = 55, cx = w / 2;
  const clamped = Math.max(-18, Math.min(18, state.drawGrade));
  const vis = Math.atan(clamped / 100) * 180 / Math.PI;
  const rad = (-vis * Math.PI) / 180;
  const barW = w * 0.78;
  const hx = (barW / 2) * Math.cos(rad), hy = (barW / 2) * Math.sin(rad);
  const fillA = Math.min(0.42, 0.08 + Math.abs(clamped) / 32);
  const deg = rad * 180 / Math.PI;
  wedge.setAttribute("points",
    (cx - hx) + "," + (cy - hy) + " " + (cx + hx) + "," + (cy + hy) + " " + (cx + hx) + "," + cy + " " + (cx - hx) + "," + cy);
  wedge.setAttribute("fill", "rgba(62,106,225," + fillA + ")");
  bar.setAttribute("transform", "translate(" + cx + " " + cy + ") rotate(" + deg + ")");
}

function gradeSegments(pts) {
  const segs = [];
  if (pts.length < 3) return segs;
  let i0 = 0, sign = 0;
  function stepGrade(i) {
    const a = pts[Math.max(0, i - 2)];
    const run = pts[i].dist - a.dist;
    if (run < 3) return 0;
    return ((pts[i].alt - a.alt) / run) * 100;
  }
  function emit(from, to) {
    if (to - from < 2) return;
    const run = pts[to].dist - pts[from].dist, rise = pts[to].alt - pts[from].alt;
    if (run < 50 || Math.abs(rise) < 6) return;
    const grade = (rise / run) * 100;
    if (Math.abs(grade) < 2) return;
    let peak = grade;
    for (let i = from + 1; i <= to; i++) {
      const g = stepGrade(i);
      if (Math.abs(g) > Math.abs(peak)) peak = g;
    }
    segs.push({ i0: from, i1: to, grade: grade, peak: peak });
  }
  for (let i = 1; i < pts.length; i++) {
    const run = pts[i].dist - pts[i - 1].dist, rise = pts[i].alt - pts[i - 1].alt;
    const g = run > 1 ? (rise / run) * 100 : 0;
    const s = g > 2 ? 1 : g < -2 ? -1 : 0;
    if (sign === 0) { sign = s; i0 = i - 1; continue; }
    if (s !== 0 && s !== sign) { emit(i0, i - 1); i0 = i - 1; sign = s; }
  }
  emit(i0, pts.length - 1);
  return segs;
}

function drawProfile() {
  const lineEl = $("profileLine");
  const fillEl = $("profileFill");
  const dotEl = $("profileDot");
  const hint = $("profileHint");
  if (!lineEl || !fillEl || !dotEl) return;
  const w = 1000, padL = 70, padR = 20, padT = 16, padB = 32;
  const iw = w - padL - padR, ih = 220 - padT - padB;
  const pts = state.profile.slice();
  if (pts.length === 1) {
    pts.push({ t: pts[0].t + 1000, alt: pts[0].alt, dist: pts[0].dist + 1 });
  }

  if (!pts.length) {
    lineEl.setAttribute("d", "");
    fillEl.setAttribute("d", "");
    dotEl.setAttribute("cx", "-20");
    if (hint) hint.textContent = "Drive or tap Sim";
    $("profileX0").textContent = fmtDist(0);
    $("profileX1").textContent = fmtDist(0);
    $("profileX2").textContent = fmtDist(0);
    $("profileRange").textContent = fmtDist(0);
    return;
  }
  if (hint) hint.textContent = "";

  const alts = pts.map(function (p) { return toDisp(p.alt); });
  let min = Math.min.apply(null, alts), max = Math.max.apply(null, alts);
  const rawSpan = max - min;
  if (rawSpan < 8) { const mid = (max + min) / 2; min = mid - 4; max = mid + 4; }
  const span = max - min || 1;
  let d0 = pts[0].dist, d1 = pts[pts.length - 1].dist;
  let dspan = Math.max(d1 - d0, 0);

  // If odo stayed at 0 (cached Tesla fixes), rebuild distance from stored lat/lon.
  if (dspan < 15) {
    let acc = 0, prev = null;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (prev && p.lat != null && p.lon != null && prev.lat != null) {
        const step = distM({ lat: prev.lat, lon: prev.lon }, { lat: p.lat, lon: p.lon });
        if (Number.isFinite(step) && step >= 1.5 && step < 8000) acc += step;
      }
      p.dist = acc;
      if (p.lat != null && p.lon != null) prev = p;
    }
    d0 = 0;
    d1 = acc;
    dspan = acc;
    if (acc > state.odo) state.odo = acc;
  }
  const collapsed = dspan < 15;

  function xy(p, i) {
    const x = collapsed
      ? padL + (i / Math.max(pts.length - 1, 1)) * iw
      : padL + ((p.dist - d0) / Math.max(dspan, 1)) * iw;
    const y = padT + (1 - (toDisp(p.alt) - min) / span) * ih;
    return [x, y];
  }

  let line = "";
  for (let i = 0; i < pts.length; i++) {
    const pt = xy(pts[i], i);
    line += (i ? " L" : "M") + pt[0].toFixed(1) + " " + pt[1].toFixed(1);
  }
  const last = xy(pts[pts.length - 1], pts.length - 1);
  let area = line;
  for (let i = pts.length - 1; i >= 0; i--) {
    const pt = xy(pts[i], i);
    area += " L" + pt[0].toFixed(1) + " " + Math.min(padT + ih, pt[1] + 16).toFixed(1);
  }
  area += " Z";
  fillEl.setAttribute("d", area);
  lineEl.setAttribute("d", line);
  dotEl.setAttribute("cx", last[0].toFixed(1));
  dotEl.setAttribute("cy", last[1].toFixed(1));

  $("profileMax").textContent = Math.round(max) + " " + state.unit;
  $("profileMin").textContent = Math.round(min) + " " + state.unit;
  $("profileX0").textContent = fmtDist(0);
  $("profileX1").textContent = fmtDist(dspan / 2);
  $("profileX2").textContent = fmtDist(dspan);
  const heightTxt = Math.round(Math.max(rawSpan, 0)) + " " + state.unit;
  $("profileRange").textContent = heightTxt + " \u00b7 " + fmtDist(Math.max(dspan, state.odo));

  const labels = $("profileLabels");
  if (labels) {
    while (labels.firstChild) labels.removeChild(labels.firstChild);
    const segs = gradeSegments(pts);
    let lastLabelX = -999;
    const NS = "http://www.w3.org/2000/svg";
    for (let si = 0; si < segs.length; si++) {
      const s = segs[si];
      const mi = Math.round((s.i0 + s.i1) / 2);
      const mid = pts[mi];
      const pt = xy(mid, mi);
      if (Math.abs(pt[0] - lastLabelX) < 90) continue;
      lastLabelX = pt[0];
      const ly = Math.min(padT + ih - 14, Math.max(padT + 14, pt[1] + (s.grade >= 0 ? -16 : 16)));
      const tx = document.createElementNS(NS, "text");
      tx.setAttribute("x", pt[0].toFixed(1));
      tx.setAttribute("y", ly.toFixed(1));
      tx.setAttribute("fill", "#fff");
      tx.setAttribute("font-size", "13");
      tx.setAttribute("text-anchor", "middle");
      tx.textContent = fmtGrade(s.grade) + " (" + fmtGrade(s.peak) + ")";
      labels.appendChild(tx);
    }
  }
}

function createSim() { return { elapsed: 0, alt: 542, lat: 46.561, lon: 8.336 }; }
function stepSim(sim, dt) {
  sim.elapsed += dt;
  let t = sim.elapsed % CYCLE, seg = SEGMENTS[0];
  for (let i = 0; i < SEGMENTS.length; i++) {
    if (t < SEGMENTS[i].dt) { seg = SEGMENTS[i]; break; }
    t -= SEGMENTS[i].dt;
  }
  const speed = seg.speedKmh / 3.6;
  sim.alt += speed * (seg.grade / 100) * dt;
  sim.lat += (speed * dt) / 111320;
  return { alt: sim.alt, speed: speed, lat: sim.lat, lon: sim.lon };
}
function startSim() {
  state.sim = createSim();
  state.terrain = 536;
  setStatus("live", "Simulating");
  const seed0 = Date.now() - 35000;
  for (let i = 0; i < 35; i++) {
    const fix = stepSim(state.sim, 1);
    applyFix(fix.alt, fix.speed, fix.lat, fix.lon, seed0 + i * 1000);
  }
  drawIncline(); drawProfile();
  state.simId = setInterval(function () {
    if (!state.sim) return;
    const fix = stepSim(state.sim, 1);
    applyFix(fix.alt, fix.speed, fix.lat, fix.lon, Date.now());
    drawIncline(); drawProfile();
  }, 1000);
}
function stopSim() {
  if (state.simId) { clearInterval(state.simId); state.simId = null; }
  state.sim = null;
}

function showGate(title, text) { $("gateTitle").textContent = title; $("gateText").textContent = text; $("gate").classList.add("show"); }
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
  if (state.watchId != null) { navigator.geolocation.clearWatch(state.watchId); state.watchId = null; }
  if (state.pollId) { clearInterval(state.pollId); state.pollId = null; }
}
function startWatch() {
  if (state.starting) return;
  state.starting = true;
  setTimeout(function () { state.starting = false; }, 1500);
  if (!window.isSecureContext) { setStatus("off", "Needs HTTPS"); showGate("Needs HTTPS", "Open the Render URL (https)."); return; }
  if (!navigator.geolocation) { setStatus("off", "No geolocation"); showGate("No geolocation", "This browser does not expose GPS."); return; }
  stopGps();
  $("gate").classList.remove("show");
  setStatus("wait", "Acquiring GPS");
  const opts = { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 };
  navigator.geolocation.getCurrentPosition(function (pos) { state.lastPos = pos; render(pos); drawIncline(); drawProfile(); }, onError, opts);
  state.watchId = navigator.geolocation.watchPosition(function (pos) { state.lastPos = pos; render(pos); }, onError, opts);
  state.pollId = setInterval(function () {
    navigator.geolocation.getCurrentPosition(function (pos) { state.lastPos = pos; render(pos); }, function () {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 8000 });
  }, 1000);
}

function loop() { drawIncline(); drawProfile(); requestAnimationFrame(loop); }

$("btnM").addEventListener("click", function () { setUnit("m"); });
$("btnFt").addEventListener("click", function () { setUnit("ft"); });
$("btnSim").addEventListener("click", function () { setMode("sim"); });
$("btnGps").addEventListener("click", function () { setMode("gps"); });
$("askLoc").addEventListener("click", function (e) { e.preventDefault(); startWatch(); });
$("askLoc").addEventListener("touchend", function (e) { e.preventDefault(); startWatch(); }, { passive: false });

setUnit(state.unit);
drawIncline();
drawProfile();
loop();
state.tickId = setInterval(function () {
  if (state.mode === "gps" && state.smoothAlt != null) pushProfile(Date.now(), state.smoothAlt);
  drawIncline();
  drawProfile();
}, 1000);

if (isTesla) startWatch();
else {
  setStatus("wait", "Tap to enable GPS");
  showGate("Enable location", isAppleTouch
    ? "On iPhone, Safari only asks for GPS after a tap. Tap the button, then Allow \u2014 or use Sim."
    : "Tap to allow GPS, or switch to Sim to preview the dashboards.");
}

document.addEventListener("visibilitychange", function () {
  if (document.visibilityState === "visible" && isTesla && state.mode === "gps") startWatch();
});
