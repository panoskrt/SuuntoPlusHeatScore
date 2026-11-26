// SuuntoPlus Sports App: heat acclimatization score
//
// The score (0-100) answers "how acclimatized am I to the heat I'm in right
// now". It is built around one quantity, the adapted temperature A: the
// apparent ("feels like") temperature the body is currently adapted to.
// Everyone counts as adapted up to T0 (22 C, the threshold Garmin uses for
// its heat acclimation), and the score is the share of the step from T0 to
// the current apparent temperature that A already covers (scaled against at
// least MIN_SPAN, so mildly warm days don't swing between 0 and 100).
//
// Data. Current conditions come from the phone-synced weather the watch
// keeps for its own widgets (/Weather/Current/ValidWeatherData: temperature,
// humidity, feels-like), turned into an NWS heat index. Without weather, the
// wrist temperature sensor is used with a rough skin-heat correction. The
// nightly sleep summaries (/Daily/Sleep/{0..-6}/Data), the latest VO2max and
// the user's max HR are read too. Undocumented resources are read with $.get
// rather than listed in the manifest: a missing manifest path stops the app
// from loading, a missing $.get path just never answers.
//
// 1. Heat dose (the stimulus). Heat acclimation needs a raised core AND skin
//    temperature, repeated daily (Periard et al. 2015; Taylor 2014). Each
//    workout minute, core temperature is estimated from heart rate with the
//    USARIEM ECTemp Kalman filter (Buller et al. 2013), after removing the
//    part of the HR rise caused by altitude. Minute dose = core strain
//    (0 at 37.5 C, 1 at 38.5 C) x environmental heat (0 at T0, 1 at
//    ENV_FULL feels-like). 60 minutes at 38.5 C in 32 C feels-like is one
//    full heat-acclimation session (dose 1).
// 2. Exposure model (the prior). Each session moves A toward that session's
//    (dose-weighted) apparent temperature with first-order kinetics in dose
//    (K_DOSE sessions: ~67% after 5 daily sessions, ~90% after 10-14), sped
//    up for a high VO2max (Garmin: fit athletes adapt up to twice as fast).
//    Between sessions A decays back toward T0 by ~2.5% per day (Daanen et
//    al. 2018).
// 3. Physiology (the evidence). Cardiac drift (aerobic decoupling, the fall
//    in output per heartbeat from the first to the second half of a steady
//    workout) in hot sessions, compared with the user's own drift in cool
//    sessions: heat-acclimatized athletes drift far less (lower HR, larger
//    plasma volume, earlier sweating). Sleeping HR / HRV the night after heat
//    exposure, compared with nights without it, add a little weight.
//    Physiology may lift A by at most MAX_PHYS_LEAD of the gap above the
//    exposure model, so one good session can't claim full adaptation.
//
// During a workout the app shows the estimated core temperature and the
// Physiological Strain Index (Moran et al. 1998) and raises an alert (tone
// and the a.html popup) when strain gets high. All constants are
// approximations from published studies: an indicator, not a medical
// assessment.
//
// The lower button switches to g.html, the last 7 days: heat acclimation (%
// of full acclimation to T_REF) at the end of each day and that day's dose.

var STATE_KEY = 'heataccli_state_v1';
var DAY = 86400;
var KELVIN = 273.15;

// Conditions (degrees C, apparent temperature)
var T0 = 22;                   // everyone counts as adapted up to here (Garmin's 22 C threshold)
var T_REF = 35;                // "fully heat acclimated" reference for the acclimation %
var MIN_SPAN = 8;              // deficit scale near T0, so 24 C never reads as 0
var ENV_FULL = 32;             // feels-like at which the environment gives the full stimulus
var HOT_SESSION = 25;          // sessions at least this warm count as heat exposure
var EXTREME_HEAT = 40;         // NWS "danger" range starts around here

// Dose and kinetics
var TC_LOW = 37.5;             // C; estimated core temperature where the stimulus starts
var TC_HIGH = 38.5;            // C; full stimulus (isothermic heat acclimation target)
var DOSE_CAP = 1.5;            // sessions; longer exposures add little more on the day
var MIN_HEAT_DOSE = 0.3;       // sessions; smaller doses don't count as a heat day
var K_DOSE = 4.5;              // sessions; acclimation "time constant" in full doses
var TAU_DECAY = 40;            // days; ~2.5% of the adaptation lost per day (Daanen 2018)
var VO2_LOW = 45;              // ml/kg/min; no speed-up at or below
var VO2_HIGH = 70;             // ml/kg/min; twice as fast at or above

