const $ = (id) => document.getElementById(id);
const CLIMB_WINDOW_MS = 4000;

const SEGMENTS = [
  { dt: 18, grade: 1.4, speedKmh: 78 },
  { dt: 22, grade: 6.8, speedKmh: 46 },
  { dt: 16, grade: 11.2, speedKmh: 36 },
  { dt: 14, grade: 4.6, speedKmh: 44 },
  { dt: 10, grade: 0.5, speedKmh: 52 },
  { dt: 20, grade: -8.4, speedKmh: 58 },
  { dt: 14, grade: -3.1, speedKmh: 72 },
];
const CYCLE = SEGMENTS.reduce((s, x) => s + x.dt, 0);

const state = {
  unit: localStorage.getItem("grade-unit") || "m",
  mode: "gps",
  watchId: null,
  pollId: null,
  simId: null,
  lastPos: null,
  lastClimbSample: 0,
  lastFixT: 0,
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
  lastElevFetch: 0,
  lastElevAt: null,
  terrain: null,
  starting: false,
  drawGrade: 0,
  sim: null,
  lastGpsAlt: null,
};

const isTesla = /Tesla/i.test(navigator.userAgent);
const isAppleTouch =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function setUnit(u) {
  state.unit = u;
  localStorage.setItem("grade-unit", u);
  $("btnM").classList.toggle("on", u === "m");
  $("btnFt").classList.toggle("on", u === "ft");
  $("altUnit").textContent = u;
  paintReadouts();
}

function setMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  $("btnSim").classList.toggle("on", mode === "sim");
  $("btnGps").classList.toggle("on", mode === "gps");
  stopGps();
  stopSim();
  resetSession();
  $("gate").classList.remove("show");
  if (mode === "sim") startSim();
  else startWatch();
}

function resetSession() {
  state.climbLog = [];
  state.profile = [];
  state.smoothAlt = null;
  state.vs = 0;
  state.grade = 0;
  state.vsReady = false;
  state.speed = 0;
  state.odo = 0;
  state.gain = 0;
  state.loss = 0;
  state.lastAltForEl = null;
  state.lastClimbSample = 0;
  state.lastFixT = 0;
  state.lastPos = null;
  state.drawGrade = 0;
  state.terrain = null;
  state.lastGpsAlt = null;
}

