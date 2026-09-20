const $ = (id) => document.getElementById(id);
const CLIMB_WINDOW_MS = 3000;
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
  lastPos: null, lastAlt: null, lastClimbSample: 0, lastFixT: 0, lastMoveT: 0, lastTrackT: 0,
  climbLog: [], profile: [],
  smoothAlt: null, vs: 0, grade: 0, vsReady: false,
  speed: 0, odo: 0, gain: 0, loss: 0, lastAltForEl: null,
  lastElevFetch: 0, lastElevAt: null, terrain: null,
  starting: false, drawGrade: 0, sim: null, lastLat: null, lastLon: null,
  heading: null, trackAlt: null, ahead: [], gpsAltHist: [], gpsStuck: false,
  terrainGrade: null
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
  state.lastTrackT = 0;
  state.lastPos = null; state.lastAlt = null; state.drawGrade = 0;
  state.terrain = null; state.lastLat = null; state.lastLon = null;
  state.heading = null; state.trackAlt = null; state.ahead = [];
  state.gpsAltHist = []; state.gpsStuck = false; state.terrainGrade = null;
  paintReadouts(); drawIncline(); drawProfile();
}
function toDisp(m) { if (m == null || Number.isNaN(m)) return null; return state.unit === "ft" ? m * 3.28084 : m; }
function fmtAlt(m) {
  const v = toDisp(m);
  if (v == null) return "\u2014";
  return Math.abs(v) >= 1000 ? v.toFixed(1) : (Math.round(v * 10) / 10).toFixed(1);
}
function fmtAlt2(m) {
  const v = toDisp(m);
  return v == null ? "\u2014" : v.toFixed(2);
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
function setStatus(kind, text) { $("dot").className = "dot " + kind; $("statusText").textContent = text; }
function distM(a, b) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lon - a.lon) * Math.PI / 180;
  const la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
function zeroClimb() { state.vs = 0; state.grade = 0; }
function bearingDeg(a, b) {
  const p1 = a.lat * Math.PI / 180, p2 = b.lat * Math.PI / 180;
  const dL = (b.lon - a.lon) * Math.PI / 180;
  const y = Math.sin(dL) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dL);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function destPoint(lat, lon, headingDeg, meters) {
  const R = 6371000, br = headingDeg * Math.PI / 180, d = meters / R;
  const p1 = lat * Math.PI / 180, l1 = lon * Math.PI / 180;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(br));
  const l2 = l1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 * 180 / Math.PI, lon: l2 * 180 / Math.PI };
}

function sampleClimb(smoothAlt, speed, lat, lon, now) {
  now = now || Date.now();
  if (smoothAlt == null || !Number.isFinite(smoothAlt)) return;
  state.vsReady = true;
  if (now - state.lastClimbSample < 600) return;
  state.lastClimbSample = now;
  const spd = speed == null || !Number.isFinite(speed) ? 0 : speed;
  const log = state.climbLog;
  log.push({ t: now, alt: smoothAlt, speed: spd, lat: lat, lon: lon });
  while (log.length && now - log[0].t > 10000) log.shift();

  if (state.terrainGrade != null && Number.isFinite(state.terrainGrade) && (state.gpsStuck || spd >= 0.8)) {
    if (!log.length || now - log[0].t < CLIMB_WINDOW_MS) {
      state.grade = state.grade * 0.45 + state.terrainGrade * 0.55;
      state.vs = (state.grade / 100) * Math.max(spd, 0);
      return;
    }
  }

  let older = null;
  for (let i = 0; i < log.length; i++) if (now - log[i].t >= CLIMB_WINDOW_MS) older = log[i];
  if (!older) {
    if (state.terrainGrade != null && spd >= 0.8) {
      state.grade = state.grade * 0.45 + state.terrainGrade * 0.55;
      state.vs = (state.grade / 100) * spd;
    }
    return;
  }
  const last = log[log.length - 1];
  const dt = (now - older.t) / 1000;
  if (dt < 1.2) return;
  const rise = smoothAlt - older.alt;
  let run = 0;
  if (older.lat != null && last.lat != null) run = distM({ lat: older.lat, lon: older.lon }, { lat: last.lat, lon: last.lon });
  if (run < 8) {
    const avgSpeed = log.reduce((s, p) => s + p.speed, 0) / log.length;
    run = Math.max(avgSpeed, spd) * dt;
  }

  let rawGrade = null;
  if (state.gpsStuck && state.terrainGrade != null) rawGrade = state.terrainGrade;
  else if (spd >= 1 && Number.isFinite(rise)) rawGrade = (rise / dt) / spd * 100;
  else if (Number.isFinite(rise) && run >= 6) rawGrade = (rise / run) * 100;
  else if (state.terrainGrade != null && spd >= 0.8) rawGrade = state.terrainGrade;

  if (rawGrade == null || !Number.isFinite(rawGrade)) {
    if (spd < 0.8 && state.terrainGrade == null) zeroClimb();
    return;
  }
  if (Math.abs(rawGrade) > 35) rawGrade = rawGrade > 0 ? 35 : -35;
  state.grade = state.grade * 0.4 + rawGrade * 0.6;
  if (Math.abs(state.grade) < 0.25 && (state.terrainGrade == null || Math.abs(state.terrainGrade) < 0.25)) {
    zeroClimb();
    return;
  }
  state.vs = spd >= 0.8 ? (state.grade / 100) * spd : (state.grade / 100) * (run / Math.max(dt, 0.5));
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

  if (spd >= 0.5 && dtSpeed >= 0.25 && dtSpeed <= 8) {
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