// ECTemp (Buller et al. 2013; US patent 10,702,165), 1-minute steps, HR in bpm
var CT_START = 37.1;
var CT_GAMMA2 = 0.000484;
var CT_B0 = -7887.1;
var CT_B1 = 384.4286;
var CT_B2 = -4.5714;
var CT_SIGMA2 = 356.4544;
var ALT_HR_FROM = 1000;        // m; HR rise from hypoxia starts above this
var ALT_HR_PER_KM = 0.06;      // share of HR per km above ALT_HR_FROM that is altitude, not heat
var REF_HR_REST = 60;          // bpm; HR reserve of the ECTemp study population (young soldiers),
var REF_HR_MAX = 190;          // the user's HR is mapped onto it by % of HR reserve

// Physiological Strain Index (Moran et al. 1998): 0-10
var PSI_TC_MAX = 39.5;
var PSI_HR_MAX = 180;          // replaced by the user's max HR when known
var PSI_CAUTION = 8;           // caution at "high" strain
var PSI_ALERT = 9;             // alert at "very high"...
var TC_ALERT = 39.5;           // ...or this estimated core temperature
var PSI_REARM = 7;
var LIVE_HR_ALPHA = 0.1;       // per-second smoothing of the HR in the displayed strain
                               // (the caution status and alert use whole-minute strain)
var ALERT_REPEAT = 600;        // s; a standing strain alert repeats at most this often

// Cardiac drift evidence
var WARMUP_MIN = 10;           // minutes ignored at the start of a session
var MIN_DRIFT_MIN = 30;        // steady minutes needed after the warm-up
var STEADY = 0.15;             // halves' mean output may differ at most this much
var DRIFT_DEFAULT = 0.025;     // typical decoupling in cool conditions until the user's own is known
var DRIFT_PER_C = 0.005;       // extra decoupling per C above T0 when not acclimatized
var DRIFT_RESIDUAL = 0.25;     // share of that extra decoupling left once acclimatized

// Overnight evidence
var HR_STRAIN = 5;             // bpm; sleeping HR rise after heat that reads as "not adapted"
var HRV_STRAIN = 0.2;          // sleeping HRV drop after heat that reads as "not adapted"
var POOR_HR = 8;               // bpm; caution: poor recovery from the heat
var POOR_HRV = 0.3;
var HEAT_NIGHT_WINDOW = 1.5 * DAY; // a heat session this soon before bedtime makes a heat night
var BASELINE_NIGHTS = 10;

var W_TIME = 1;                // blend weights
var W_DRIFT = 0.5;
var W_NIGHT_HR = 0.15;
var W_NIGHT_HRV = 0.15;
var MAX_PHYS_LEAD = 0.5;       // share of the gap above the exposure model physiology may close

// Sensors and storage
var WEATHER_MAX_AGE = 3 * 3600; // s
var WRIST_OFFSET = 4;          // C; wrist sensor reads above ambient in the heat
var WRIST_SKIN = 30;           // C; below this the wrist reading is mostly skin heat
var REFRESH = 600;             // s; re-read weather and history this often
var MAX_SESSIONS = 40;
var MAX_NIGHTS = 21;
var WATCH_NIGHTS = 7;
var MIN_SLEEP = 3 * 3600;
var STALE_NIGHT = 1.5 * DAY;
var MIN_SESSION_MIN = 10;      // shorter workouts aren't stored
var EVIDENCE_AGE = 7 * DAY;
var EVIDENCE_SESSIONS = 3;
var GRAPH_DAYS = 7;

// status: 0 = no heat stress, 1 = not acclimatized, 2 = acclimatizing, 3 = acclimatized,
// 4 = caution: high heat strain, 5 = caution: extreme heat, 6 = caution: poor heat recovery,
// 7 = no temperature data
var CAUTION_STRAIN = 4;
var CAUTION_EXTREME = 5;
var CAUTION_RECOVERY = 6;
var NO_DATA = 7;

