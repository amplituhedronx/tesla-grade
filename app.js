const $ = (id) => document.getElementById(id);

const EL_DB = 3;
const MAX_VS = 6;
const MAX_GRADE = 25;

const state = {
  unit: localStorage.getItem("grade-unit") || "m",
  watchId: null,
  pollId: null,
  lastWall: 0,
  lastMoveWall: 0,
  lastAlt: null,
  lastAltTs: 0,
  lastLat: null,
  lastLon: null,
  lastElAlt: null,
  lastProfileT: 0,
  lastProfileD: 0,
  lastElevFetch: 0,
  lastElevAt: null,
  heading: null,
  profile: [],
  ahead: [],
  terrain: null,
  terrainGrade: null,
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
  if (mps == null || Number.isNaN(mps) || mps < 0.3) return "0 " + (state.unit === "ft" ? "mph" : "km/h");
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

function bearingDeg(a, b) {
  const la1 = a.lat * Math.PI / 180;
  const la2 = b.lat * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function destPoint(lat, lon, brngDeg, meters) {
  const R = 6371000;
  const brng = brngDeg * Math.PI / 180;
  const p1 = lat * Math.PI / 180;
  const l1 = lon * Math.PI / 180;
  const ang = meters / R;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(ang) + Math.cos(p1) * Math.sin(ang) * Math.cos(brng));
  const l2 = l1 + Math.atan2(
    Math.sin(brng) * Math.sin(ang) * Math.cos(p1),
    Math.cos(ang) - Math.sin(p1) * Math.sin(p2)
  );
  return { lat: p2 * 180 / Math.PI, lon: ((l2 * 180 / Math.PI + 540) % 360) - 180 };
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
  state.ahead = [];
  state.vs = null;
  state.grade = 0;
  state.drawGrade = 0;
  state.odo = 0;
  state.gain = 0;
  state.loss = 0;
  state.lastElAlt = state.smoothAlt;
  state.lastAltTs = 0;
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
  $("speed").textContent = fmtSpeed(state.speed) + "  \u00b7  " + fmtDist(state.odo);
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

function pushProfile(now, alt) {
  if (alt == null || !Number.isFinite(alt)) return;
  const row = { t: now, alt: alt, dist: state.odo };
  if (!state.profile.length) {
    state.profile.push(row);
    state.lastProfileT = now;
    state.lastProfileD = state.odo;
    return;
  }
  const moved = state.odo - state.lastProfileD;
  const age = now - state.lastProfileT;
  if (age < 700) {
    state.profile[state.profile.length - 1] = row;
    return;
  }
  if (moved < 5 && age < 2500) {
    state.profile[state.profile.length - 1] = row;
    return;
  }
  state.profile.push(row);
  state.lastProfileT = now;
  state.lastProfileD = state.odo;
  if (state.profile.length > 2500) state.profile = state.profile.slice(-1800);
}

function updateClimb(gpsAlt, speed, now) {
  if (gpsAlt == null || !Number.isFinite(gpsAlt)) return;

  if (!state.lastAltTs || state.lastAlt == null) {
    state.lastAlt = gpsAlt;
    state.lastAltTs = now;
    return;
  }

  const dt = (now - state.lastAltTs) / 1000;
  if (dt < 0.8) return;
  if (dt >= 15) {
    state.lastAlt = gpsAlt;
    state.lastAltTs = now;
    return;
  }

  let rawVs = (gpsAlt - state.lastAlt) / dt;
  if (!Number.isFinite(rawVs)) return;
  rawVs = clamp(rawVs, -MAX_VS, MAX_VS);

  state.vs = state.vs == null ? rawVs : state.vs * 0.65 + rawVs * 0.35;
  state.lastAlt = gpsAlt;
  state.lastAltTs = now;

  const spd = Number.isFinite(speed) ? speed : 0;
  let rawGrade = null;
  if (spd >= 1 && state.vs != null) {
    rawGrade = (state.vs / spd) * 100;
  }
  if ((rawGrade == null || Math.abs(rawGrade) < 0.8) && state.terrainGrade != null) {
    rawGrade = state.terrainGrade;
  }
  if (rawGrade == null) {
    if (spd < 1) {
      state.grade *= 0.88;
      if (Math.abs(state.grade) < 0.4) state.grade = 0;
    }
    return;
  }
  rawGrade = clamp(rawGrade, -MAX_GRADE, MAX_GRADE);
  state.grade = state.grade * 0.65 + rawGrade * 0.35;
}

function advanceMotion(now, lat, lon, gpsSpeed, heading) {
  const dt = state.lastWall > 0 ? (now - state.lastWall) / 1000 : 0;
  state.lastWall = now;

  let geo = 0;
  if (lat != null && lon != null && state.lastLat != null && state.lastLon != null) {
    geo = distM({ lat: state.lastLat, lon: state.lastLon }, { lat: lat, lon: lon });
    if (!Number.isFinite(geo)) geo = 0;
  }

  let speed = Number.isFinite(gpsSpeed) && gpsSpeed > 0 ? gpsSpeed : 0;
  if (speed < 0.4 && geo >= 2 && dt >= 0.4 && dt <= 15) speed = geo / dt;
  if (speed > 55) speed = 55;

  if (Number.isFinite(heading)) state.heading = heading;
  else if (geo >= 8 && state.lastLat != null) {
    state.heading = bearingDeg({ lat: state.lastLat, lon: state.lastLon }, { lat: lat, lon: lon });
  }

  const moved = geo >= 1.8;
  if (moved || speed >= 0.8) state.lastMoveWall = now;
  const recent = state.lastMoveWall > 0 && (now - state.lastMoveWall) < 8000;

  let step = 0;
  if (speed >= 0.4 && dt >= 0.25 && dt <= 12 && (moved || recent || speed >= 0.8)) {
    step = speed * dt;
  } else if (moved && geo < 300 && dt <= 12) {
    step = geo;
  }
  if (step > 90) step = 90;
  if (step >= 0.4) state.odo += step;

  if (lat != null && lon != null && Number.isFinite(lat)) {
    if (state.lastLat == null || moved || step >= 1) {
      state.lastLat = lat;
      state.lastLon = lon;
    }
  }

  state.speed = speed;
  return { speed: speed, dt: dt, geo: geo };
}

async function fetchTerrain(lat, lon, heading) {
  const now = Date.now();
  if (now - state.lastElevFetch < 12000) return;
  if (state.lastElevAt && distM(state.lastElevAt, { lat: lat, lon: lon }) < 35) return;
  state.lastElevFetch = now;

  const hdg = Number.isFinite(heading) ? heading : state.heading;
  const ranges = [0, 80, 180, 320, 500];
  const pts = Number.isFinite(hdg)
    ? ranges.map(function (d) { return d === 0 ? { lat: lat, lon: lon } : destPoint(lat, lon, hdg, d); })
    : [{ lat: lat, lon: lon }];

  try {
    const url = "https://api.open-meteo.com/v1/elevation?latitude=" +
      pts.map(function (p) { return p.lat.toFixed(5); }).join(",") +
      "&longitude=" +
      pts.map(function (p) { return p.lon.toFixed(5); }).join(",");
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    const els = Array.isArray(data.elevation) ? data.elevation : [data.elevation];
    if (typeof els[0] !== "number") return;
    state.terrain = els[0];
    state.lastElevAt = { lat: lat, lon: lon };
    if (els.length >= 3 && typeof els[els.length - 1] === "number") {
      const run = ranges[els.length - 1] || 500;
      state.terrainGrade = clamp(((els[els.length - 1] - els[0]) / run) * 100, -MAX_GRADE, MAX_GRADE);
      state.ahead = [];
      for (let i = 0; i < els.length; i++) {
        if (typeof els[i] !== "number") continue;
        state.ahead.push({ dist: state.odo + ranges[i], alt: els[i] });
      }
    } else {
      state.terrainGrade = null;
      state.ahead = [];
    }
  } catch (_) {}
}

function applyFix(pos) {
  if (!pos || !pos.coords) return;
  const now = Date.now();
  if (state.lastWall && now - state.lastWall < 280) return;

  const c = pos.coords;
  const motion = advanceMotion(now, c.latitude, c.longitude, c.speed, c.heading);
  const alt = c.altitude;

  if (alt != null && Number.isFinite(alt)) {
    if (state.smoothAlt == null) state.smoothAlt = alt;
    else state.smoothAlt = state.smoothAlt * 0.72 + alt * 0.28;
    updateClimb(alt, motion.speed, now);
    accrueGain(state.smoothAlt);
    pushProfile(now, state.smoothAlt);
  } else if (state.terrain != null) {
    if (state.smoothAlt == null) state.smoothAlt = state.terrain;
    pushProfile(now, state.smoothAlt);
  }

  paint();

  const acc = c.accuracy;
  if (acc != null && acc <= 12) setStatus("live", "GPS lock");
  else if (acc != null && acc <= 40) setStatus("live", "GPS \u00b1" + Math.round(acc) + " m");
  else if (acc != null) setStatus("wait", "GPS \u00b1" + Math.round(acc) + " m");
  else setStatus("live", "GPS live");

  if (c.latitude != null && c.longitude != null) {
    fetchTerrain(c.latitude, c.longitude, c.heading);
  }
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
  const aheadEl = $("profileAhead");
  const dotEl = $("profileDot");
  const hint = $("profileHint");
  const pts = state.profile;
  if (!lineEl) return;
  if (!pts.length) {
    lineEl.setAttribute("d", "");
    if (fillEl) fillEl.setAttribute("d", "");
    if (aheadEl) aheadEl.setAttribute("d", "");
    if (dotEl) dotEl.setAttribute("cx", "-20");
    if (hint) hint.textContent = "Drive to build profile";
    $("profileRange").textContent = fmtDist(state.odo);
    $("profileX0").textContent = fmtDist(0);
    $("profileX1").textContent = "";
    $("profileX2").textContent = fmtDist(state.odo);
    $("profileMax").textContent = "";
    $("profileMin").textContent = "";
    return;
  }
  hint.textContent = "";
  const padL = 88, padR = 24, padT = 16, padB = 34;
  const iw = 1000 - padL - padR, ih = 220 - padT - padB;
  const d0 = pts[0].dist;
  const histSpan = Math.max(pts[pts.length - 1].dist - d0, state.odo, 1);
  const ahead = state.ahead || [];
  const look = ahead.length ? Math.max(0, ahead[ahead.length - 1].dist - (d0 + histSpan)) : 0;
  const spanX = histSpan + look;

  let min = toDisp(pts[0].alt), max = min;
  for (let i = 1; i < pts.length; i++) {
    const a = toDisp(pts[i].alt);
    if (a < min) min = a;
    if (a > max) max = a;
  }
  for (let i = 0; i < ahead.length; i++) {
    const a = toDisp(ahead[i].alt);
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

  function xy(dist, alt) {
    const x = padL + ((dist - d0) / spanX) * iw;
    const y = padT + (1 - (toDisp(alt) - y0) / spanY) * ih;
    return [x, y];
  }

  let line = "", area = "";
  for (let i = 0; i < pts.length; i++) {
    const pt = xy(pts[i].dist, pts[i].alt);
    line += (i ? " L" : "M") + pt[0].toFixed(1) + " " + pt[1].toFixed(1);
    area += (i ? " L" : "M") + pt[0].toFixed(1) + " " + pt[1].toFixed(1);
  }
  const last = xy(pts[pts.length - 1].dist, pts[pts.length - 1].alt);
  const base = padT + ih;
  area += " L" + last[0].toFixed(1) + " " + base + " L" + padL.toFixed(1) + " " + base + " Z";
  lineEl.setAttribute("d", line);
  fillEl.setAttribute("d", area);
  if (aheadEl) {
    if (ahead.length) {
      let d = "M" + last[0].toFixed(1) + " " + last[1].toFixed(1);
      for (let i = 0; i < ahead.length; i++) {
        const pt = xy(ahead[i].dist, ahead[i].alt);
        d += " L" + pt[0].toFixed(1) + " " + pt[1].toFixed(1);
      }
      aheadEl.setAttribute("d", d);
    } else {
      aheadEl.setAttribute("d", "");
    }
  }
  dotEl.setAttribute("cx", last[0].toFixed(1));
  dotEl.setAttribute("cy", last[1].toFixed(1));
  $("profileMax").textContent = Math.round(max) + " " + state.unit;
  $("profileMin").textContent = Math.round(min) + " " + state.unit;
  $("profileX0").textContent = fmtDist(0);
  $("profileX1").textContent = fmtDist(spanX / 2);
  $("profileX2").textContent = fmtDist(spanX);
  $("profileRange").textContent = fmtDist(Math.max(histSpan, state.odo));
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
    applyFix(pos);
    drawProfile();
  }, onError, opts);
  state.watchId = navigator.geolocation.watchPosition(function (pos) {
    applyFix(pos);
  }, onError, opts);
  state.pollId = setInterval(function () {
    navigator.geolocation.getCurrentPosition(function (pos) {
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
