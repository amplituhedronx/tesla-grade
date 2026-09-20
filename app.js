const $ = (id) => document.getElementById(id);
const EL_DB = 5;

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
  watchId: null, pollId: null, simId: null,
  lastClimbSample: 0, lastGoodGradeT: 0, lastFixT: 0,
  profile: [], climbLog: [],
  smoothAlt: null, vs: 0, grade: 0, vsReady: false, speed: 0, odo: 0,
  gain: 0, loss: 0, lastAltForEl: null,
  lastElevFetch: 0, lastElevAt: null, terrain: null,
  starting: false, drawGrade: 0, sim: null,
  lastGpsAlt: null, lastLat: null, lastLon: null, lastWatchT: 0
};

const isTesla = /Tesla/i.test(navigator.userAgent);
const isAppleTouch = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

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
  stopGps(); stopSim(); resetSession();
  $("gate").classList.remove("show");
  if (mode === "sim") startSim(); else startWatch();
}
function resetSession() {
  state.profile = []; state.climbLog = [];
  state.smoothAlt = null; state.vs = 0; state.grade = 0; state.vsReady = false;
  state.speed = 0; state.odo = 0; state.gain = 0; state.loss = 0;
  state.lastAltForEl = null; state.lastClimbSample = 0; state.lastGoodGradeT = 0;
  state.lastFixT = 0; state.drawGrade = 0; state.terrain = null;
  state.lastGpsAlt = null; state.lastLat = null; state.lastLon = null; state.lastWatchT = 0;
}
function toDisp(m) { if (m == null || Number.isNaN(m)) return null; return state.unit === "ft" ? m * 3.28084 : m; }
function fmtAlt(m) { const v = toDisp(m); return v == null ? "\u2014" : Math.round(v).toString(); }
function fmtAlt1(m) { const v = toDisp(m); return v == null ? "\u2014" : (Math.round(v * 10) / 10).toFixed(1); }
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
  if (state.unit === "ft") { const mi = m / 1609.344; if (mi < 0.1) return Math.round(m * 3.28084) + " ft"; return mi.toFixed(1) + " mi"; }
  if (m < 1000) return Math.round(m) + " m";
  return (m / 1000).toFixed(1) + " km";
}
function setStatus(kind, text) { $("dot").className = "dot " + kind; $("statusText").textContent = text; }
function distM(a, b) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lon - a.lon) * Math.PI / 180;
  const la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180;
  const h = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(la1) * Math.cos(la2) * Math.pow(Math.sin(dLon / 2), 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
function zeroClimb() { state.vs = 0; state.grade = 0; }
function accrueGain(alt) {
  if (alt == null || !Number.isFinite(alt)) return;
  if (state.lastAltForEl == null) { state.lastAltForEl = alt; return; }
  const d = alt - state.lastAltForEl;
  if (d >= EL_DB) { state.gain += d; state.lastAltForEl = alt; }
  else if (d <= -EL_DB) { state.loss += -d; state.lastAltForEl = alt; }
}
function applyGrade(raw, runM, dtSec) {
  if (!Number.isFinite(raw)) return;
  if (raw > 18) raw = 18; if (raw < -18) raw = -18;
  if (Math.abs(raw) < 0.35) {
    state.grade *= 0.7; state.vs *= 0.7;
    if (Math.abs(state.grade) < 0.3) zeroClimb();
    return;
  }
  const sameSign = state.grade === 0 || (state.grade > 0) === (raw > 0);
  const keep = sameSign ? 0.5 : 0.15;
  state.grade = state.grade * keep + raw * (1 - keep);
  if (Math.abs(state.grade) < 0.3) { zeroClimb(); return; }
  state.vsReady = true; state.lastGoodGradeT = Date.now();
  const spd = Math.max(state.speed, runM && dtSec ? runM / Math.max(dtSec, 0.8) : 0);
  state.vs = (state.grade / 100) * Math.max(spd, 1);
}
function sampleClimb() {
  const now = Date.now();
  if (now - state.lastClimbSample < 700) return;
  state.lastClimbSample = now;
  const pts = state.profile;
  if (pts.length >= 3) {
    const last = pts[pts.length - 1];
    if (last.alt != null) {
      let older = null;
      for (let i = pts.length - 2; i >= 0; i--) {
        const run = last.dist - pts[i].dist;
        if (run >= 25 && pts[i].alt != null) { older = pts[i]; if (run >= 90) break; }
      }
      if (older) {
        const run = last.dist - older.dist, rise = last.alt - older.alt;
        if (run >= 20 && Number.isFinite(rise)) { applyGrade((rise / run) * 100, run, (last.t - older.t) / 1000); return; }
      }
    }
  }
  const log = state.climbLog;
  if (log.length >= 2) {
    let older = null;
    for (let i = 0; i < log.length; i++) { if (now - log[i].t >= 3500) older = log[i]; }
    if (older) {
      const dt = (now - older.t) / 1000;
      const rise = log[log.length - 1].alt - older.alt;
      const run = Math.max(state.speed, 0.8) * dt;
      if (dt >= 2 && run >= 8 && Number.isFinite(rise)) { applyGrade((rise / run) * 100, run, dt); return; }
    }
  }
  if (state.speed >= 2 && now - state.lastGoodGradeT > 4000) {
    state.grade *= 0.65; state.vs *= 0.65;
    if (Math.abs(state.grade) < 0.3) zeroClimb();
  }
}
function pushProfile(now, dist, alt) {
  if (alt == null || !Number.isFinite(alt)) return;
  const p = state.profile;
  const row = { t: now, dist: dist, alt: alt };
  if (!p.length || now - p[p.length - 1].t >= 800 || dist - p[p.length - 1].dist >= 10) p.push(row);
  else p[p.length - 1] = row;
  if (p.length > 4000) {
    const kept = [], cut = Math.floor(p.length / 2);
    for (let i = 0; i < cut; i += 2) kept.push(p[i]);
    for (let i = cut; i < p.length; i++) kept.push(p[i]);
    state.profile = kept;
  }
}
function ingest(alt, spd, now, lat, lon) {
  const dt = state.lastFixT > 0 ? (now - state.lastFixT) / 1000 : 0;
  let speed = Number.isFinite(spd) && spd >= 0 ? spd : 0;
  if (lat != null && lon != null && state.lastLat != null && dt > 0 && dt < 10) {
    const same = Math.abs(lat - state.lastLat) < 0.0000008 && Math.abs(lon - state.lastLon) < 0.0000008;
    if (!same) {
      const step = distM({ lat: state.lastLat, lon: state.lastLon }, { lat: lat, lon: lon });
      if (step >= 0.5 && step < 250) {
        state.odo += step;
        if (speed < 0.4) speed = step / Math.max(dt, 0.4);
      }
    } else if (dt < 0.4) return;
  } else if (dt > 0 && dt < 5 && speed > 0.4) state.odo += speed * dt;
  if (lat != null) { state.lastLat = lat; state.lastLon = lon; }
  state.lastFixT = now; state.speed = speed;
  if (alt == null || !Number.isFinite(alt)) { paintReadouts(); return; }
  state.lastGpsAlt = alt;
  state.smoothAlt = state.smoothAlt == null ? alt : state.smoothAlt * 0.65 + alt * 0.35;
  accrueGain(alt);
  state.climbLog.push({ t: now, alt: state.smoothAlt, speed: speed });
  while (state.climbLog.length && now - state.climbLog[0].t > 12000) state.climbLog.shift();
  pushProfile(now, state.odo, state.smoothAlt);
  sampleClimb();
  paintReadouts();
}
function paintReadouts() {
  $("alt").textContent = fmtAlt(state.smoothAlt);
  $("gpsAlt").textContent = state.lastGpsAlt == null ? "\u2014" : fmtAlt1(state.lastGpsAlt) + " " + state.unit;
  $("terrainAlt").textContent = state.terrain == null ? "\u2014" : fmtAlt1(state.terrain) + " " + state.unit;
  $("vs").textContent = fmtVs(state.vs);
  $("grade").textContent = fmtGrade(state.grade);
  $("speed").textContent = fmtSpeed(state.speed);
  const u = state.unit;
  $("gain").textContent = "\u2191 " + Math.round(toDisp(state.gain) || 0) + " " + u;
  $("loss").textContent = "\u2193 " + Math.round(toDisp(state.loss) || 0) + " " + u;
}
async function fetchTerrain(lat, lon) {
  if (state.mode === "sim") return;
  const now = Date.now();
  if (now - state.lastElevFetch < 25000) return;
  if (state.lastElevAt && distM(state.lastElevAt, { lat: lat, lon: lon }) < 80) return;
  state.lastElevFetch = now;
  try {
    const res = await fetch("https://api.open-meteo.com/v1/elevation?latitude=" + lat + "&longitude=" + lon);
    if (!res.ok) return;
    const data = await res.json();
    const el = Array.isArray(data.elevation) ? data.elevation[0] : data.elevation;
    if (typeof el === "number") { state.terrain = el; state.lastElevAt = { lat: lat, lon: lon }; paintReadouts(); }
  } catch (_) {}
}
function fitCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const parent = canvas.parentElement;
  const r = parent ? parent.getBoundingClientRect() : { width: 0, height: 0 };
  let w = Math.round(canvas.clientWidth || r.width || 0);
  let h = Math.round(canvas.clientHeight || 0);
  if (h < 40 && parent) h = Math.max(0, Math.round(r.height - 32));
  if (!w) w = Math.max(240, Math.round((window.innerWidth || 1280) - 48));
  if (h < 40) h = canvas.id === "profileCanvas" ? 160 : 110;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx: ctx, w: w, h: h };
}
function drawIncline() {
  const gap = state.grade - state.drawGrade;
  const flip = state.grade === 0 || (state.grade > 0) !== (state.drawGrade > 0);
  state.drawGrade += gap * (flip ? 0.32 : 0.18);
  if (Math.abs(state.drawGrade) < 0.15) state.drawGrade = 0;
  const fit = fitCanvas($("inclineCanvas")); if (!fit) return;
  const ctx = fit.ctx, w = fit.w, h = fit.h;
  ctx.clearRect(0, 0, w, h);
  const cy = h * 0.5, pad = 18;
  ctx.strokeStyle = "#8e8e8e"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(pad, cy); ctx.lineTo(w - pad, cy); ctx.stroke();
  const clamped = Math.max(-18, Math.min(18, state.drawGrade));
  const vis = Math.atan(clamped / 100) * 180 / Math.PI;
  const rad = (-vis * Math.PI) / 180;
  const barW = Math.min(w * 0.84, w - 36), barH = Math.max(26, Math.min(38, h * 0.2));
  const cx = w / 2, hx = (barW / 2) * Math.cos(rad), hy = (barW / 2) * Math.sin(rad);
  ctx.beginPath();
  ctx.moveTo(cx - hx, cy - hy); ctx.lineTo(cx + hx, cy + hy); ctx.lineTo(cx + hx, cy); ctx.lineTo(cx - hx, cy);
  ctx.closePath();
  ctx.fillStyle = "rgba(62, 106, 225, " + Math.min(0.42, 0.08 + Math.abs(clamped) / 32) + ")"; ctx.fill();
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(rad);
  ctx.strokeStyle = "#3e6ae1"; ctx.lineWidth = 2.5; ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(-barW / 2, -barH / 2, barW, barH, 6);
  else ctx.rect(-barW / 2, -barH / 2, barW, barH);
  ctx.stroke(); ctx.restore();
}
function gradeSegments(pts) {
  const segs = []; if (pts.length < 3) return segs;
  let i0 = 0, sign = 0;
  const stepGrade = function (i) {
    const a = pts[Math.max(0, i - 2)]; const run = pts[i].dist - a.dist;
    if (run < 3) return 0; return ((pts[i].alt - a.alt) / run) * 100;
  };
  const emit = function (from, to) {
    if (to - from < 2) return;
    const run = pts[to].dist - pts[from].dist, rise = pts[to].alt - pts[from].alt;
    if (run < 50 || Math.abs(rise) < 6) return;
    const grade = (rise / run) * 100; if (Math.abs(grade) < 2) return;
    let peak = grade;
    for (let i = from + 1; i <= to; i++) { const g = stepGrade(i); if (Math.abs(g) > Math.abs(peak)) peak = g; }
    segs.push({ i0: from, i1: to, grade: grade, peak: peak });
  };
  for (let i = 1; i < pts.length; i++) {
    const run = pts[i].dist - pts[i - 1].dist, rise = pts[i].alt - pts[i - 1].alt;
    const g = run > 1 ? (rise / run) * 100 : 0;
    const s = g > 2 ? 1 : g < -2 ? -1 : 0;
    if (sign === 0) { sign = s; i0 = i - 1; continue; }
    if (s !== 0 && s !== sign) { emit(i0, i - 1); i0 = i - 1; sign = s; }
  }
  emit(i0, pts.length - 1); return segs;
}
function drawProfile() {
  const fit = fitCanvas($("profileCanvas")); if (!fit) return;
  const ctx = fit.ctx, w = fit.w, h = fit.h; ctx.clearRect(0, 0, w, h);
  const pts = state.profile;
  const padL = 52, padR = 18, padT = 10, padB = 28, iw = w - padL - padR, ih = h - padT - padB;
  ctx.strokeStyle = "#2c2f36"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, padT + ih); ctx.lineTo(padL + iw, padT + ih); ctx.stroke();
  if (pts.length < 2) {
    ctx.fillStyle = "#5c5e62"; ctx.font = "500 13px Inter, sans-serif"; ctx.textAlign = "center";
    ctx.fillText("Trace builds after a few GPS samples", padL + iw / 2, padT + ih / 2);
    $("profileRange").textContent = "session"; return;
  }
  const alts = pts.map(function (p) { return toDisp(p.alt); });
  let min = Math.min.apply(null, alts), max = Math.max.apply(null, alts);
  if (max - min < 8) { const mid = (max + min) / 2; min = mid - 4; max = mid + 4; }
  const span = max - min || 1, d0 = pts[0].dist, d1 = pts[pts.length - 1].dist, t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const dspan = Math.max(d1 - d0, 0), tspan = Math.max(t1 - t0, 1000), useTime = dspan < 15;
  const xy = function (p) {
    const x = useTime ? padL + ((p.t - t0) / tspan) * iw : padL + ((p.dist - d0) / Math.max(dspan, 1)) * iw;
    const y = padT + (1 - (toDisp(p.alt) - min) / span) * ih;
    return [x, y];
  };
  const last = xy(pts[pts.length - 1]);
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) { const pt = xy(pts[i]); if (i === 0) ctx.moveTo(pt[0], pt[1]); else ctx.lineTo(pt[0], pt[1]); }
  for (let i = pts.length - 1; i >= 0; i--) { const pt = xy(pts[i]); ctx.lineTo(pt[0], Math.min(padT + ih, pt[1] + 16)); }
  ctx.closePath(); ctx.fillStyle = "rgba(62, 106, 225, 0.22)"; ctx.fill();
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) { const pt = xy(pts[i]); if (i === 0) ctx.moveTo(pt[0], pt[1]); else ctx.lineTo(pt[0], pt[1]); }
  ctx.strokeStyle = "#3e6ae1"; ctx.lineWidth = 3; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.stroke();
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(last[0], last[1], 4, 0, Math.PI * 2); ctx.fill();
  const segs = gradeSegments(pts);
  ctx.font = "500 13px Inter, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  let lastLabelX = -999;
  for (let si = 0; si < segs.length; si++) {
    const s = segs[si], mid = pts[Math.round((s.i0 + s.i1) / 2)], pt = xy(mid);
    if (Math.abs(pt[0] - lastLabelX) < 88) continue;
    lastLabelX = pt[0];
    const dy = s.grade >= 0 ? -16 : 16;
    const ly = Math.min(padT + ih - 12, Math.max(padT + 12, pt[1] + dy));
    ctx.fillStyle = "#ffffff";
    ctx.fillText(fmtGrade(s.grade) + " (" + fmtGrade(s.peak) + ")", pt[0], ly);
  }
  ctx.fillStyle = "#8e8e8e"; ctx.font = "500 11px Inter, sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  ctx.fillText(Math.round(max) + " " + state.unit, padL - 8, padT + 6);
  ctx.fillText(Math.round(min) + " " + state.unit, padL - 8, padT + ih - 6);
  ctx.textBaseline = "top"; ctx.textAlign = "left";
  ctx.fillText(useTime ? "0 min" : fmtDist(0), padL, padT + ih + 6);
  ctx.textAlign = "center";
  ctx.fillText(useTime ? Math.max(1, Math.round(tspan / 60000)) + " min" : fmtDist(dspan / 2), padL + iw / 2, padT + ih + 6);
  ctx.textAlign = "right";
  ctx.fillText(useTime ? Math.max(1, Math.round(tspan / 60000)) + " min" : fmtDist(dspan), padL + iw, padT + ih + 6);
  const mins = Math.max(1, Math.round((t1 - t0) / 60000));
  $("profileRange").textContent = fmtDist(dspan) + "  \u00b7  " + mins + " min  \u00b7  " + Math.round(max - min) + " " + state.unit + " span  \u00b7  GPS";
}
function createSim() { return { t0: Date.now(), elapsed: 0, alt: 542, lat: 46.561, lon: 8.336 }; }
function stepSim(sim, dt) {
  sim.elapsed += dt; let t = sim.elapsed % CYCLE, seg = SEGMENTS[0];
  for (let i = 0; i < SEGMENTS.length; i++) { if (t < SEGMENTS[i].dt) { seg = SEGMENTS[i]; break; } t -= SEGMENTS[i].dt; }
  const speed = seg.speedKmh / 3.6;
  sim.alt += speed * (seg.grade / 100) * dt;
  sim.lat += (speed * dt) / 111320;
  return { alt: sim.alt, speed: speed, lat: sim.lat, lon: sim.lon };
}
function startSim() {
  state.sim = createSim(); state.terrain = 536; setStatus("live", "Simulating");
  for (let i = 0; i < 40; i++) {
    const fix = stepSim(state.sim, 1);
    ingest(fix.alt, fix.speed, Date.now() - (40 - i) * 1000, fix.lat, fix.lon);
  }
  state.simId = setInterval(function () {
    if (!state.sim) return;
    const fix = stepSim(state.sim, 1);
    ingest(fix.alt, fix.speed, Date.now(), fix.lat, fix.lon);
  }, 1000);
}
function stopSim() { if (state.simId) { clearInterval(state.simId); state.simId = null; } state.sim = null; }
function renderGps(pos) {
  const c = pos.coords;
  const spd = c.speed != null && Number.isFinite(c.speed) ? c.speed : 0;
  state.lastWatchT = Date.now();
  ingest(c.altitude, spd, Date.now(), c.latitude, c.longitude);
  const acc = c.accuracy;
  if (acc != null && acc <= 12) setStatus("live", "GPS lock");
  else if (acc != null && acc <= 40) setStatus("live", "GPS \u00b1" + Math.round(acc) + " m");
  else if (acc != null) setStatus("wait", "GPS \u00b1" + Math.round(acc) + " m");
  else setStatus("live", "GPS live");
  if (c.latitude != null) fetchTerrain(c.latitude, c.longitude);
}
function showGate(title, text) { $("gateTitle").textContent = title; $("gateText").textContent = text; $("gate").classList.add("show"); }
function onError(err) {
  const code = err && err.code;
  if (code === 1) {
    setStatus("off", "Location blocked");
    showGate("Location blocked", isAppleTouch ? "Settings \u2192 Safari \u2192 Location \u2192 Ask or Allow, then reload and tap Enable location." : "Allow location in site settings, then tap Enable location.");
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
  stopGps(); $("gate").classList.remove("show"); setStatus("wait", "Acquiring GPS");
  const opts = { enableHighAccuracy: true, maximumAge: 800, timeout: 20000 };
  navigator.geolocation.getCurrentPosition(function (pos) { renderGps(pos); }, onError, opts);
  state.watchId = navigator.geolocation.watchPosition(function (pos) { renderGps(pos); }, onError, opts);
  state.pollId = setInterval(function () {
    if (Date.now() - state.lastWatchT < 2200) return;
    navigator.geolocation.getCurrentPosition(function (pos) { renderGps(pos); }, function () {}, { enableHighAccuracy: true, maximumAge: 1000, timeout: 8000 });
  }, 2500);
}
function loop() { drawIncline(); drawProfile(); requestAnimationFrame(loop); }
$("btnM").addEventListener("click", function () { setUnit("m"); });
$("btnFt").addEventListener("click", function () { setUnit("ft"); });
$("btnSim").addEventListener("click", function () { setMode("sim"); });
$("btnGps").addEventListener("click", function () { setMode("gps"); });
$("askLoc").addEventListener("click", function (e) { e.preventDefault(); startWatch(); });
setUnit(state.unit); loop();
if (isTesla) startWatch();
else {
  setStatus("wait", "Tap to enable GPS");
  showGate("Enable location", isAppleTouch ? "On iPhone, Safari only asks for GPS after a tap. Tap the button, then Allow \u2014 or use Sim." : "Tap to allow GPS, or switch to Sim to preview the dashboards.");
}
document.addEventListener("visibilitychange", function () {
  if (document.visibilityState === "visible" && isTesla && state.mode === "gps") startWatch();
});
window.addEventListener("resize", function () { drawIncline(); drawProfile(); });
