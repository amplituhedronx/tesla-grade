function drawProfile() {
  const lineEl = $("profileLine");
  const fillEl = $("profileFill");
  const dotEl = $("profileDot");
  const hint = $("profileHint");
  if (!lineEl || !fillEl || !dotEl) return;
  const w = 1000, padL = 100, padR = 24, padT = 18, padB = 34;
  const iw = w - padL - padR, ih = 220 - padT - padB;
  const pts = state.profile.slice();
  if (pts.length === 1) {
    pts.push({ t: pts[0].t + 1000, alt: pts[0].alt, dist: pts[0].dist + 1, ghost: true });
  }

  const aheadEl = $("profileAhead");
  if (!pts.length && !(state.ahead && state.ahead.length)) {
    lineEl.setAttribute("d", "");
    fillEl.setAttribute("d", "");
    dotEl.setAttribute("cx", "-20");
    if (aheadEl) aheadEl.setAttribute("d", "");
    if (hint) hint.textContent = "Drive to build profile";
    $("profileX0").textContent = fmtDist(0);
    $("profileX1").textContent = fmtDist(0);
    $("profileX2").textContent = fmtDist(0);
    $("profileRange").textContent = fmtDist(0);
    return;
  }
  if (hint) hint.textContent = "";

  let d0 = pts.length ? pts[0].dist : 0;
  let d1 = pts.length ? pts[pts.length - 1].dist : 0;
  let dspan = Math.max(d1 - d0, 0);

  if (pts.length && dspan < 15) {
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

  const hereDist = pts.length ? pts[pts.length - 1].dist : 0;
  const aheadPts = [];
  if (state.ahead && state.ahead.length) {
    const originAlt = pts.length ? pts[pts.length - 1].alt : state.terrain;
    if (originAlt != null) aheadPts.push({ dist: hereDist, alt: originAlt, ahead: true });
    for (let i = 0; i < state.ahead.length; i++) {
      aheadPts.push({ dist: hereDist + state.ahead[i].dist, alt: state.ahead[i].alt, ahead: true });
    }
  } else if (pts.length && Math.abs(state.grade) >= 0.8) {
    const originAlt = pts[pts.length - 1].alt;
    aheadPts.push({ dist: hereDist, alt: originAlt, ahead: true });
    const preview = [80, 180, 320];
    for (let i = 0; i < preview.length; i++) {
      aheadPts.push({
        dist: hereDist + preview[i],
        alt: originAlt + preview[i] * (state.grade / 100),
        ahead: true
      });
    }
  }

  const histAlts = pts.map(function (p) { return toDisp(p.alt); }).filter(function (v) { return v != null; });
  const aheadAlts = aheadPts.map(function (p) { return toDisp(p.alt); }).filter(function (v) { return v != null; });
  const alts = histAlts.concat(aheadAlts);
  let dataMin = Math.min.apply(null, alts);
  let dataMax = Math.max.apply(null, alts);
  if (!Number.isFinite(dataMin) || !Number.isFinite(dataMax)) {
    dataMin = 0; dataMax = 1;
  }
  const rawSpan = Math.max(dataMax - dataMin, 0);
  const padY = Math.max(rawSpan * 0.12, 10);
  const min = dataMin - padY;
  const max = dataMax + padY;
  const span = max - min || 1;

  const histSpan = Math.max(dspan, state.odo || 0, 1);
  const aheadM = aheadPts.length ? Math.max(0, aheadPts[aheadPts.length - 1].dist - hereDist) : 0;
  const histW = aheadM > 0 ? iw * 0.84 : iw;
  const aheadW = iw - histW;
  const collapsed = histSpan < 15 && aheadPts.length < 2;

  function xy(p, i, n) {
    let x;
    if (collapsed) {
      x = padL + (i / Math.max(n - 1, 1)) * iw;
    } else if (p.ahead) {
      const ad = Math.max(0, p.dist - hereDist);
      x = padL + histW + (aheadM > 0 ? (ad / aheadM) * aheadW : 0);
    } else {
      x = padL + ((p.dist - d0) / histSpan) * histW;
    }
    const y = padT + (1 - (toDisp(p.alt) - min) / span) * ih;
    return [x, y];
  }

  let line = "";
  for (let i = 0; i < pts.length; i++) {
    if (pts[i].ghost && pts.length > 2) continue;
    const pt = xy(pts[i], i, pts.length);
    line += (line ? " L" : "M") + pt[0].toFixed(1) + " " + pt[1].toFixed(1);
  }
  let aheadPath = "";
  for (let i = 0; i < aheadPts.length; i++) {
    const pt = xy(aheadPts[i], pts.length + i, pts.length + aheadPts.length);
    aheadPath += (i ? " L" : "M") + pt[0].toFixed(1) + " " + pt[1].toFixed(1);
  }
  const lastSrc = pts.length ? pts[pts.length - 1] : aheadPts[0];
  const last = lastSrc ? xy(lastSrc, Math.max(pts.length - 1, 0), Math.max(pts.length, 2)) : [padL, padT + ih / 2];
  const areaSrc = aheadPts.length ? pts.concat(aheadPts) : pts;
  let area = "";
  for (let i = 0; i < areaSrc.length; i++) {
    const pt = xy(areaSrc[i], i, areaSrc.length);
    area += (i ? " L" : "M") + pt[0].toFixed(1) + " " + pt[1].toFixed(1);
  }
  for (let i = areaSrc.length - 1; i >= 0; i--) {
    const pt = xy(areaSrc[i], i, areaSrc.length);
    area += " L" + pt[0].toFixed(1) + " " + Math.min(padT + ih, pt[1] + 16).toFixed(1);
  }
  area += " Z";
  fillEl.setAttribute("d", area);
  lineEl.setAttribute("d", line);
  if (aheadEl) aheadEl.setAttribute("d", aheadPath);
  dotEl.setAttribute("cx", last[0].toFixed(1));
  dotEl.setAttribute("cy", last[1].toFixed(1));

  $("profileMax").textContent = Math.round(dataMax) + " " + state.unit;
  $("profileMin").textContent = Math.round(dataMin) + " " + state.unit;
  $("profileX0").textContent = fmtDist(0);
  $("profileX1").textContent = fmtDist(histSpan / 2);
  $("profileX2").textContent = fmtDist(histSpan);
  $("profileRange").textContent = Math.round(dataMax) + "\u2013" + Math.round(dataMin) + " " + state.unit + " \u00b7 " + fmtDist(histSpan);

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
      const pt = xy(mid, mi, pts.length);
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
$("btnReset").addEventListener("click", function () { resetSession(); });
$("askLoc").addEventListener("click", function (e) { e.preventDefault(); startWatch(); });
$("askLoc").addEventListener("touchend", function (e) { e.preventDefault(); startWatch(); }, { passive: false });

setUnit(state.unit);
drawIncline();
drawProfile();
loop();
state.tickId = setInterval(function () {
  if (state.mode === "gps" && state.trackAlt != null) pushProfile(Date.now(), state.trackAlt);
  drawIncline();
  drawProfile();
}, 1000);

if (isTesla) startWatch();
else {
  setStatus("wait", "Tap to enable GPS");
  showGate("Enable location", isAppleTouch
    ? "On iPhone, Safari only asks for GPS after a tap. Tap the button, then Allow."
    : "Tap to allow GPS.");
}

document.addEventListener("visibilitychange", function () {
  if (document.visibilityState === "visible" && isTesla && state.mode === "gps") startWatch();
});
