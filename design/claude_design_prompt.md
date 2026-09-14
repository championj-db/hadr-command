# Design brief: HADR COMMAND — Disaster Response Common Operating Picture

Design the complete UI for **HADR COMMAND**, an early-warning and disaster-response common operating picture (COP) for the Australian Defence Force. It overlays live weather hazards, Defence estate locations, critical public infrastructure, and force readiness on a 3D map, and can replay a historical cyclone in 4D (time-scrubbed). The demo scenario is **Tropical Cyclone Jasper, December 2023, Cairns / Far North Queensland**.

There is no existing UI — this is a greenfield design that engineers will implement directly, so your output is the source of truth for the frontend build.

## What to deliver

1. **A high-fidelity static mock** (HTML/CSS, desktop 1920×1080, light + dark theme) of the main screen with all panels populated using the realistic content below. The central map region should be a placeholder (dark satellite-style image or gradient) — the real map is a live WebGL canvas; you are designing everything around and on top of it.
2. **Design tokens**: semantic color palette (Tailwind-compatible), type scale, spacing, radii, elevation/shadow, and a separate set of **map-layer colors as RGBA values** (these feed deck.gl layers directly, not CSS).
3. **Component states**: each component below in its default / hover / active / alert states.
4. **Motion notes**: what animates, durations, easing. Keep motion subtle and purposeful.

## Audience and setting

Military watchkeepers and operations staff in a joint operations room. The screen is used two ways: **projected on a wall** (must be glanceable from 4 metres — big numbers, unambiguous status colors) and **worked at a desk** (dense detail on demand via panels and click-cards). Users are stressed, time-poor, and allergic to anything that looks like a video game.

## Tone

Ops-room: calm, authoritative, precise. High information density with strong hierarchy — never cluttered. Neutral surfaces (dark by default, with a light counterpart) and a restrained accent palette; status colors carry the meaning. Explicitly avoid: sci-fi/neon HUD styling, glassmorphism, decorative glows, gamer aesthetics. Think "professional mission system", closer to an air-traffic or maritime domain-awareness console than a consumer dashboard.

Typography: a clean UI sans (e.g. Inter or IBM Plex Sans); **tabular/monospaced numerals for all timestamps, coordinates, and KPI figures** (e.g. IBM Plex Mono / JetBrains Mono). Uppercase micro-labels with letter-spacing for section headers is on-tone.

## Screen layout (1920×1080 reference)

- **Classification strip** (very top, full width, ~24px): the PSPF marking `OFFICIAL` centered. Understated but unmissable; it must not read as decoration. Also repeated at the very bottom edge (~20px).
- **Top command bar** (~56px): left — product mark `HADR COMMAND` with a small subtitle "Disaster Response COP"; center — **event context**: "TC JASPER — FNQ" plus the current **phase chip** (one of `WATCH` / `WARNING` / `IMPACT` / `RECOVERY`, changes as time is scrubbed); right — **REPLAY ↔ LIVE mode toggle** (REPLAY is the default; LIVE switches feeds to real-time BOM/road data — make the active mode unmistakable), then the scrub clock: `Sun 17 Dec 2023 06:00 AEST` in mono.
- **Left panel — Layers** (~300px, collapsible to icon rail): layer toggles in four groups, each toggle with a small legend swatch/glyph and an on/off switch:
  - HAZARD: Cyclone track & forecast cone · Wind field · Rainfall · Flood extent
  - INFRASTRUCTURE: Airports & runways · Roads (by status) · Hospitals · Ports · Power
  - DEFENCE ESTATE: Bases & facilities (with readiness pips)
  - IMPACT: Building damage (3D) · Damage density (hex)
  - Footer of panel: basemap selector (Satellite / Dark) and a 2D/3D pitch toggle, plus view presets: FNQ · Cairns · Airport · Townsville.
- **Right panel — Ops stack** (~360px, three stacked cards, independently collapsible):
  1. **KPI strip** (2×3 grid of stat tiles): Population in warning area `~168,000` · Roads cut `14` · Runways open `1 / 2` · Buildings damaged `3,412` · Units ready `6 / 8` · Warnings active `7`. Each tile: big mono number, micro-label, small trend/delta where sensible (e.g. "▲ 3 since 03:00").
  2. **Force readiness**: list of 8 units, each row = unit name, home base, readiness bar/percentage, posture tag (`BASELINE` / `WARNING` / `RESPONSE` / `SURGE`), and a one-line constraint. Sample rows below.
  3. **Alert feed**: reverse-chronological feed of BOM warnings and road closures with severity glyph, source tag (`BOM` / `QLDTRAFFIC`), headline, and time. Newest entry subtly emphasized.