var state;                     // persisted: sessions, nights, alert state, profile
var weather = null;            // latest weather reading
var tz = 0;                    // s; local time minus UTC
var imperial = false;          // core temperature output in F instead of C
var lastRequest = 0;
var stateChanged = false;
var graphDirty = true;
var cur = null;                // live session
var minute = null;             // samples of the minute in progress
var live = { score: 0, pct: 0, a: T0, psi: 0, ct: CT_START };
var currentTemplate = 't';     // 't' = score view, 'g' = last 7 days, 'a' = strain alert

var clamp01 = function (x) {
  return x < 0 ? 0 : (x > 1 ? 1 : x);
};

var inRange = function (x, min, max) {
  return typeof x === 'number' && x >= min && x <= max ? x : null;
};

var median = function (values) {
  if (!values.length) return null;
  values.sort(function (a, b) { return a - b; });
  var m = values.length >> 1;
  return values.length % 2 ? values[m] : (values[m - 1] + values[m]) / 2;
};

// Celsius from a weather value (Kelvin on the watch; tolerate Celsius).
var toC = function (x) {
  if (typeof x !== 'number') return null;
  return x > 150 ? x - KELVIN : x;
};

// NWS heat index (Rothfusz regression with the Steadman fallback), in C.
var heatIndex = function (t, rh) {
  if (t < 20) return t;
  var f = t * 1.8 + 32;
  var hi = 0.5 * (f + 61 + (f - 68) * 1.2 + rh * 0.094);
  if ((hi + f) / 2 >= 80) {
    hi = -42.379 + 2.04901523 * f + 10.14333127 * rh - 0.22475541 * f * rh -
      0.00683783 * f * f - 0.05481717 * rh * rh + 0.00122874 * f * f * rh +
      0.00085282 * f * rh * rh - 0.00000199 * f * f * rh * rh;
    if (rh < 13 && f >= 80 && f <= 112) {
      hi -= (13 - rh) / 4 * Math.sqrt((17 - Math.abs(f - 95)) / 17);
    } else if (rh > 85 && f >= 80 && f <= 87) {
      hi += (rh - 85) / 10 * (87 - f) / 5;
    }
  }
  return (hi - 32) / 1.8;
};

// The SuuntoPlus Editor simulator always serves the same mock weather (20 C,
// 43%, these exact wind/visibility/rain values). With it, the Temperature
// input (the simulator's slider or the workout file) is used as the air
// temperature instead, so the screens can be tested at any heat. The
// simulator leaves that input empty until the slider is moved; the mock
// weather is used until then.
var isSimulatorWeather = function (w) {
  return w.visibility === 2854 && w.windDeg === 230 && w.pop === 0.23 && w.rain === 1.2;
};

// Apparent temperature now (C) or null: weather first, then the wrist sensor.
var apparentTemp = function (now, wristK) {
  var air = weather && weather.sim ? toC(wristK) : null;
  if (air !== null) return heatIndex(air, weather.rh !== null ? weather.rh : 50);
  if (weather && (!(weather.dt > 0) || now - weather.dt < WEATHER_MAX_AGE)) {
    if (weather.temp !== null && weather.rh !== null) return heatIndex(weather.temp, weather.rh);
    if (weather.feels !== null) return weather.feels;
    if (weather.temp !== null) return weather.temp;
  }
  var c = toC(wristK);
  if (c === null || c < -40 || c > 70) return null;
  return c - WRIST_OFFSET - Math.max(0, WRIST_SKIN - c);
};

// ---------------------------------------------------------------- watch data

var storeWeather = function (d) {
  var w = d && (d.value || d.data || d);
  if (!w || typeof w !== 'object') return;
  weather = {
    dt: Number(w.dt || 0),
    temp: toC(w.temp),
    feels: toC(w.feelsLike),
    rh: inRange(w.humidity, 0, 100),
    sim: isSimulatorWeather(w)
  };
};

var parseNight = function (d) {
  if (!d || !(d.duration >= MIN_SLEEP)) return null;
  var end = d.endTimeUTC || d.endTime;
  if (!(end > 0)) return null;
  var hr = inRange(d.minimumHr, 0.3, 4); // Hz
  return {
    start: d.startTimeUTC || d.startTime || end - d.duration,
    end: end,
    hr: hr === null ? null : hr * 60,
    hrv: inRange(d.averageHrv, 1, 300)
  };
};

