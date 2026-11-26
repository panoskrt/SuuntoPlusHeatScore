# Changelog

## 2026-11-26

### Changed
- In the simulator, the Temperature slider now drives the feels-like temperature, score and
  status. The simulator's weather is a fixed 20 °C mock, which kept the score at *No heat stress*
  whatever the inputs; the app now recognises that mock and uses the Temperature input as the air
  temperature instead (the mock weather until the slider is first moved, since the simulator
  sends no temperature before that). Real weather on the watch is unaffected.
- The displayed strain follows HR within about 10 seconds (smoothed HR) instead of once a minute.
  The caution status and the strain alert still use whole-minute strain.
- The workout summary has 4 values instead of 5: *Adapted to* is dropped (the acclimation %
  carries the same information). The simulator logged "Too many summary outputs, maximum is 4".

### Fixed
- Simulator failed to start with "Illegal return statement". The simulator patches the first
  `return function` in the minified `main.js`, assuming it is the minifier's wrapper; two helper
  factories that returned closures were hit instead. They are now plain callbacks.

### Added
- Heat acclimatization model: estimated core temperature (ECTemp, Buller et al. 2013) from HR
  × apparent temperature (NWS heat index from phone weather) gives a per-workout heat dose. An
  exposure model with VO2max speed-up and ~2.5%/day decay turns the doses into an adapted
  temperature. Cardiac drift and post-heat sleeping HR/HRV provide physiological evidence.
- Score screen (`t.html`): feels-like temperature, 0–100 score with bar, status, adapted
  temperature, live heat strain (PSI) and estimated core temperature.
- Last 7 days graph (`g.html`): daily acclimation % and heat dose.
- High heat strain alert (`a.html`) at PSI ≥ 9 or estimated core ≥ 39.5 °C.
- Workout summary: heat score, acclimation, adapted temperature, heat dose, peak core.
- README with the algorithm, data sources, tuning, limitations and references.
