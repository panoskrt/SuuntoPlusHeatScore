# HeatAccli - SuuntoPlus App Heat Acclimatization Score
A rough indicator of heat acclimatization, shown as a simple score.

HeatAccli is a SuuntoPlus sports app for Suunto watches. It estimates how well you are
acclimatized to the heat you are in right now. During each workout it estimates your core
temperature from heart rate and combines it with the current "feels like" temperature to
measure the heat stimulus. It builds those workouts into an adapted temperature, then checks
that against how much your heart rate drifts in hot workouts and how you sleep after them. The
result is a 0–100 score for the current conditions. It also shows live heat strain, graphs
the last 7 days, and alerts you when strain gets high.

> **Not a medical device.** The score and the core temperature are estimates built from
> population models and published studies. They cannot diagnose or rule out heat illness.
> Stop and cool down if you feel dizzy, confused, nauseous or stop sweating.

## Contents

- [Screens](#screens)
- [Heat strain alert](#heat-strain-alert)
- [Workout summary](#workout-summary)
- [How it works](#how-it-works)
- [Data sources](#data-sources)
- [Tuning](#tuning)
- [Project structure](#project-structure)
- [Building and installing](#building-and-installing)
- [Limitations](#limitations)
- [References](#references)
- [License](#license)

## Screens

### Score screen (`t.html`)

| Element | Meaning |
| --- | --- |
| **Feels like** | Current apparent temperature: the NWS heat index from the phone-synced weather. |
| **Score** | 0–100: how acclimatized you are to the current conditions. 100 at or below 22 °C. |
| **Score bar** | Fills to the score; red below 40, orange 40–74, green 75 and up. |
| **Status** | *No heat stress* (≤ 22 °C), *Not acclimatized* (<40), *Acclimatizing* (40–74), *Acclimatized* (75+), *No temperature data*, or a caution: *high heat strain*, *extreme heat*, *poor heat recovery*. |
| **Adapted to** | The apparent temperature your body is currently adapted to. |
| **Strain / Core** | Live Physiological Strain Index (0–10, follows HR within ~10 s) and estimated core temperature (updated each minute). |

Press the **lower button** to open the graph.

### Last 7 days (`g.html`)

One column per calendar day, oldest on the left:

- **Bar and number:** heat acclimation at the end of the day, as a percentage of full
  acclimation to 35 °C. It uses the same colours as the score bar.
- **Orange square under the axis:** that day's heat dose. It grows with the dose, up to
  1.5 sessions.

Press the **lower button** again to return to the score screen.

## Heat strain alert

The app plays a tone/vibration and opens a **"High heat strain"** popup (`a.html`) when the
Physiological Strain Index reaches 9 ("very high"), or when estimated core temperature reaches
39.5 °C. It repeats at most every 10 minutes while strain stays high. It re-arms once PSI drops
below 7. The status reads *Caution: high heat strain* from PSI 8.

## Workout summary

| Field | Value |
| --- | --- |
| Heat score | Score at the end of the workout (%). |
| Heat acclimation | Acclimation as % of full acclimation to 35 °C. |
| Heat dose | This workout's heat stimulus (100% = one full heat-acclimation session). |
| Peak core (est.) | Highest estimated core temperature. |

The summary holds at most 4 values: the simulator rejects more, and the SuuntoPlus reference
warns that the practical limit is around 4–5.

## How it works

Everything is expressed as an **adapted temperature A**: the apparent temperature your body is
currently adapted to. Everyone counts as adapted up to **T0 = 22 °C**, the threshold Garmin uses
for heat acclimation. This mirrors the adapted altitude in
[AltiAccli](../SuuntoPlusAltitudeScore).

### 1. Heat dose: the stimulus

Heat acclimation is driven by repeated daily exposures that raise **both core and skin
temperature**, typically 60–90 min at a core temperature of about 38.5 °C (Périard et al. 2015;
Taylor 2014). Most watches have no core temperature sensor, so the app estimates it every
minute:

1. **Altitude correction.** The part of heart rate caused by hypoxia is removed: 6% per km above
   1000 m.
2. **Effort normalisation.** HR is mapped onto the ECTemp study population's heart rate
   reserve (60–190 bpm) using your resting HR and max HR.
3. **ECTemp.** A Kalman filter estimates core temperature from that heart rate. ECTemp is the
   US Army (USARIEM) model from Buller et al. (2013); it has a bias of about −0.03 °C and 95%
   limits of agreement of ±0.63 °C.

```
minute dose = clamp((Tcore − 37.5) / (38.5 − 37.5)) × clamp((Tfeels − 22) / (32 − 22)) / 60
```

So 60 minutes at 38.5 °C core in feels-like ≥ 32 °C is **one full session (dose 1)**. A
workout is capped at 1.5. Hot conditions with low effort give little dose, and so does hard
effort in cool conditions.

### 2. Exposure model: the prior

Each workout pulls A toward that workout's dose-weighted apparent temperature:

```
A ← A + (Tsession − A) × (1 − exp(−dose × speed / 4.5))
```

- **Time course:** 4.5 full sessions is the time constant. Daily full sessions give about 67%
  after 5 days and about 90% after 10–14 days. This matches the HA literature: most heart rate
  adaptation in the first week, thermoregulatory adaptation complete in 10–14 days (Périard
  et al. 2015). It also matches Garmin's "1 to 2 weeks".
- **Fitness:** `speed` rises from 1 at VO2max ≤ 45 to 2 at ≥ 70 ml/kg/min. Garmin notes that
  athletes with a high VO2max can adapt in as little as half the time.
- **Specificity:** A only moves toward the temperature you actually exercised in. Training at
  26 °C does not make you ready for 38 °C.
- **Decay:** between workouts, A decays back toward 22 °C with a 40-day time constant, which is
  about 2.5% of the adaptation per day (Daanen et al. 2018 meta-analysis).

### 3. Physiology: the evidence

| Marker | Compared with | Weight |
| --- | --- | --- |
| **Cardiac drift** (aerobic decoupling: output per heartbeat, second vs first half of a steady workout after a 10-min warm-up) in hot workouts | Your median decoupling in cool workouts. Unacclimatized, decoupling is expected to rise by 0.5 points per °C above 22 °C; once acclimatized, 25% of that excess remains | up to 0.5, ⅓ per workout (last 3 hot workouts within 7 days, fading with age) |
| **Minimum sleeping HR** the night after a heat workout | Mean of your nights without recent heat; a 5 bpm rise reads as "not adapted" | 0.15 |
| **Average sleeping HRV** the night after a heat workout | Same baseline; a 20% drop reads as "not adapted" | 0.15 |

Lower exercising HR and less cardiovascular drift come from plasma volume expansion and
earlier, greater sweating. They are the classic field signs of heat acclimation (Périard et al.
2015). Buchheit et al. (2011) tied changes in HR and HRV to plasma volume gains during a week
of training in the heat.

Each marker becomes a fraction from 0 (not adapted to that workout's heat) to 1 (adapted), and
from that an estimate of A. **A** is the weighted mean of the exposure model (weight 1) and these
estimates. Physiology can lift A by at most half of the gap above the exposure model.

### 4. Score

```
score = 100 × clamp(1 − (Tfeels − A) / max(Tfeels − 22 °C, 8 °C))
```

The 8 °C floor keeps mildly warm days from swinging between 0 and 100. **Heat acclimation %**
(graph and summary) is `(A − 22) / (35 − 22)`.

### Cautions

They replace the normal status, in this order of priority:

1. **High heat strain:** PSI ≥ 8 during the workout. PSI = 5·(Tc − 37.1)/(39.5 − 37.1) +
   5·(HR − HRrest)/(HRmax − HRrest), from Moran et al. (1998). It uses your max HR, and your
   resting HR from sleep data.
2. **Extreme heat:** feels-like ≥ 40 °C, the start of the NWS "danger" range.
3. **Poor heat recovery:** the night after heat exposure, sleeping HR is more than 8 bpm above
   baseline or HRV is more than 30% below it.

### Simulated behaviour

A 42-day simulation (`node`, stubbed watch APIs) gave these results. The athlete did 10 cool
runs, then 12 daily 75-min runs at 33 °C / 50% RH (heat index 36 °C), then ran every other day
in the cool.

| Day of heat block | 1 | 3 | 5 | 7 | 10 | 12 | +7 days off | +19 days off |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Acclimation % | 27 | 54 | 73 | 85 | 95 | 98 | 78 | 58 |
| Score at 36 °C | 25 | 49 | 66 | 77 | 86 | 89 | — | — |

## Data sources

The resources documented for sports apps carry no weather or wellness history. However, the
watch exposes the data its own widgets use. These undocumented resources are read with `$.get`
from `main.js` rather than listed in the manifest. A missing manifest path stops an app from
loading, whereas a missing `$.get` path just never answers, so the app falls back gracefully.

| Resource | Used for |
| --- | --- |
| `Dev/Time` (manifest) | Current time (UTC). |
| `Activity/Exercise/State` (manifest) | Only minutes of a running workout count. |
| `Activity/Move/-1/HeartRate/Current` (manifest) | Core temperature estimate, dose, PSI, drift. |
| `Activity/Move/-1/Speed/Current`, `…/Power/Current` (manifest) | Output for cardiac drift (power when present). |
| `Activity/Move/-1/Temperature/Current` (manifest) | Fallback when there is no weather: wrist temperature − 4 °C, minus a further °C per °C below 30 °C (skin heat). |
| `Fusion/Altitude` (manifest) | Altitude HR correction. |
| `/Weather/Current/ValidWeatherData` | `temp`, `humidity` (→ heat index), `feelsLike`, `dt`. Values in K. Ignored when older than 3 h. The simulator's fixed mock weather is recognised by its exact wind, visibility and rain values; with it, the Temperature input is used as the air temperature. |
| `/Daily/Sleep/{0..-6}/Data` | `minimumHr`, `averageHrv`, `startTimeUTC`, `endTimeUTC`, `duration`. |
| `/Settings/User/MaxHR` | PSI and HR normalisation. |
| `/Activity/History/Last/MaxVO2` | Acclimation speed. |
| `/Settings/Unit/UnitsMode` | Core temperature in °C or °F. |
| `/Dev/Time/LocalTime` | Calendar days in the graph. |

Data is re-read every 10 minutes while the app runs. The last 40 workouts (dose, temperatures,
drift, peak core temperature, peak strain), the last 21 nights and the alert state are kept in
`localStorage` (`heataccli_state_v1`). Per-minute samples stay in memory only.

## Tuning

All constants are at the top of [`main.js`](main.js) with comments. The most relevant:

| Constant | Default | Meaning |
| --- | --- | --- |
| `T0` | 22 °C | Apparent temperature everyone counts as adapted to. |
| `T_REF` | 35 °C | Reference for the acclimation %. |
| `ENV_FULL` | 32 °C | Feels-like giving the full environmental stimulus. |
| `TC_LOW` / `TC_HIGH` | 37.5 / 38.5 °C | Core temperature ramp of the stimulus. |
| `K_DOSE` | 4.5 sessions | Acclimation time constant. |
| `TAU_DECAY` | 40 days | Decay time constant (~2.5%/day). |
| `VO2_LOW` / `VO2_HIGH` | 45 / 70 | VO2max range for the 1× → 2× speed-up. |
| `DRIFT_PER_C`, `DRIFT_RESIDUAL` | 0.005, 0.25 | Expected decoupling excess per °C and the acclimatized residual. |
| `W_DRIFT`, `W_NIGHT_HR`, `W_NIGHT_HRV` | 0.5, 0.15, 0.15 | Evidence weights. |
| `MAX_PHYS_LEAD` | 0.5 | Share of the gap physiology may close above the exposure model. |
| `PSI_CAUTION` / `PSI_ALERT` / `TC_ALERT` | 8 / 9 / 39.5 °C | Strain caution and alert. |
| `ALT_HR_PER_KM` | 0.06 | HR share per km above 1000 m attributed to altitude. |

## Project structure

| File | Purpose |
| --- | --- |
| [`manifest.json`](manifest.json) | App metadata, 7 inputs, 20 outputs (the build tool's maximum), 3 templates. |
| [`main.js`](main.js) | ECTemp, dose, exposure model, evidence, alert and view switching (ES5, no `Date`). |
| [`t.html`](t.html) | Score screen. |
| [`g.html`](g.html) | Last 7 days graph (canvas). |
| [`a.html`](a.html) | Heat strain popup. |

The 20 outputs:

- `score`, `adaptedTemp` and `apparentTemp` (K), `coreTemp` (°C/°F, one decimal),
  `strain`, `status`;
- `dayAccl0..6` and `dayDose0..6` for the graph (index 0 = today).

## Building and installing

You need [Visual Studio Code](https://code.visualstudio.com/) with the **SuuntoPlus Editor**
extension.

1. Open this folder in VS Code.
2. Run **SuuntoPlus: Build SuuntoPlus App**, or **SuuntoPlus: Open SuuntoPlus Simulator**.
3. In the simulator, test with the **Data source** sliders:
   - The simulator copies `main.js` only when its panel opens. After changing `main.js`, close
     the simulator panel and open it again; **Start** alone keeps running the old copy.
   - The simulator always serves the same mock weather (20 °C, 43 %). The app recognises it and,
     once you move the **Temperature** slider, uses the slider as the air temperature instead.
     *Feels like*, *Score*, the bar and the status then follow it within a second. Until the
     slider is moved the simulator sends no temperature, and the 20 °C mock weather is shown.
     The slider stops at 300 K (26.85 °C); press **+** next to it to raise the maximum.
   - **Strain** follows the **HeartRate** slider within about 10 seconds. Keep **State** at 1
     (running): paused minutes don't count.
   - **Core** is a model of a slow body temperature and changes once a simulated minute, by a few
     hundredths of a degree at a high HR. Run the simulation for a while, or play a workout file.
   - **Adapted to** and the graph change only after at least 10 minutes in the heat (feels-like
     above 22 °C) with a raised HR.
4. Run **SuuntoPlus: Deploy Default App To Watch** with the watch connected.
5. On the watch, add **HeatAccli** to a sport mode's SuuntoPlus slot and start a workout.

Headless build:

```bash
node ~/.vscode/extensions/suunto.suuntoplus-editor-<version>/node_modules/@suunto-internal/suuntoplus-tools/bin/build-app.js --appID <id> --input "$PWD" --output /path/to/out
```

Pass an absolute `--input` path, and check that the output folder contains `.fea` files.

For full functionality the phone must sync weather to the watch, and sleep tracking (ideally
with HRV) should be on.

## Limitations

- **The app only learns during workouts that have it active.** Heat exposure outside them
  (other workouts, living or working in the heat, saunas, hot baths) is not counted, so the
  score is conservative for people who live in hot climates. Real-world evidence (drift, sleep)
  partly corrects for this.
- **ECTemp** was built on a population of young soldiers. Individual errors can exceed 0.6 °C,
  especially in very hot or very cold conditions, during intervals, and after stopping. The
  heart-rate-reserve normalisation is a reasonable assumption, not a validated part of the
  model.
- **Weather** comes from the nearest forecast point, not your exact location or altitude. Sun
  (solar load), radiant heat and wind are not modelled beyond OpenWeather's feels-like. The
  wrist-temperature fallback ignores humidity and is rough.
- **Cardiac drift** is noisy. Hydration, fatigue, terrain, pacing and caffeine all affect it.
  That's why it needs steady workouts of ≥ 40 min and carries limited weight.
- Weather, sleep, VO2max and history resources are not documented for sports apps. They exist
  in the simulator and in the firmware's own widgets, but are not confirmed on a physical
  watch. Without them the app uses the exposure model and the wrist sensor.
- The drift and sleep thresholds are approximations assembled from the studies below, not
  validated cut-offs.

## References

- Buller MJ et al. (2013). Estimation of human core temperature from sequential heart rate
  observations. *Physiol Meas* 34:781–798. Coefficients from US patent 10,702,165.
- Moran DS, Shitzer A, Pandolf KB (1998). A physiological strain index to evaluate heat stress.
  *Am J Physiol* 275:R129–R134.
- Périard JD, Racinais S, Sawka MN (2015). Adaptations and mechanisms of human heat
  acclimation. *Scand J Med Sci Sports* 25(S1):20–38.
- Daanen HAM, Racinais S, Périard JD (2018). Heat acclimation decay and re-induction: a
  systematic review and meta-analysis. *Sports Med* 48:409–430.
- Buchheit M et al. (2011). Physiological and performance adaptations to an in-season soccer
  camp in the heat: associations with heart rate and heart rate variability. *Scand J Med Sci
  Sports* 21:e477–e485.
- Taylor NAS (2014). Human heat adaptation. *Compr Physiol* 4:325–365.
- Rothfusz LP (1990). The heat index equation. NWS Technical Attachment SR 90-23.
- Garmin, *Heat and Altitude Acclimation*:
  [running](https://www.garmin.com/en-US/garmin-technology/running-science/physiological-measurements/heat-and-altitude-acclimation/),
  [cycling](https://www.garmin.com/en-US/garmin-technology/cycling-science/physiological-measurements/heat-and-altitude-acclimation/).

## App metadata

- **Name:** HeatAccli
- **Version:** 1.0
- **Type:** SuuntoPlus feature app
- **Usage:** Workout
- **Author:** Panagiotis Kritikakos

## License

GNU General Public License v3.0, as AltiAccli. See [LICENSE](LICENSE).
