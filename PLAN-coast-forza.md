# Coast garages → Forza Horizon look

Working plan, one phase at a time: each phase gets before/after screenshots from the same
views and a review before the next one. Delete this file when every phase is done.

Reference views: the user's 5 screenshots (2026-09-27), Coast Overlook, AMG ONE.

## Phase 1 — quick wins (lighting, lens, grade) ✅ done
- [x] Headlamp/taillamp spots fade out in daylight (`LampSystem.setDaylight`, from the sun's
      elevation, −6°…6°); lens glow stays
- [x] Depth of field: thin-lens CoC (`post.ts` `lensCoc`): near leaves blur hard, background
      levels off at ~⅓; coast aperture 0.7 → 3.5
- [x] Grade: `lift` per look (half gain, half fill in the shadow tint: teal, not black-green);
      daylight look punchier; golden look less acid (blue was ~0 in sunlit grass)
- [x] Inland haze: coast air 8e-5 over a 1 km layer (was 4.5e-5 / 600 m)
- [x] Terrace stone albedo ~0.2 → ~0.16 (near white at noon)
- Deferred: shade is still dark because the sky fill is weak (sunlit:shade ≈ 9:1 at golden
  hour, 14:1 at noon, through the tone mapper; ~2–5:1 would be right). A sky-light
  recalibration touches Fuji too (`OUTDOOR_SKY_LIGHT`); do it with Phase 6 (foliage AO).

## Phase 2 — tropical woods ✅ done
- [x] `flora.ts`: species per landscape (temperate = Fuji, unchanged; tropical = coast). Tropical
      presets reshaped from ez-tree's: rain tree and fig (broadleaf), kapok and albizia (the
      layout's tall kind: emergents; evergreen growth, no leader spike). No pines on the coast
- [x] Impostor atlas built from the flora's species; tropical leaf palette (deeper, bluer)
- [x] Palms: valley palms in groups of 3–7 leaning out from each other, mixed ages, undergrowth
      at their feet (< 600 m); longer fronds and more lean on slender/coconut palms

## Phase 3 — terrain and cliffs ✅ done
- [x] Rock faces: strata in the terrain shader (level beds ~1.7 m, own shade per bed, lit tops,
      shaded feet, dark joints, bed-profile normals, streaks, half-sky occlusion); the rocks
      share the beds' tones. (The grid is ~6–8 m at 300–600 m, so faces stay shader relief.)
- [x] Outcrops: rows of low, half-buried slabs along the contour on steep hillsides (a stratum
      breaking out), talus below them
- [x] Hills: erosion spurs/hollows (ridged, ±8 m) past 220 m, off the garage's ground
- Not done: paths; ground scale cues were already in the lawn shader (pebbles, bare soil)

## Phase 4 — clouds
- [ ] Grey flat bases, sun-lit tops, wispy edges, layers (cumulus + cirrus)
- [ ] Colour from sun elevation (no pink at midday)
- [ ] The lone round "moon" blob (image 4)

## Phase 5 — set dressing and context
- [ ] Road to the pad (asphalt, markings, kerb) joining the coast road
- [ ] Pad bevel, joints, wear, edge dirt
- [ ] Props for scale (bollards, light poles, signage)

## Phase 6 — near foliage
- [ ] Textured, normal-mapped leaves (CC0 scans), roughness/sheen, translucency
- [ ] AO gradient inside bushes (shaded side not a black blob)