var storeNight = function (data) {
  var night = parseNight(data);
  if (!night) return;
  var nights = state.nights;
  var i = nights.length;
  while (i > 0 && nights[i - 1].end > night.end) i--;
  if (i > 0 && nights[i - 1].end === night.end) {
    var old = nights[i - 1];
    if (old.start === night.start && old.hr === night.hr && old.hrv === night.hrv) return;
    nights[i - 1] = night;
  } else {
    nights.splice(i, 0, night);
    if (nights.length > MAX_NIGHTS) nights.shift();
  }
  stateChanged = true;
};

// Note: no function may return a function expression ("return function").
// The simulator loads the minified main.js and patches the first
// "return function" it finds, assuming it is the minifier's own wrapper.

var numberValue = function (d) {
  return Number(typeof d === 'number' ? d : (d && d.value));
};

var storeProfile = function (key, value, min, max) {
  var v = inRange(value, min, max);
  if (v !== null && state[key] !== v) {
    state[key] = v;
    stateChanged = true;
    graphDirty = true;
  }
};

var storeMaxHr = function (d) {
  storeProfile('maxHr', numberValue(d), 120, 230);
};

var storeVo2 = function (d) {
  storeProfile('vo2', numberValue(d), 20, 90);
};

var storeUnits = function (d) {
  imperial = numberValue(d) === 1;
};

// Local time against the UTC time of the request (lastRequest).
var storeLocalTime = function (d) {
  var v = numberValue(d);
  if (v > 0 && lastRequest > 0) tz = Math.round((v - lastRequest) / 900) * 900;
};

// Asks the watch for weather, sleep history and profile values.
var requestData = function () {
  if (typeof $ === 'undefined' || !$.get) return;
  try {
    $.get('/Weather/Current/ValidWeatherData', storeWeather);
    $.get('/Dev/Time/LocalTime', storeLocalTime);
    for (var i = 0; i < WATCH_NIGHTS; i++) {
      $.get('/Daily/Sleep/' + (-i) + '/Data', storeNight);
    }
    $.get('/Settings/Unit/UnitsMode', storeUnits);
    $.get('/Settings/User/MaxHR', storeMaxHr);
    $.get('/Activity/History/Last/MaxVO2', storeVo2);
  } catch (e) {
    // Resources not available on this watch; fallbacks apply.
  }
};

// ---------------------------------------------------------- live session

var newSession = function (now) {
  cur = {
    start: now, end: now, minutes: 0, dose: 0, doseT: 0, tSum: 0, tN: 0,
    ct: CT_START, v: 0, peakTc: CT_START, maxPsi: 0, psi: 0,
    hr0: restingHr(), hrLive: null,
    hr: [], spd: [], pwr: []
  };
};

var newMinute = function (now) {
  minute = { start: now, n: 0, hr: 0, spd: 0, pwr: 0 };
};

// One ECTemp Kalman step with the minute's mean HR (bpm).
var ectemp = function (hr) {
  var ctp = cur.ct;
  var vp = cur.v + CT_GAMMA2;
  var c = 2 * CT_B2 * ctp + CT_B1;
  var k = vp * c / (c * c * vp + CT_SIGMA2);
  cur.ct = ctp + k * (hr - (CT_B2 * ctp * ctp + CT_B1 * ctp + CT_B0));
  cur.v = (1 - k * c) * vp;
};

var restingHr = function () {
  var base = sleepBaseline();
  return base.hr !== null ? base.hr : 60;
};

var maxHr = function (hr0) {
  return Math.max(hr0 + 40, state.maxHr || PSI_HR_MAX);
};

// The user's HR expressed at the same % of HR reserve in the ECTemp population,
// so a given relative effort maps to the same heat production.
var referenceHr = function (hr, hr0) {
  return REF_HR_REST + (hr - hr0) / (maxHr(hr0) - hr0) * (REF_HR_MAX - REF_HR_REST);
};

// hr0: resting HR, refreshed once a minute (cur.hr0)
var psiFor = function (ct, hr, hr0) {
  var hrMax = maxHr(hr0);
  var psi = 5 * (ct - CT_START) / (PSI_TC_MAX - CT_START) + 5 * (hr - hr0) / (hrMax - hr0);
  return psi < 0 ? 0 : (psi > 10 ? 10 : psi);
};

