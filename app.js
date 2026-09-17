const $ = (id) => document.getElementById(id);
const CLIMB_WINDOW_MS = 4000;

const state = {
  unit: localStorage.getItem("grade-unit") || "m",
  watchId: null,
  pollId: null,
  lastPos: null,
  lastClimbSample: 0,
  climbLog: [],
  profile: [],
  smoothAlt: null,
  vs: 0,
  grade: 0,
  vsReady: false,
  lastElevFetch: 0,
  lastElevAt: null,
  terrain: null,
  starting: false,
  drawGrade: 0
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
  if (state.lastPos) render(state.lastPos);
}

function toDisp(m) {
  if (m == null || Number.isNaN(m)) return null;
  return state.unit === "ft" ? m * 3.28084 : m;
}
function fmtAlt(m) {
  const v = toDisp(m);
  return v == null ? "—" : Math.round(v).toString();
}
function fmtAlt1(m) {
  const v = toDisp(m);
  return v == null ? "—" : (Math.round(v * 10) / 10).toFixed(1);
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
  if (avgSpeed < 1.2) {
    zeroClimb();
    return;
  }

  let older = null;
  for (const p of log) {
    if (now - p.t >= CLIMB_WINDOW_MS) older = p;
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

function pushProfile(alt) {
  const now = Date.now();
  const p = state.profile;
  if (!p.length || now - p[p.length - 1].t >= 1000) {
    p.push({ t: now, alt });
  } else {
    p[p.length - 1] = { t: now, alt };
  }
}

async function fetchTerrain(lat, lon) {
  const now = Date.now();
  if (now - state.lastElevFetch < 20000) return;
  if (state.lastElevAt && distM(state.lastElevAt, { lat, lon }) < 40) return;
  state.lastElevFetch = now;
  try {
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`;
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
  const g = state.drawGrade;
  const maxShow = 18;
  const clamped = Math.max(-maxShow, Math.min(maxShow, g));
  const deg = Math.atan(clamped / 100) * (180 / Math.PI);
  const road = $("road");
  if (road) {
    road.style.transform = "rotate(" + deg.toFixed(2) + "deg)";
    road.textContent = fmtGrade(g);
  }
}

function drawProfile() {
  const canvas = $("profileCanvas");
  const fit = fitCanvas(canvas);
  if (!fit) return;
  const { ctx, w, h } = fit;
  ctx.clearRect(0, 0, w, h);

  const pts = state.profile;
  const padL = 52;
  const padR = 16;
  const padT = 10;
  const padB = 22;
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
    ctx.fillText("Trace builds after a few GPS samples", padL + iw / 2, padT + ih / 2);
    return;
  }

  const alts = pts.map((p) => toDisp(p.alt));
  let min = Math.min(...alts);
  let max = Math.max(...alts);
  if (max - min < 8) {
    const mid = (max + min) / 2;
    min = mid - 4;
    max = mid + 4;
  }
  const span = max - min || 1;
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const tspan = Math.max(t1 - t0, 1000);

  const xy = (p) => {
    const x = padL + ((p.t - t0) / tspan) * iw;
    const y = padT + (1 - (toDisp(p.alt) - min) / span) * ih;
    return [x, y];
  };

  const last = xy(pts[pts.length - 1]);
  ctx.beginPath();
  pts.forEach((p, i) => {
    const [x, y] = xy(p);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  for (let i = pts.length - 1; i >= 0; i--) {
    const [x, y] = xy(pts[i]);
    ctx.lineTo(x, Math.min(padT + ih, y + 16));
  }
  ctx.closePath();
  ctx.fillStyle = "rgba(62, 106, 225, 0.22)";
  ctx.fill();

  ctx.beginPath();
  pts.forEach((p, i) => {
    const [x, y] = xy(p);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#3e6ae1";
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(last[0], last[1], 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#8e8e8e";
  ctx.font = "500 11px Inter, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(Math.round(max) + " " + state.unit, padL - 8, padT + 6);
  ctx.fillText(Math.round(min) + " " + state.unit, padL - 8, padT + ih - 6);

  const mins = Math.max(1, Math.round((t1 - t0) / 60000));
  $("profileRange").textContent = "last " + mins + " min  ·  " + Math.round(max - min) + " " + state.unit + " span";
}

function render(pos) {
  const c = pos.coords;
  const gpsAlt = c.altitude;
  if (gpsAlt != null && Number.isFinite(gpsAlt)) {
    if (state.smoothAlt == null) state.smoothAlt = gpsAlt;
    else state.smoothAlt = state.smoothAlt * 0.72 + gpsAlt * 0.28;
    sampleClimb(state.smoothAlt, c.speed);
    pushProfile(state.smoothAlt);
  }

  $("alt").textContent = fmtAlt(state.smoothAlt);
  $("gpsAlt").textContent = fmtAlt1(gpsAlt) + " " + state.unit;
  $("terrainAlt").textContent = state.terrain == null ? "—" : fmtAlt1(state.terrain) + " " + state.unit;
  $("vs").textContent = fmtVs(state.vs);
  $("grade").textContent = fmtGrade(state.grade);

  const acc = c.accuracy;
  if (acc != null && acc <= 12) setStatus("live", "GPS lock");
  else if (acc != null && acc <= 40) setStatus("live", "GPS ±" + Math.round(acc) + " m");
  else if (acc != null) setStatus("wait", "GPS ±" + Math.round(acc) + " m");
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
    showGate(
      "Location blocked",
      isAppleTouch
        ? "Settings → Safari → Location → Ask or Allow, then reload and tap Enable location."
        : "Allow location in site settings, then tap Enable location."
    );
  } else if (code === 2) {
    setStatus("wait", "GPS unavailable");
  } else if (code === 3) {
    setStatus("wait", "GPS timeout");
  } else {
    setStatus("wait", err && err.message ? err.message : "GPS error");
  }
}

function startWatch() {
  if (state.starting) return;
  state.starting = true;
  setTimeout(() => { state.starting = false; }, 1500);
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
  navigator.geolocation.getCurrentPosition((pos) => {
    state.lastPos = pos;
    render(pos);
  }, onError, opts);
  state.watchId = navigator.geolocation.watchPosition((pos) => {
    state.lastPos = pos;
    render(pos);
  }, onError, opts);
  if (state.pollId) clearInterval(state.pollId);
  state.pollId = setInterval(() => {
    navigator.geolocation.getCurrentPosition((pos) => {
      state.lastPos = pos;
      render(pos);
    }, () => {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 8000 });
  }, 1000);
}

function loop() {
  drawIncline();
  drawProfile();
  requestAnimationFrame(loop);
}

$("btnM").addEventListener("click", () => setUnit("m"));
$("btnFt").addEventListener("click", () => setUnit("ft"));
$("askLoc").addEventListener("click", (e) => {
  e.preventDefault();
  startWatch();
});

setUnit(state.unit);
loop();

if (isTesla) {
  startWatch();
} else {
  setStatus("wait", "Tap to enable GPS");
  showGate(
    "Enable location",
    isAppleTouch
      ? "On iPhone, Safari only asks for GPS after a tap. Tap the button, then Allow."
      : "Tap to allow GPS. The browser will prompt once."
  );
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && isTesla) startWatch();
});
window.addEventListener("resize", () => {
  drawIncline();
  drawProfile();
});
