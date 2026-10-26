# Soul Library Covers — Style Block (PLT shelf style)

One consistent style across all 30 covers, so the shelf reads as one set.
Recorded Oct 25, 2026. Owner pick: generated art in a consistent PLT style
(not typographic covers).

## Shared style (every cover prompt includes this)

- Portrait book cover, 2:3 orientation.
- Deep black background.
- Original illustration with neon glow. NEVER a photo of a real person,
  NEVER a real trademark, NEVER a real brand mark, NEVER a real logo.
- Dominant neon accent = the book's own manifest color (see
  `data/manifest.json`, the `color` field), with hot-pink (#FF007A) and
  cyan (#00F0FF) neon highlights and subtle gold details throughout.
- A small, subtle `222` motif in one corner.
- Large, bold, clean, readable title text with the EXACT book title,
  placed prominently.
- Small text at the bottom: `PLT PRESS`.
- No watermark, no barcode, no extra text beyond title + `PLT PRESS`.

## Per-book subjects (original art only)

| id | subject |
|---|---|
| the-first-calculation | A giant glowing calculator/counter on a city block at night, twelve tally marks, gold coins, pink/cyan neon |
| the-calculation | A stark glowing equation triangle (Profit / Love / Tax) over a boardroom table, three balance scales |
| know-what-you-are | A hall of mirrors: one figure facing many archetype reflections |
| profit-love-tax | Three glowing accounts: a stack of gold coins, a heart, a tax ledger with scales, triangle composition |
| the-soul-economy | A mirror market: a glowing ledger beneath a street market, soul notes as golden slips of light |
| the-plt-daily | A 52-week calendar spiral and a daily practice journal with a pen, morning light, neon accents |
| evols-love-story | A suitcase of four glowing vials (gold, red, blue, white) on a stoop at predawn, a hooded figure in shadow |
| brasi | A private session room: two chairs, a single glowing vial on a table, warm lamp light |
| pope | A young man on a stoop at dawn, the block waking, listening pose, warm gold light |
| the-build | Two figures back to back on a stoop, dual pink/cyan glow, two instruments playing together |
| the-frequency | A barber's chair, clippers and mirror, frequency waves drawn as light |
| stiforp | A cracked gold vial with dark veins over a flooded block at night, red warning glow |
| the-ledger | A live score ticker over a street-corner conversation, glowing P / L / T numbers |
| the-deal | Two hands in a street deal over a table, score annotations glowing |
| conversations-of-a-dealer | A counter at night, two figures talking, honest quiet mood, neon street light |
| the-9-dominant-plt-moves | Nine glowing move markers arranged as a triangle over a house showing: keys, an open door |
| the-scorer-street | A street corner at night, a glowing crown of reputation above a figure, loyalty chains |
| the-scorer-cold-calling | A phone receiver with a glowing 30-second timer ring, cold blue/pink neon, office at night |
| the-scorer-bdm | A long bridge of light over changing seasons, a distant handshake, a pipeline of light |
| the-scorer-real-estate | A house key and a kitchen-table conversation, a glowing sold sign |
| the-scorer-loan-officer | A file folder holding a house together, desk lamp, papers, a steady hand |
| the-scorer-leadership | A leader standing in a doorway, the room's scores visible as light around people |
| the-scorer-politics | A campaign room: donor table, podium silhouette, glowing scoreboard |
| the-scorer-relationships | A couple at a kitchen table late at night, two coffee cups, dishes in the sink, tender quiet |
| the-internal-scorer | A single figure alone before a mirror, thought lines drawn as score lines, pre-conversation |
| the-scored-marriage | Two wedding rings over a scored conversation card, warm home light |
| the-apprentice | A master and apprentice at a workbench, tools, passing a glowing instrument |
| the-frequency-hip-hop | A cypher circle, a microphone with glowing score bars, boombox glow |
| miss-patricia | A classroom at golden hour, a teacher's desk, a chalkboard with precise handwriting, quiet authority |
| how-to-read-this-series | An open map/guidebook with two lanes diverging, a compass rose, a shelf of glowing books |

## Wiring

- Files live in `covers/<manifest-id>.jpg` (e.g. `covers/the-ledger.jpg`).
- `data/manifest.json` carries a `cover` field per book:
  `"cover": "covers/<manifest-id>.jpg"`.
- `index.html` `renderShelf()` renders the cover image at the top of each
  shelf card when `b.cover` is present.

## Status

- Covers: generated locally Oct 25, 2026. NOT pushed, NOT deployed.
  Pushing/deploying to GitHub Pages waits on the owner's word.