var closeMinute = function (altitude, tapp) {
  if (minute.n < 20) return; // mostly paused or no HR: skip
  var hr = minute.hr / minute.n;
  var km = altitude === null ? 0 : Math.max(0, altitude - ALT_HR_FROM) / 1000;
  cur.hr0 = restingHr();
  ectemp(referenceHr(hr / (1 + ALT_HR_PER_KM * km), cur.hr0));

  var strain = clamp01((cur.ct - TC_LOW) / (TC_HIGH - TC_LOW));
  var env = tapp === null ? 0 : clamp01((tapp - T0) / (ENV_FULL - T0));
  var d = Math.min(strain * env / 60, DOSE_CAP - cur.dose);
  if (d > 0) {
    cur.dose += d;
    cur.doseT += d * tapp;
  }
  if (tapp !== null) {
    cur.tSum += tapp;
    cur.tN++;
  }
  cur.minutes++;
  cur.peakTc = Math.max(cur.peakTc, cur.ct);
  cur.psi = psiFor(cur.ct, hr, cur.hr0);
  cur.maxPsi = Math.max(cur.maxPsi, cur.psi);
  cur.hr.push(hr);
  cur.spd.push(minute.spd / minute.n);
  cur.pwr.push(minute.pwr / minute.n);
};

// Aerobic decoupling of the steady part of the session, or null.
var sessionDrift = function (s) {
  var usePower = 0;
  var i;
  for (i = WARMUP_MIN; i < s.pwr.length; i++) if (s.pwr[i] > 20) usePower++;
  var out = usePower > (s.pwr.length - WARMUP_MIN) / 2 ? s.pwr : s.spd;
  var min = out === s.pwr ? 20 : 0.5;
  var idx = [];
  for (i = WARMUP_MIN; i < out.length; i++) {
    if (out[i] > min && s.hr[i] > 0) idx.push(i);
  }
  if (idx.length < MIN_DRIFT_MIN) return null;
  var half = idx.length >> 1;
  var o1 = 0, h1 = 0, o2 = 0, h2 = 0;
  for (i = 0; i < idx.length; i++) {
    if (i < half) {
      o1 += out[idx[i]];
      h1 += s.hr[idx[i]];
    } else {
      o2 += out[idx[i]];
      h2 += s.hr[idx[i]];
    }
  }
  var n2 = idx.length - half;
  if (Math.abs((o2 / n2) / (o1 / half) - 1) > STEADY) return null;
  var drift = 1 - (o2 / h2) / (o1 / h1);
  return Math.max(-0.2, Math.min(0.4, drift));
};

// Stores the live session's summary, replacing its previous summary.
var saveSession = function () {
  if (cur.minutes < MIN_SESSION_MIN) return;
  var tMean = cur.tN ? cur.tSum / cur.tN : null;
  var record = {
    start: cur.start,
    end: cur.end,
    dose: Math.round(cur.dose * 1000) / 1000,
    temp: cur.dose > 0 ? cur.doseT / cur.dose : tMean,
    tMean: tMean,
    drift: sessionDrift(cur),
    peakTc: cur.peakTc,
    maxPsi: cur.maxPsi
  };
  var sessions = state.sessions;
  if (sessions.length && sessions[sessions.length - 1].start === cur.start) {
    sessions[sessions.length - 1] = record;
  } else {
    sessions.push(record);
    if (sessions.length > MAX_SESSIONS) sessions.shift();
  }
  stateChanged = true;
  graphDirty = true;
};

var trackSession = function (input, now, altitude, tapp) {
  if (Number(input.State) !== 1) {
    minute = null; // paused, prestart or ended: drop the partial minute
    return;
  }
  if (!cur) newSession(now);
  if (!minute) newMinute(now);
  var hr = inRange(input.HeartRate, 0.4, 4);
  if (hr !== null) {
    // ~10 s smoothed HR for the strain shown on screen
    cur.hrLive = cur.hrLive === null ? hr * 60 : cur.hrLive + (hr * 60 - cur.hrLive) * LIVE_HR_ALPHA;
    minute.n++;
    minute.hr += hr * 60;
    minute.spd += inRange(input.Speed, 0, 30) || 0;
    minute.pwr += inRange(input.Power, 0, 2500) || 0;
  }
  if (now - minute.start >= 60) {
    closeMinute(altitude, tapp);
    cur.end = now;
    newMinute(now);
    saveSession();
  }
};

// ------------------------------------------------------------------- model

var speedUp = function () {
  return 1 + (state.vo2 ? clamp01((state.vo2 - VO2_LOW) / (VO2_HIGH - VO2_LOW)) : 0);
};