function toDisp(m) {
  if (m == null || Number.isNaN(m)) return null;
  return state.unit === "ft" ? m * 3.28084 : m;
}
function fmtAlt(m) {
  const v = toDisp(m);
  return v == null ? "\u2014" : Math.round(v).toString();
}
function fmtAlt1(m) {
  const v = toDisp(m);
  return v == null ? "\u2014" : (Math.round(v * 10) / 10).toFixed(1);
}
function fmtVs(mps) {
  if (!state.vsReady || mps == null || !Number.isFinite(mps)) return "0 " + state.unit + "/min";
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
  if (!Number.isFinite(m) || m < 0) return state.unit === "ft" ? "0 mi" : "0 km";
  if (state.unit === "ft") {
    const mi = m / 1609.344;
    if (mi < 0.1) return Math.round(m * 3.28084) + " ft";
    return mi.toFixed(1) + " mi";
  }
  if (m < 1000) return Math.round(m) + " m";
  return (m / 1000).toFixed(1) + " km";
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
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function zeroClimb() {
  state.vs = 0;
  state.grade = 0;
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
  if (avgSpeed < 1.2) { zeroClimb(); return; }
  let older = null;
  for (const p of log) { if (now - p.t >= CLIMB_WINDOW_MS) older = p; }
  if (!older) return;
  const dt = (now - older.t) / 1000;
  if (dt < 2) return;
  const rise = smoothAlt - older.alt;
  const run = avgSpeed * dt;
  if (!Number.isFinite(rise) || run < 8) { zeroClimb(); return; }
  const rawGrade = (rise / run) * 100;
  if (!Number.isFinite(rawGrade)) return;
  if (Math.abs(rawGrade) < 0.3) { zeroClimb(); return; }
  state.grade = state.grade * 0.65 + rawGrade * 0.35;
  if (Math.abs(state.grade) < 0.3) { zeroClimb(); return; }
  state.vs = (state.grade / 100) * Math.max(avgSpeed, 1.2);
}

function pushProfile(alt, now, dist) {
  const p = state.profile;
  if (!p.length || now - p[p.length - 1].t >= 1000) p.push({ t: now, alt, dist });
  else p[p.length - 1] = { t: now, alt, dist };
  if (p.length > 4000) {
    const kept = [];
    const cut = Math.floor(p.length / 2);
    for (let i = 0; i < cut; i += 2) kept.push(p[i]);
    for (let i = cut; i < p.length; i++) kept.push(p[i]);
    state.profile = kept;
  }
}

function ingest(alt, spd, now) {
  if (alt == null || !Number.isFinite(alt)) return;
  state.speed = Number.isFinite(spd) ? spd : 0;
  if (state.lastFixT > 0) {
    const dt = (now - state.lastFixT) / 1000;
    if (dt > 0 && dt < 5 && state.speed > 0) state.odo += state.speed * dt;
  }
  state.lastFixT = now;
  if (state.smoothAlt == null) state.smoothAlt = alt;
  else state.smoothAlt = state.smoothAlt * 0.72 + alt * 0.28;
  if (state.lastAltForEl != null) {
    const dEl = state.smoothAlt - state.lastAltForEl;
    if (dEl > 0.4) state.gain += dEl;
    else if (dEl < -0.4) state.loss += -dEl;
  }
  state.lastAltForEl = state.smoothAlt;
  sampleClimb(state.smoothAlt, state.speed);
  pushProfile(state.smoothAlt, now, state.odo);
  paintReadouts();
}

function paintReadouts() {
  $("alt").textContent = fmtAlt(state.smoothAlt);
  const gpsSrc = state.lastGpsAlt != null ? state.lastGpsAlt : state.smoothAlt;
  $("gpsAlt").textContent = gpsSrc == null ? "\u2014" : fmtAlt1(gpsSrc) + " " + state.unit;
  $("terrainAlt").textContent = state.terrain == null ? "\u2014" : fmtAlt1(state.terrain) + " " + state.unit;
  $("vs").textContent = fmtVs(state.vs);
  $("grade").textContent = fmtGrade(state.grade);
  $("speed").textContent = fmtSpeed(state.speed);
  const u = state.unit;
  $("gain").textContent = "\u2191 " + Math.round(toDisp(state.gain) || 0) + " " + u;
  $("loss").textContent = "\u2193 " + Math.round(toDisp(state.loss) || 0) + " " + u;
}

async function fetchTerrain(lat, lon) {
  const now = Date.now();
  if (now - state.lastElevFetch < 20000) return;
  if (state.lastElevAt && distM(state.lastElevAt, { lat, lon }) < 40) return;
  state.lastElevFetch = now;
  try {
    const url = "https://api.open-meteo.com/v1/elevation?latitude=" + lat + "&longitude=" + lon;
    const res = await fetch(url);
    if (!res.ok) throw new Error("elev");
    const data = await res.json();
    const el = Array.isArray(data.elevation) ? data.elevation[0] : data.elevation;
    if (typeof el === "number") {
      state.terrain = el;
      state.lastElevAt = { lat, lon };
      $("terrainAlt").textContent = fmtAlt1(el) + " " + state.unit;
    }
  } catch (_) {}
}

function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return null;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function drawIncline() {
  state.drawGrade += (state.grade - state.drawGrade) * 0.16;
  const canvas = $("inclineCanvas");
  const fit = fitCanvas(canvas);
  if (!fit) return;
  const { ctx, w, h } = fit;
  ctx.clearRect(0, 0, w, h);
  const cy = h * 0.5;
  const pad = 18;
  ctx.strokeStyle = "#8e8e8e";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pad, cy);
  ctx.lineTo(w - pad, cy);
  ctx.stroke();
  const clamped = Math.max(-18, Math.min(18, state.drawGrade));
  const vis = Math.atan(clamped / 100) * 180 / Math.PI;
  const rad = (-vis * Math.PI) / 180;
  const barW = Math.min(w * 0.84, w - 36);
  const barH = Math.max(26, Math.min(38, h * 0.2));
  const cx = w / 2;
  const hx = (barW / 2) * Math.cos(rad);
  const hy = (barW / 2) * Math.sin(rad);
  const alpha = Math.min(0.42, 0.08 + Math.abs(clamped) / 32);
  ctx.beginPath();
  ctx.moveTo(cx - hx, cy - hy);
  ctx.lineTo(cx + hx, cy + hy);
  ctx.lineTo(cx + hx, cy);
  ctx.lineTo(cx - hx, cy);
  ctx.closePath();
  ctx.fillStyle = "rgba(62, 106, 225, " + alpha + ")";
  ctx.fill();
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rad);
  ctx.strokeStyle = "#3e6ae1";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(-barW / 2, -barH / 2, barW, barH, 6);
  else ctx.rect(-barW / 2, -barH / 2, barW, barH);
  ctx.stroke();
  ctx.restore();
}

