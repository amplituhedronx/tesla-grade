const $ = (id) => document.getElementById(id);
const GPS_DB = 5;
const DEM_DB = 3;
const DEM_STEP = 40;

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
  watchId: null,
  pollId: null,
  simId: null,
  lastClimbSample: 0,
  lastGoodGradeT: 0,
  lastFixT: 0,
  profile: [],
  smoothAlt: null,
  vs: 0,
  grade: 0,
  vsReady: false,
  speed: 0,
  odo: 0,
  gain: 0,
  loss: 0,
  gainGps: 0,
  lossGps: 0,
  gainDem: 0,
  lossDem: 0,
  lastGpsEl: null,
  lastDemEl: null,
  lastElevFetch: 0,
  lastElevAt: null,
  terrain: null,
  starting: false,
  drawGrade: 0,
  sim: null,
  lastGpsAlt: null,
  lastLat: null,
  lastLon: null,
  pendingDem: [],
  demBusy: false,
  lastWatchT: 0
};