var decay = function (a, days) {
  return days > 0 ? T0 + (a - T0) * Math.exp(-days / TAU_DECAY) : a;
};

var gain = function (a, s, k) {
  if (!(s.dose > 0) || !(s.temp > a)) return a;
  return a + (s.temp - a) * (1 - Math.exp(-s.dose / k));
};

// Exposure-model adapted temperature at time t.
var exposureAt = function (t) {
  var sessions = state.sessions;
  var k = K_DOSE / speedUp();
  var a = T0;
  var last = 0;
  for (var i = 0; i < sessions.length && sessions[i].end <= t; i++) {
    if (last) a = decay(a, (sessions[i].end - last) / DAY);
    a = gain(a, sessions[i], k);
    last = sessions[i].end;
  }
  return last ? decay(a, (t - last) / DAY) : a;
};

var isHeatSession = function (s) {
  return s.dose >= MIN_HEAT_DOSE && s.temp >= HOT_SESSION;
};

// The heat session that ended within HEAT_NIGHT_WINDOW before this night's bedtime, if any.
var heatBefore = function (night) {
  var sessions = state.sessions;
  for (var i = sessions.length - 1; i >= 0; i--) {
    var s = sessions[i];
    if (s.end > night.start) continue;
    if (night.start - s.end > HEAT_NIGHT_WINDOW) return null;
    if (isHeatSession(s)) return s;
  }
  return null;
};

// Mean sleeping HR / HRV over the latest nights without heat exposure.
var sleepBaseline = function () {
  var hr = [], hrv = [];
  for (var i = state.nights.length - 1; i >= 0; i--) {
    var n = state.nights[i];
    if (heatBefore(n)) continue;
    if (n.hr !== null && hr.length < BASELINE_NIGHTS) hr.push(n.hr);
    if (n.hrv !== null && hrv.length < BASELINE_NIGHTS) hrv.push(n.hrv);
  }
  var mean = function (v) {
    if (!v.length) return null;
    var sum = 0;
    for (var j = 0; j < v.length; j++) sum += v[j];
    return sum / v.length;
  };
  return { hr: mean(hr), hrv: mean(hrv) };
};

// Physiological estimates {a, w, top} of A at time `now` from the data
// recorded up to then, plus a recovery caution.
var evidence = function (now) {
  var estimates = [];
  var caution = 0;
  var sessions = state.sessions;
  var i;

  // Cardiac drift: hot sessions against the user's cool-session drift.
  var cool = [];
  for (i = 0; i < sessions.length; i++) {
    if (sessions[i].end > now) break;
    if (sessions[i].drift !== null && sessions[i].tMean !== null && sessions[i].tMean < T0) cool.push(sessions[i].drift);
  }
  var base = median(cool);
  var trust = base === null ? 0.7 : 1;
  if (base === null) base = DRIFT_DEFAULT;
  var hot = [];
  for (i = sessions.length - 1; i >= 0 && hot.length < EVIDENCE_SESSIONS; i--) {
    var s = sessions[i];
    if (s.end > now) continue;
    if (now - s.end > EVIDENCE_AGE) break;
    if (s.drift !== null && s.temp >= HOT_SESSION) hot.push(s);
  }
  // Each session adds up to 1/EVIDENCE_SESSIONS of W_DRIFT, fading with age,
  // so a single workout can't move A much.
  for (i = 0; i < hot.length; i++) {
    var expected = DRIFT_PER_C * (hot[i].temp - T0);
    var excess = hot[i].drift - base;
    var f = 1 - clamp01((excess - DRIFT_RESIDUAL * expected) / ((1 - DRIFT_RESIDUAL) * expected));
    estimates.push({
      a: T0 + f * (hot[i].temp - T0),
      w: W_DRIFT * clamp01(expected / 0.03) * trust * (1 - (now - hot[i].end) / EVIDENCE_AGE) / EVIDENCE_SESSIONS,
      top: hot[i].temp
    });
  }

  // Last night, if it followed heat exposure.
  var night = null;
  for (i = state.nights.length - 1; i >= 0 && !night; i--) {
    if (state.nights[i].end <= now) night = state.nights[i];
  }
  var heat = night && now - night.end < STALE_NIGHT ? heatBefore(night) : null;
  if (heat) {
    var sb = sleepBaseline();
    if (night.hr !== null && sb.hr !== null) {
      var rise = night.hr - sb.hr;
      estimates.push({ a: T0 + (1 - clamp01(rise / HR_STRAIN)) * (heat.temp - T0), w: W_NIGHT_HR, top: heat.temp });
      if (rise > POOR_HR) caution = CAUTION_RECOVERY;
    }
    if (night.hrv !== null && sb.hrv !== null) {
      var drop = 1 - night.hrv / sb.hrv;
      estimates.push({ a: T0 + (1 - clamp01(drop / HRV_STRAIN)) * (heat.temp - T0), w: W_NIGHT_HRV, top: heat.temp });
      if (drop > POOR_HRV) caution = CAUTION_RECOVERY;
    }
  }
  return { estimates: estimates, caution: caution };
};