function gradeSegments(pts) {
  const segs = [];
  if (pts.length < 3) return segs;
  let i0 = 0;
  let sign = 0;
  const stepGrade = (i) => {
    const a = pts[Math.max(0, i - 2)];
    const run = pts[i].dist - a.dist;
    if (run < 3) return 0;
    return ((pts[i].alt - a.alt) / run) * 100;
  };
  const emit = (from, to) => {
    if (to - from < 2) return;
    const run = pts[to].dist - pts[from].dist;
    const rise = pts[to].alt - pts[from].alt;
    if (run < 50 || Math.abs(rise) < 6) return;
    const grade = (rise / run) * 100;
    if (Math.abs(grade) < 2) return;
    let peak = grade;
    for (let i = from + 1; i <= to; i++) {
      const g = stepGrade(i);
      if (Math.abs(g) > Math.abs(peak)) peak = g;
    }
    segs.push({ i0: from, i1: to, grade, peak });
  };
  for (let i = 1; i < pts.length; i++) {
    const run = pts[i].dist - pts[i - 1].dist;
    const rise = pts[i].alt - pts[i - 1].alt;
    const g = run > 1 ? (rise / run) * 100 : 0;
    const s = g > 2 ? 1 : g < -2 ? -1 : 0;
    if (sign === 0) { sign = s; i0 = i - 1; continue; }
    if (s !== 0 && s !== sign) { emit(i0, i - 1); i0 = i - 1; sign = s; }
  }
  emit(i0, pts.length - 1);
  return segs;
}

function drawProfile() {
  const canvas = $("profileCanvas");
  const fit = fitCanvas(canvas);
  if (!fit) return;
  const { ctx, w, h } = fit;
  ctx.clearRect(0, 0, w, h);
  const pts = state.profile;
  const padL = 52, padR = 18, padT = 10, padB = 28;
  const iw = w - padL - padR;
  const ih = h - padT - padB;
  ctx.strokeStyle = "#2c2f36";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT + ih);
  ctx.lineTo(padL + iw, padT + ih);
  ctx.stroke();
  if (pts.length < 2) {
    ctx.fillStyle = "#5c5e62";
    ctx.font = "500 13px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Trace builds after a few samples", padL + iw / 2, padT + ih / 2);
    return;
  }
  const alts = pts.map((p) => toDisp(p.alt));
  let min = Math.min.apply(null, alts);
  let max = Math.max.apply(null, alts);
  if (max - min < 8) { const mid = (max + min) / 2; min = mid - 4; max = mid + 4; }
  const span = max - min || 1;
  const d0 = pts[0].dist;
  const d1 = pts[pts.length - 1].dist;
  const dspan = Math.max(d1 - d0, 1);
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const xy = (p) => {
    const x = padL + ((p.dist - d0) / dspan) * iw;
    const y = padT + (1 - (toDisp(p.alt) - min) / span) * ih;
    return [x, y];
  };
  const last = xy(pts[pts.length - 1]);
  ctx.beginPath();
  pts.forEach((p, i) => { const pt = xy(p); if (i === 0) ctx.moveTo(pt[0], pt[1]); else ctx.lineTo(pt[0], pt[1]); });
  for (let i = pts.length - 1; i >= 0; i--) { const pt = xy(pts[i]); ctx.lineTo(pt[0], Math.min(padT + ih, pt[1] + 16)); }
  ctx.closePath();
  ctx.fillStyle = "rgba(62, 106, 225, 0.22)";
  ctx.fill();
  ctx.beginPath();
  pts.forEach((p, i) => { const pt = xy(p); if (i === 0) ctx.moveTo(pt[0], pt[1]); else ctx.lineTo(pt[0], pt[1]); });
  ctx.strokeStyle = "#3e6ae1";
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(last[0], last[1], 4, 0, Math.PI * 2);
  ctx.fill();
  const segs = gradeSegments(pts);
  ctx.font = "500 13px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let lastLabelX = -999;
  for (let si = 0; si < segs.length; si++) {
    const s = segs[si];
    const mid = pts[Math.round((s.i0 + s.i1) / 2)];
    const pt = xy(mid);
    if (Math.abs(pt[0] - lastLabelX) < 88) continue;
    lastLabelX = pt[0];
    const dy = s.grade >= 0 ? -16 : 16;
    const ly = Math.min(padT + ih - 12, Math.max(padT + 12, pt[1] + dy));
    ctx.fillStyle = "#ffffff";
    ctx.fillText(fmtGrade(s.grade) + " (" + fmtGrade(s.peak) + ")", pt[0], ly);
  }
  ctx.fillStyle = "#8e8e8e";
  ctx.font = "500 11px Inter, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(Math.round(max) + " " + state.unit, padL - 8, padT + 6);
  ctx.fillText(Math.round(min) + " " + state.unit, padL - 8, padT + ih - 6);
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillText(fmtDist(0), padL, padT + ih + 6);
  ctx.textAlign = "center";
  ctx.fillText(fmtDist(dspan / 2), padL + iw / 2, padT + ih + 6);
  ctx.textAlign = "right";
  ctx.fillText(fmtDist(dspan), padL + iw, padT + ih + 6);
  const mins = Math.max(1, Math.round((t1 - t0) / 60000));
  $("profileRange").textContent = fmtDist(dspan) + "  \u00b7  " + mins + " min  \u00b7  " + Math.round(max - min) + " " + state.unit + " span";
}

