# Hundredths precision and dynamic achievements

Date: 2026-07-31. Approved by Andries in-session.

## Problem

1. Weights are stored with 0.01 kg precision (`parseWeightToKg` rounds to two
   decimals) but the UI renders everything with `toFixed(1)`, the edit prefill
   truncates stored hundredths, and the keypad's 4-digit cap makes a value
   like 102.15 untypeable.
2. The "kg down" stat and milestone checkmarks derive from the lowest weight
   ever recorded (`floor(startW - minW)`), so an achievement survives regaining
   the weight. After bouncing back above the start weight the app still says
   "1 kg down".

## Design

### Hundredths

- New pure helper `fmtWeight(n)` in `logic.js`: render with two decimals,
  trim one trailing zero. 82.5 → "82.5", 82.15 → "82.15", 82 → "82.0".
- `fmt()` and all delta strings in `app.js` (draft delta, history delta,
  week-over-week delta) use it. The week-delta "flat" check compares against
  "0.0", which is exactly what `fmtWeight(0)` trims to.
- Keypad: 5 digits total, at most 2 after the decimal point.
- Edit prefill keeps full precision: round the displayed unit value to two
  decimals instead of `toFixed(1)`.

### Dynamic achievements

- New pure helper `kgLost(startKg, currentKg)` in `logic.js`:
  `max(0, floor(startKg - currentKg))`.
- `computeView` bases `doneK` (the "kg down" stat and the 2/4/6/8 milestone
  checkmarks) on the latest weigh-in, not the all-time minimum. The Goal
  milestone checkmark likewise flips to `last.weightKg <= goal`.
- Achievements therefore revoke themselves when weight is regained and return
  when it is lost again.
- The one-time celebration toast still fires only on genuinely new lows
  (unchanged), so re-crossing an old milestone does not re-celebrate.

## Out of scope

Chart axis tick formatting (already unit-aware), sync format (unchanged),
lbs rounding of milestone labels.

## Testing

Node test suite: `fmtWeight` trimming cases, `kgLost` gain/loss/regain cases.
Existing suite must stay green.