// Weighted blend of the exposure model with the estimates; physiology may
// close at most MAX_PHYS_LEAD of the gap above the exposure model.
var blend = function (exposure, estimates) {
  var sum = W_TIME * exposure;
  var weight = W_TIME;
  var top = exposure;
  for (var i = 0; i < estimates.length; i++) {
    sum += estimates[i].w * estimates[i].a;
    weight += estimates[i].w;
    top = Math.max(top, estimates[i].top);
  }
  var a = Math.min(sum / weight, exposure + MAX_PHYS_LEAD * (top - exposure));
  return Math.max(T0, a);
};

var pctFor = function (a) {
  return Math.round(100 * clamp01((a - T0) / (T_REF - T0)));
};

var scoreFor = function (tapp, a) {
  if (tapp <= T0) return 100;
  return Math.round(100 * clamp01(1 - (tapp - a) / Math.max(tapp - T0, MIN_SPAN)));
};

// Last GRAPH_DAYS local calendar days, index 0 = today: acclimation % at
// the end of the day (now for today) and that day's heat dose (x100).
var updateGraph = function (now, output) {
  var today = Math.floor((now + tz) / DAY);
  var accl = [];
  var dose = [];
  for (var k = 0; k < GRAPH_DAYS; k++) {
    var end = (today - k + 1) * DAY - tz;
    var t = Math.min(end, now);
    accl.push(k === 0 ? live.pct : pctFor(blend(exposureAt(t), evidence(t).estimates)));
    dose.push(0);
  }
  for (var i = 0; i < state.sessions.length; i++) {
    var day = today - Math.floor((state.sessions[i].end + tz) / DAY);
    if (day >= 0 && day < GRAPH_DAYS) dose[day] += state.sessions[i].dose;
  }
  // Literal output names only: the build maps each one to a slot.
  output.dayAccl0 = accl[0];
  output.dayAccl1 = accl[1];
  output.dayAccl2 = accl[2];
  output.dayAccl3 = accl[3];
  output.dayAccl4 = accl[4];
  output.dayAccl5 = accl[5];
  output.dayAccl6 = accl[6];
  output.dayDose0 = Math.round(dose[0] * 100);
  output.dayDose1 = Math.round(dose[1] * 100);
  output.dayDose2 = Math.round(dose[2] * 100);
  output.dayDose3 = Math.round(dose[3] * 100);
  output.dayDose4 = Math.round(dose[4] * 100);
  output.dayDose5 = Math.round(dose[5] * 100);
  output.dayDose6 = Math.round(dose[6] * 100);
};

// Tone/vibration plus the a.html popup when heat strain gets high, repeated
// at most every ALERT_REPEAT while it lasts.
var alertStrain = function (now) {
  var high = cur && (cur.psi >= PSI_ALERT || cur.ct >= TC_ALERT);
  if (!high && (!cur || cur.psi < PSI_REARM) && state.alertAt) {
    state.alertAt = 0;
    stateChanged = true;
  }
  if (!high || now - (state.alertAt || 0) < ALERT_REPEAT) return;
  state.alertAt = now;
  stateChanged = true;
  playIndication('Info', false, 2);
  currentTemplate = 'a';
  unload('_cm');
};