function createSim() { return { t0: Date.now(), elapsed: 0, alt: 542 }; }
function stepSim(sim, dt) {
  sim.elapsed += dt;
  let t = sim.elapsed % CYCLE;
  let seg = SEGMENTS[0];
  for (let i = 0; i < SEGMENTS.length; i++) {
    const s = SEGMENTS[i];
    if (t < s.dt) { seg = s; break; }
    t -= s.dt;
  }
  const speed = seg.speedKmh / 3.6;
  sim.alt += speed * (seg.grade / 100) * dt;
  return { alt: sim.alt, speed };
}
function startSim() {
  state.sim = createSim();
  state.terrain = 536;
  setStatus("live", "Simulating");
  const warmup = 40;
  for (let i = 0; i < warmup; i++) {
    const fix = stepSim(state.sim, 1);
    state.lastGpsAlt = fix.alt;
    ingest(fix.alt, fix.speed, Date.now() - (warmup - i) * 1000);
  }
  state.simId = setInterval(function () {
    if (!state.sim) return;
    const fix = stepSim(state.sim, 1);
    state.lastGpsAlt = fix.alt;
    ingest(fix.alt, fix.speed, Date.now());
  }, 1000);
}
function stopSim() {
  if (state.simId) { clearInterval(state.simId); state.simId = null; }
  state.sim = null;
}
function renderGps(pos) {
  const c = pos.coords;
  const gpsAlt = c.altitude;
  state.lastGpsAlt = gpsAlt;
  const spd = c.speed != null && Number.isFinite(c.speed) ? c.speed : 0;
  ingest(gpsAlt, spd, Date.now());
  const acc = c.accuracy;
  if (acc != null && acc <= 12) setStatus("live", "GPS lock");
  else if (acc != null && acc <= 40) setStatus("live", "GPS \u00b1" + Math.round(acc) + " m");
  else if (acc != null) setStatus("wait", "GPS \u00b1" + Math.round(acc) + " m");
  else setStatus("live", "GPS live");
  if (c.latitude != null) fetchTerrain(c.latitude, c.longitude);
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
  navigator.geolocation.getCurrentPosition(function (pos) { state.lastPos = pos; renderGps(pos); }, onError, opts);
  state.watchId = navigator.geolocation.watchPosition(function (pos) { state.lastPos = pos; renderGps(pos); }, onError, opts);
  state.pollId = setInterval(function () {
    navigator.geolocation.getCurrentPosition(function (pos) { state.lastPos = pos; renderGps(pos); }, function () {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 8000 });
  }, 1000);
}
function loop() { drawIncline(); drawProfile(); requestAnimationFrame(loop); }
$("btnM").addEventListener("click", function () { setUnit("m"); });
$("btnFt").addEventListener("click", function () { setUnit("ft"); });
$("btnSim").addEventListener("click", function () { setMode("sim"); });
$("btnGps").addEventListener("click", function () { setMode("gps"); });
$("askLoc").addEventListener("click", function (e) { e.preventDefault(); startWatch(); });
setUnit(state.unit);
loop();
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
window.addEventListener("resize", function () { drawIncline(); drawProfile(); });