- **Bottom — Time scrubber** (~96px, the "4D" control, overlaid on the map region's lower edge): a timeline from **Dec 5 to Dec 18 2023** with colored **phase bands** (approach → landfall → flood → recovery), **event markers** with flags (⚑ Landfall Wujal Wujal — Dec 13 · ⚑ Cairns Airport CLOSED — Dec 17 · ⚑ Barron River peak — Dec 17–18 · ⚑ Airport reopened — Dec 18), a draggable playhead, play/pause, and speed control (1×/4×/12×). In LIVE mode the scrubber collapses to a slim "LIVE — last updated 06:04" status bar.
- **Map** (everything behind/between the panels): full-bleed. Floating on it: compass/pitch/zoom control cluster (bottom-right above scrubber), active-layer legend chips (bottom-left), and a small scale bar.

Panels float over the map with solid (not translucent-blurry) surfaces; collapsed states give the map ~90% of the screen.

## Click-cards (design all four as floating cards anchored to map features)

1. **Airport / runway suitability** (the hero card — design this one in full): header `YBCS — Cairns International`, status badge (`OPEN` / `LIMITED` / `CLOSED` with reason, e.g. "CLOSED — flooding, crosswind 42 kt"), runway facts line (`RWY 15/33 · 3,196 m · asphalt · lighted`), then a **go/no-go matrix**: rows C-17A · C-130J · KC-30A · C-27J, each with required runway length, and a clear go (✓) / no-go (✕) state that flips when the airport closes. Footer note: "YBTL Townsville OPEN — designated staging base".
2. **Defence base**: name (`HMAS Cairns`), service glyph, units based, readiness summary, "in flood extent" hazard flag when applicable.
3. **Building**: damage class badge, cause (wind/flood), assessed-by-RDA timestamp, height/floors.
4. **Road event**: road name, `CLOSED — Flooding`, source, since-when.

## SITREP drawer

A right-side slide-over (~480px) triggered by a prominent `GENERATE SITREP` button in the top bar. Contents: generated military-style situation brief (sections: SITUATION · WEATHER · INFRASTRUCTURE · FORCE ELEMENTS · ASSESSMENT) rendered with clear typographic hierarchy, a "Generated by AI — verify before release" caveat line, timestamp, and Copy / Download actions. Include a generating state (skeleton lines, not a spinner-only).

## Visual encoding rules (bind these to tokens)

- **Phases**: WATCH (cool blue) → WARNING (amber) → IMPACT (red) → RECOVERY (green). Used by the phase chip and scrubber bands.
- **Building damage ramp** (must be colorblind-safe, readable on dark satellite): none (neutral grey) → minor (yellow) → moderate (orange) → severe (red) → destroyed (deep magenta/dark red). Same ramp for the hex density layer.
- **Readiness/posture**: readiness % as green→amber→red; posture tags as neutral chips with a colored dot, not full-color pills.
- **Roads**: open (green), caution (amber), closed (red, dashed on-map).
- **Wind field**: single-hue sequential ramp (light → intense) that doesn't fight the damage ramp; **flood extent**: semi-transparent blue with a defined edge.
- **Severity glyphs** in the alert feed: consistent icon set, filled = current, outline = expired.
- **LIVE mode**: a distinct but restrained signal (e.g. red "LIVE" dot pulse ≤ 1Hz) — the only permitted pulsing element besides active warnings.

## Sample content for the mock (use verbatim — realism matters)

Force readiness rows:
- `HMAS Cairns` — Navy fleet base, Cairns — 82% — `RESPONSE` — "Wharf access limited — flood"
- `51 FNQR` — Porton Barracks, Cairns — 91% — `SURGE` — "Local recon tasking"
- `3 Bde (3 CSSB)` — Lavarack Barracks, Townsville — 88% — `RESPONSE` — "Convoy staging"
- `5 Avn Regt` — Townsville — 74% — `RESPONSE` — "2 × MRH-90 tasked"
- `27 SQN` — RAAF Townsville — 90% — `RESPONSE` — "Airfield ops normal"
- `35 SQN (C-27J)` — Amberley — 93% — `WARNING` — "On 12 hr notice to move"
- `36 SQN (C-17A)` — Amberley — 95% — `WARNING` — "On 24 hr notice to move"
- `JTF 664 HQ` — Townsville — stood up 14 Dec — `RESPONSE` — "Coordinating DACC tasks"

Alert feed entries:
- `BOM · 05:47` — Major Flood Warning: Barron River — record level expected at Myola
- `QLDTRAFFIC · 05:31` — Captain Cook Hwy CLOSED — flooding, Aeroglen to Smithfield
- `BOM · 04:58` — Severe Weather Warning: heavy rainfall, FNQ coast and tablelands
- `QLDTRAFFIC · 04:12` — Kennedy Hwy (Kuranda Range) CLOSED — landslip
- `BOM · 03:00` — Flood Warning: Daintree, Mossman and Mowbray Rivers

## Technical constraints (hard)

- Implementation stack: **React + Tailwind + shadcn/ui**; the map is a **deck.gl v9 canvas over MapLibre** filling the map region. Design chrome around/over it; never style "into" the map beyond the RGBA layer colors you specify.
- Both **light and dark themes**, driven by the same semantic tokens (dark is the primary/ops-room default; light must hold up in a bright briefing room). WCAG AA contrast for all text and status colors on their actual surfaces in both themes.
- All UI colors, spacing, and type as named tokens; map-layer colors as RGBA arrays alongside (specify per-theme map-layer values where the basemap change demands it).
- Must degrade gracefully to 1440×900 (panels narrow, KPI grid reflows 3×2 → 2×3).
- No login screen, no mobile, no additional pages — one screen, its panels, cards, and the SITREP drawer.