function evaluate(input, output) {
  var now = Number(input.Time || 0);
  if (!(now > 0)) return;
  var altitude = typeof input.Altitude === 'number' ? input.Altitude : null;

  if (now - lastRequest >= REFRESH) {
    lastRequest = now;
    requestData();
  }

  var tapp = apparentTemp(now, input.Temperature);
  var minutesBefore = cur ? cur.minutes : -1;
  trackSession(input, now, altitude, tapp);

  var exposure = exposureAt(now);
  var ev = evidence(now);
  var a = blend(exposure, ev.estimates);
  live.a = a;
  live.pct = pctFor(a);

  var status;
  if (tapp === null) {
    live.score = live.pct;
    status = NO_DATA;
  } else {
    live.score = scoreFor(tapp, a);
    if (tapp <= T0) {
      status = 0;
    } else {
      status = live.score < 40 ? 1 : (live.score < 75 ? 2 : 3);
      if (ev.caution) status = ev.caution;
      if (tapp >= EXTREME_HEAT) status = CAUTION_EXTREME;
    }
    output.apparentTemp = tapp + KELVIN;
  }
  if (cur && cur.minutes > 0 && cur.psi >= PSI_CAUTION) status = CAUTION_STRAIN;

  output.score = live.score;
  output.adaptedTemp = a + KELVIN;
  output.status = status;
  // One-decimal values: the Temperature formats have no decimals.
  var ct = cur ? cur.ct : CT_START;
  output.coreTemp = Math.round((imperial ? ct * 1.8 + 32 : ct) * 10) / 10;
  // Strain follows HR within seconds; core temperature moves once a minute.
  var psi = cur && cur.hrLive !== null ? psiFor(cur.ct, cur.hrLive, cur.hr0) : 0;
  output.strain = Math.round(psi * 10) / 10;

  if (graphDirty || (cur && cur.minutes !== minutesBefore)) {
    graphDirty = false;
    updateGraph(now, output);
  }
  alertStrain(now);

  if (stateChanged) {
    stateChanged = false;
    try {
      localStorage.setObject(STATE_KEY, state);
    } catch (e) {
      // Ignore storage boundaries if present.
    }
  }
}

// main.js loaded and system starts calling evaluate()
function onLoad(input, output) {
  var saved = null;
  try {
    saved = localStorage.getObject(STATE_KEY);
  } catch (e) {
    saved = null;
  }
  var list = function (x) {
    return x && typeof x.length === 'number' ? x : [];
  };
  state = {
    sessions: list(saved && saved.sessions),
    nights: list(saved && saved.nights),
    alertAt: Number((saved && saved.alertAt) || 0),
    maxHr: (saved && saved.maxHr) || 0,
    vo2: (saved && saved.vo2) || 0
  };
  cur = null;
  minute = null;
  graphDirty = true;
  currentTemplate = 't';

  output.score = 0;
  output.status = NO_DATA;
  output.strain = 0;
}

/* Other available callbacks:
function onExerciseStart() {}    // Is evaluated on exercise start
function onExercisePause() {}    // Is evaluated on exercise pause
function onExerciseContinue() {} // Is evaluated when continuing exercise after pause
function onLap() {}              // Is evaluated on every lap change
function onAutoLap() {}          // Is evaluated on every autolap change
function onInterval() {}         // Is evaluated on interval
function onPoolLength() {}       // Is evaluated after each pool length (swimming)
*/

// The lower button toggles between the score view (event 1) and the graph (event 2);
// it also dismisses the strain popup (event 1).
function onEvent(input, output, eventId) {
  currentTemplate = eventId === 2 ? 'g' : 't';
  unload('_cm'); // Unload & reload the screen to rerun getUserInterface
}

// Is evaluated when a user enters the SuuntoPlus sports app screen the first
// time and when the screen is reloaded. Essentially defines what is shown on
// the screen by returning the wanted HTML template.
function getUserInterface() {
  return {
    template: currentTemplate
  };
}

// Defines the info shown at the bottom of the exercise summary info shown after the exercise.
// These values are also provided to SuuntoApp. At most 4 (the simulator's limit; the
// reference warns the practical limit is around 4-5).
function getSummaryOutputs(input, output) {
  return [
    { id: 's', name: 'Heat score', format: 'Count_Fourdigits', value: live.score, postfix: '%' },
    { id: 'h', name: 'Heat acclimation', format: 'Count_Fourdigits', value: live.pct, postfix: '%' },
    { id: 'd', name: 'Heat dose', format: 'Count_Fourdigits', value: cur ? Math.round(cur.dose * 100) : 0, postfix: '%' },
    { id: 'c', name: 'Peak core (est.)', format: 'Temperature_Fourdigits', value: (cur ? cur.peakTc : CT_START) + KELVIN }
  ];
}
