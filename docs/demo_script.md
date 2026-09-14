# HADR COMMAND — demo script (~12 min)

Audience framing: Defence told us they can *respond* to disasters but have no HADR
**early-warning dashboard** overlaying their estate with BOM data, critical public
infrastructure, and force readiness — and that during past cyclones staff were sharing
**printed maps**. This demo answers that call note-for-note, using only public data,
on the Databricks platform they already know.

## 0. Set-up (before the meeting)

- App open at the **Cairns** view, REPLAY mode, t = 66 (Wed 13 Dec 16:00 AEST —
  "destructive winds imminent"), SITREP drawer closed.
- Backend warm (first load takes ~20 s while the frame cache fills).

## 1. The common operating picture (2 min)

- Point at the top bar: **OFFICIAL** PSPF banner, phase chip, AEST clock.
- Walk the panels: layers (hazard / infrastructure / defence estate / impact),
  KPIs, force readiness (real ADF unit names, posture + readiness), alert feed
  (reconstructed BOM warning sequence).
- Talking point: *"Everything on this screen traces back to a governed Delta table in
  Unity Catalog — BOM best track, Overture building footprints, OurAirports runways,
  QLD road events. One platform, one security model, no printed maps."*

## 2. The 4D replay (3 min)

- Press **play at 4×** from t = 60. Narrate as it runs:
  - Cyclone eye + forecast cone crossing the coast near Wujal Wujal (t≈71) —
    readiness postures flip to RESPONSE, JTF 664 stands up (Dec 14).
  - Rain accumulates; **flood extent** grows along the Barron delta (t≈90+);
    road closures cascade — Captain Cook Hwy, Kuranda Range.
  - Pause at **t = 100** (Sun 17 Dec 22:00): *RECORD Barron River flood peak.*
- Talking point: *"This is a time-series lakehouse — 112 ticks, every layer keyed to
  the same spine. The slider is a dict lookup, not a query."*

## 3. Trucks, not runways (2 min) — the runway story

- At t = 100, click **YBCS Cairns International** (red = closed).
  The go/no-go matrix shows all four aircraft NO-GO — *"3,196 m of asphalt is useless
  under water. This is why they drove trucks."*
- Note the card footer: **YBTL Townsville OPEN — designated staging base.** Click the
  **Townsville** view preset: Lavarack Barracks, RAAF Townsville, 5 Avn all green.
- Scrub to t = 106: YBCS reopens **limited** — C-27J/C-130J GO, C-17A/KC-30A still
  NO-GO. *"Tactical airlift first; strategic lift waits."*

## 4. 3D damage picture (2 min)

- **Airport** or **Cairns** view, pitch the camera: extruded buildings colored by
  damage class (grey → yellow → orange → red → magenta), concentrated in Machans
  Beach / Aeroglen / Cairns North — where the real flood hit.
- Toggle **Damage density (hex)** for the aggregate view; mention 4,636 damaged
  buildings tracked per-tick with a rolling "assessed" sweep, like a real RDA.
- Talking point: *"Footprints are Overture Maps open data in Delta; damage is a
  transparent, seeded model — swap in UNOSAT or insurer feeds without touching the UI."*

## 5. LIVE mode (1.5 min)

- Flip **REPLAY → LIVE**: the scrubber collapses to a LIVE bar; the alert feed and map
  now show **today's** BOM QLD warnings and QLDTraffic events (60+ real FNQ road
  events on a typical day).
- ⚠ Pre-demo check: the QLDTraffic public key can be **429 rate-limited from the
  app's cloud egress IP** (BOM is unaffected). Hit `/api/status` beforehand — if
  `live_roads_fetched_at` is null, either demo LIVE from the locally-run app
  (residential IPs are fine) or lead with the BOM warnings feed.
- Talking point: *"Same tables, same UI — the replay is history, this is now. The
  pollers append every snapshot to Unity Catalog, so the next event builds its own
  replay automatically."*

## 6. AI SITREP (1.5 min)

- Back to REPLAY t = 100, hit **GENERATE SITREP**: Claude (via the Databricks
  Foundation Model API, in-workspace, no data egress) writes the five-section
  military brief from the current map state, with the AI caveat line.
- Talking point: *"The watchkeeper's 20 minutes of typing becomes a review task.
  And because it's FMAPI, the prompt and the data never leave the platform."*

## Q&A parries

- **"Is the flood real?"** — No satellite flood product exists for Jasper (no
  Copernicus activation; UNOSAT's was pre-landfall) — so it's a DEM-anchored model
  matched to the real Barron gauge record. The point is the *architecture*: when a
  real feed exists, it's one table swap.
- **"Classification?"** — Everything here is OFFICIAL/public. The pattern scales to
  PROTECTED on IRAP-assessed Databricks; above that, the same lakehouse design runs
  in an air-gapped enclave.
- **"What about other hazards?"** — The spine/layer_frames pattern is
  hazard-agnostic: bushfire, flood-only, Pacific HADR — new generator, same COP.

## Screenshots

`docs/screenshots/` — dev captures: `dev_tick66_fnq_approach.png` (approach),
`dev_tick96_cairns.png` / `dev_tick96_airport.png` (flood phase). Re-capture from the
deployed app after the Claude Design restyle.
