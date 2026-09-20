async function fetchTerrain(lat, lon, heading) {
  if (state.mode === "sim") return;
  const now = Date.now();
  if (now - state.lastElevFetch < 5000) return;
  if (state.lastElevAt && distM(state.lastElevAt, { lat: lat, lon: lon }) < 35 && now - state.lastElevFetch < 12000) return;
  state.lastElevFetch = now;
  const ranges = heading != null && Number.isFinite(heading) ? [0, 80, 160, 280, 450] : [0];
  const pts = ranges.map(function (d) {
    return d === 0 || heading == null || !Number.isFinite(heading)
      ? { lat: lat, lon: lon, dist: d }
      : Object.assign(destPoint(lat, lon, heading, d), { dist: d });
  });
  const lats = pts.map(function (p) { return p.lat.toFixed(5); }).join(",");
  const lons = pts.map(function (p) { return p.lon.toFixed(5); }).join(",");
  try {
    const res = await fetch("https://api.open-meteo.com/v1/elevation?latitude=" + lats + "&longitude=" + lons);
    if (!res.ok) return;
    const data = await res.json();
    const els = Array.isArray(data.elevation) ? data.elevation : [data.elevation];
    if (typeof els[0] === "number") {
      state.terrain = els[0];
      state.lastElevAt = { lat: lat, lon: lon };
      const ahead = [];
      for (let i = 1; i < pts.length && i < els.length; i++) {
        if (typeof els[i] === "number") ahead.push({ dist: pts[i].dist, alt: els[i] });
      }
      state.ahead = ahead;
      if (ahead.length) {
        const near = ahead[0];
        const gNear = ((near.alt - els[0]) / near.dist) * 100;
        const far = ahead[ahead.length - 1];
        const gFar = ((far.alt - els[0]) / far.dist) * 100;
        let g = Number.isFinite(gNear) ? gNear : gFar;
        if (Number.isFinite(gNear) && Number.isFinite(gFar)) g = gNear * 0.7 + gFar * 0.3;
        if (Number.isFinite(g)) state.terrainGrade = g;
      }
      if (state.gpsStuck || state.trackAlt == null) {
        if (state.trackAlt == null) state.trackAlt = els[0];
        pushProfile(now, state.trackAlt);
      }
      paintReadouts();
      drawProfile();
    }
  } catch (_) {}
}

function paintReadouts() {
  $("alt").textContent = fmtAlt(state.trackAlt != null ? state.trackAlt : state.smoothAlt);
  $("gpsAlt").textContent = state.lastAlt == null ? "\u2014" : fmtAlt2(state.lastAlt) + " " + state.unit;
  $("terrainAlt").textContent = state.terrain == null ? "\u2014" : fmtAlt2(state.terrain) + " " + state.unit;
  $("vs").textContent = fmtVs(state.vs);
  $("grade").textContent = fmtGrade(state.grade);
  $("speed").textContent = fmtSpeed(state.speed);
  const u = state.unit;
  $("gain").textContent = "\u2191 " + Math.round(toDisp(state.gain) || 0) + " " + u;
  $("loss").textContent = "\u2193 " + Math.round(toDisp(state.loss) || 0) + " " + u;
}

function applyFix(alt, speed, lat, lon, now, heading) {
  now = now || Date.now();
  if (Number.isFinite(heading)) state.heading = heading;
  else if (lat != null && state.lastLat != null) {
    const step = distM({ lat: state.lastLat, lon: state.lastLon }, { lat: lat, lon: lon });
    if (step >= 8) state.heading = bearingDeg({ lat: state.lastLat, lon: state.lastLon }, { lat: lat, lon: lon });
  }
  const spd = advanceOdo(now, speed, lat, lon);

  if (alt != null && Number.isFinite(alt)) {
    if (state.smoothAlt == null) state.smoothAlt = alt;
    else state.smoothAlt = state.smoothAlt * 0.5 + alt * 0.5;
    state.lastAlt = alt;
    state.gpsAltHist.push(alt);
    if (state.gpsAltHist.length > 12) state.gpsAltHist.shift();
    if (state.gpsAltHist.length >= 8) {
      let mn = state.gpsAltHist[0], mx = state.gpsAltHist[0];
      for (let i = 1; i < state.gpsAltHist.length; i++) {
        if (state.gpsAltHist[i] < mn) mn = state.gpsAltHist[i];
        if (state.gpsAltHist[i] > mx) mx = state.gpsAltHist[i];
      }
      state.gpsStuck = (mx - mn) < 2.5 && state.odo > 40;
    }
  }

  const dt = state.lastTrackT > 0 ? Math.min(3, (now - state.lastTrackT) / 1000) : 0;
  state.lastTrackT = now;

  if (state.gpsStuck || (alt == null && state.terrain != null)) {
    if (state.trackAlt == null) {
      state.trackAlt = state.terrain != null ? state.terrain : state.smoothAlt;
    } else {
      const g = state.terrainGrade != null ? state.terrainGrade : state.grade;
      if (dt > 0 && spd >= 0.8 && Number.isFinite(g)) {
        state.trackAlt += (g / 100) * spd * dt;
      }
      if (state.terrain != null) state.trackAlt = state.trackAlt * 0.82 + state.terrain * 0.18;
    }
  } else if (state.smoothAlt != null) {
    if (state.trackAlt == null) state.trackAlt = state.smoothAlt;
    else state.trackAlt = state.trackAlt * 0.4 + state.smoothAlt * 0.6;
  }

  if (state.trackAlt != null) {
    accrueGain(state.trackAlt);
    sampleClimb(state.trackAlt, spd, lat, lon, now);
    pushProfile(now, state.trackAlt);
  }
  paintReadouts();
}

function render(pos, nowOverride) {
  const c = pos.coords;
  applyFix(c.altitude, c.speed, c.latitude, c.longitude, nowOverride || Date.now(), c.heading);
  if (state.mode !== "sim") {
    const acc = c.accuracy;
    if (acc != null && acc <= 12) setStatus("live", "GPS lock");
    else if (acc != null && acc <= 40) setStatus("live", "GPS \u00b1" + Math.round(acc) + " m");
    else if (acc != null) setStatus("wait", "GPS \u00b1" + Math.round(acc) + " m");
    else setStatus("live", "GPS live");
    if (c.latitude != null) fetchTerrain(c.latitude, c.longitude, state.heading);
  }
}

function drawIncline() {
  state.drawGrade += (state.grade - state.drawGrade) * 0.28;
  const wedge = $("inclineWedge");
  const bar = $("inclineBar");
  if (!wedge || !bar) return;
  const w = 800, cy = 55, cx = w / 2;
  const clamped = Math.max(-18, Math.min(18, state.drawGrade));
  const vis = Math.atan(clamped / 100) * 180 / Math.PI * 2.2;
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
