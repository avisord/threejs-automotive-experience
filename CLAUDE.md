# autoxd — three.js playgrounds

Repo: https://github.com/avisord/threejs-automotive-experience (renamed from `tstshaders`; the local
folder keeps the old name). Vite pages (multi-page build, see `vite.config.ts`), deployed on Vercel at
https://autoxd.vercel.app (`vercel.json` redirects `/balls` → `/balls/`):

- **`credits.html` → `src/credits.ts`** — models (from `CARS[].credit`), Poly Haven textures,
  libraries and their licences; linked from the home footer and Menu › Collection.
- **`index.html`** — static home page (no JS) describing the garage, screenshots in
  `public/home/` (1280 px WebP + `og.jpg`, captured headless from the real app). `public/sitemap.xml`
  + `robots.txt` list `/`, `/garage.html`, `/balls/` for Google Search Console — add new pages there.
  GA4 is injected into every page at build time by the `ga4` plugin in `vite.config.ts` from the
  `GA_MEASUREMENT_ID` env var (Vercel project env; nothing injected without it or in dev).
  The build's commit + time are baked in by `define: __BUILD__` (`vite.config.ts`; commit from
  `VERCEL_GIT_COMMIT_SHA` on Vercel — no `.git` there — else `git rev-parse`), read via
  `src/build-info.ts`, and shown under the garage's Menu (commit links to GitHub).
  Custom events go through `track()` in `src/analytics.ts` (no-op without gtag): `car_select`,
  `car_load_failed`, `garage_select`, `camera_mode`, `panel_page`, `photo_capture`, `video_preview`,
  `video_export`, `video_export_done`, `video_failed`, `model_upload(_failed)`, `path_tracing_on`.
- **`balls/index.html` → `src/main.ts`** — "ball pit": physics balls with procedural surfaces
  (`balls.ts`, `materials.ts`, `physics.ts`, `drag.ts`), scene presets in `src/scenes/`,
  composable environment modules in `src/modules/`. Older, mostly finished.
- **`garage.html` → `src/garage/main.ts`** — the active project: a futuristic car
  showroom. Orbit a car inside a selectable garage, repaint it, group and re-material
  its parts, switch its lights on, tune post-processing, optionally path trace stills,
  and export MP4 videos from a shot list of camera moves across garages.

Stack: TypeScript, Vite 8, three r185, `postprocessing` (pmndrs) + `n8ao`,
`three-gpu-pathtracer` + `three-mesh-bvh` (lazy-loaded), `mediabunny` (MP4 muxing over
WebCodecs, lazy-loaded on export), `@dgreenheck/ez-tree` (procedural trees, MIT,
lazy-loaded by the Fuji garage). pnpm.

```sh
pnpm dev      # vite, port 3000 (vite.config.ts) → /garage.html
pnpm build    # tsc && vite build — run before every commit
npx tsc --noEmit
```

## Working with the user

- The user writes Hinglish; answer in Hinglish, keep code/comments/commits in English.
- **Commits: conventional (`feat:`, `fix:`, `perf:`, `chore:`), and no AI/Claude
  references or `Co-Authored-By` trailers** (user's global rule). PR bodies too.
- Work on feature branches, never commit to `main`; open PRs with `gh`. Branches have
  been stacked on each other when features built on unmerged work — say so in the PR
  and retarget to `main` once the base merges. Ask before pushing / opening a PR unless
  asked; local commits are fine.
- The user also edits the repo (e.g. `vite.config.ts` port, PR #4 garages). Check
  `git status` / `git log origin/main` before starting; merge `main` into long-lived
  branches rather than rebasing pushed history.
- Verify visually (see Testing) before claiming a rendering change works.

## Garage architecture (`src/garage/`)

`main.ts` wires everything; it's long and order-sensitive — module-level `let`s that are
read by functions called during init (`bay`, path-tracing state) are declared near the
top on purpose. Moving them below their first use is a TDZ crash at load.

| File | Role |
|---|---|
| `cars.ts` | `CARS`: one `CarProfile` per car — file, `yaw`, target `length`, meshes to `hide`, `glass` fixes, configurator `parts` matchers, `lamps` matchers, credit. `NO_CAR` = empty bay. |
| `car.ts` | `loadCar()`: GLTF + meshopt, hide meshes, fix Sketchfab BLEND materials (cut-out vs real glass), **bake static skinned meshes to plain meshes**, set `castShadow`, scale/rotate, ground and centre (nose → +z). `disposeCar()` frees geometry/materials/textures/skeletons. |
| `materials.ts` | Material library: ~23 entries (paint, metal, glass, trim, light), each = shader pattern + PBR params (incl. iridescence, sheen, opacity, emissive). `MaterialChoice` is what parts/groups store. |
| `paint.ts` | `createPaintMaterial()`: clones a part's material into a MeshPhysicalMaterial with an `onBeforeCompile` hook that generates stripes/two-tone/carbon/camo in **car space** (no UVs) and applies a library entry. Snapshots the factory values so "Original" restores them. Sets `userData.glow` (bloom) and `userData.albedo` (path tracer). |
| `configurator.ts` | Per-car part paint (body, wing, rims, calipers, cage, glass tint), presets, saved per car (`garage.car-config.v3.<id>`). |
| `groups.ts` + `highlight.ts` | Parts editor: user picks meshes, groups them, one material per group (per-source clones keep normal maps/cut-outs). See-through overlay copies for hover/selection/focus. Saved per car by mesh name. |
| `xray.ts` | Parts page deep picking: `main.meshesAt` returns every layer under the pointer (BVH built lazily per geometry on first ray); a repeat click on the same spot goes one layer in, Alt+click lists the layers, H hides / Shift+H shows all. X-ray ghosts the meshes between the camera and `GroupEditor.targets()` (selection, inspected group, deliberate hover) — rays to sampled vertices, per mesh; a ghost moves the mesh to an unrendered layer and adds a fresnel shell child, materials untouched. Cleared when the page closes. |
| `lights.ts` | Head/tail lamps: lens emissive clones + real **spot** lights (tails aim back/down) with one-shot baked shadow maps, optional beam cone shader — **off by default** until it's reworked (older saves carried the old default `on`; a save only keeps its beam once the user toggled it, `beamChosen`). Per car. |
| `garages/interior.ts` | A room's own light fittings in user-settable groups (`Room.interior`): on/off, intensity, and either colour temperature (white light: blackbody ratio against the group's design kelvin, so defaults look as built) or any colour (neon/accents: the pick at each member's own brightness) + a master dimmer; drives real lights, glow strips and emissive surfaces (`fixtureMembers`/`softboxMembers` collect a fixture's). Every garage with fittings has groups: Hex Bay (hex ceiling, wall washers, accent trim, ambient), Studio (overhead, side strips, rim, ambient), Underground (magenta/cyan neon, ambient), Hangar (sunset window, pendants, sky fill, ambient), Fuji Pavilion (skylight — follows the sun — ceiling LEDs, wall cove); Fuji Meadow has none. Menu › Garage › Interior lights; saved per garage in `garage.interior.v1`; changes re-capture the env map (debounced, like the sun). Area lights are dimmed to 0, never removed (a light-count change recompiles every material). |
| `garages/fields.ts` | Farmland layout + per-pixel field shading, shared by the terrain, the far terrain and the hedgerows (see gotchas). |
| `placement.ts` | Menu › Car › Position: a three `TransformControls` translate gizmo on the car root (whole car: body, wheels, lamps, overlays). Also **turns** it about the vertical (Move/Turn gizmo modes, a Facing slider, quarter turns; yaw saved as a 4th number). Kept inside `room.bounds` in x/z (footprint in); y is free — up, or down into the floor, saved per car in `garage.car-position.v1`. The contact shadow is a separate mesh: slid along under the car and faded as it's lifted (baked once at the origin). A drag end re-bakes the lamp spots' shadow maps, calls `room.shadowsChanged` and `traceSceneChanged`; putting the gizmo away (or loading a car) re-centres the orbit on the car. The gizmo is on layer 1 (`GIZMO_LAYER`): the main camera sees it, mirrors/env captures/picking rays don't; `userData.overlay` keeps it out of the path tracer; hidden while directing. Video moves are carried by the car root's matrix (moved and turned, `videoStage.draw`); the contact shadow turns with it; walk/fly's car box too. |
| `free-camera.ts` | Camera modes besides the orbit (HUD bottom left, `V` cycles): **Walk** — eye 1.64 m over the ground, WASD/arrows, shift runs, pointer-lock mouse look (drag-look while picking/placing), head bob in step with the stride (vertical dip per heel strike, sway + roll per stride), gravity + a landing dip, steps ≤ 0.45 m; **Fly** — same without bob, shift fast (6 → 24 m/s), space/E up, C/Q down (not ctrl: ctrl+W closes the tab). In both the wheel zooms the lens (`zoom` 0.6–8×, eased; main narrows the fov from `baseFov`; mouse look slows with it), back to 1× on a mode change. Not held by `room.bounds` (user's call: no bounds in any mode) — through walls and out into the landscape — only kept out of the car's box (`Bay.box`). Ground comes from `main.groundAt`: a lazily loaded three-mesh-bvh (`indirect`, geometry untouched) over the room's plain meshes, called directly so rooms' `raycast = noop` stays; terrains opt in with `userData.ground`. Orbit's pose is kept (`orbitHome`) and restored. |
| `uploads.ts` + `model-import.ts` | The user's own models (Menu › Collection › Upload, or a file dropped anywhere): glb/gltf (meshopt, Draco, KTX2 — decoders in `public/decoders`), fbx, obj+mtl, dae, 3ds, usdz, a zip or a folder of them. Files kept in **IndexedDB** (`garage-uploads`) with a setup (car/bike, quarter turns pitch/roll/yaw, length or auto); each becomes a `CarProfile` with `open` / `turn` / `fitLength`, id `up-…`, so per-car storage works as for built-ins. `model-import.ts` (lazy) resolves references by path suffix then file name, turns Phong/Lambert into MeshStandard, drops lights/lines and Sketchfab ground-shadow quads. `guessSetup` orients from **wheels** (disc-shaped meshes: the thin side is the axle, they sit at the bottom, two in line = bike), else the file's up (Z for .3ds) and the long side; nose from head/tail lamp names. The upload in the bay stays parsed in `main.parsedUpload` (never shown); each load takes a `SkeletonUtils.clone` sharing geometry/materials/textures, so setup and role changes reload quietly (~1 s on the GT3 RS, no loading screen) — disposing a clone only frees GPU copies, the next clone re-uploads them. |
| `roles.ts` + `ui/roles-page.ts` | Menu › Part roles: every mesh is body / wing-aero / rims / tyres / brakes / glass / headlights / tail lights / interior / other / hidden. Meshes are keyed by their order in the file (`userData.partKey` = `#n`, set by `loadCar` before anything is dropped — groups also save members by it now). `suggestRoles` (car space): the profile's matchers first (built-ins), then names, emissive lenses and lamp words split by end (z), transparent → glass, meshes inside a found wheel → tyres (dark, matte) or rims, else the biggest opaque surface's material → body. Saved roles (`garage.roles.v1.<id>`) are applied in `loadCar` before measuring (hidden meshes leave, opaque glass turns see-through) and `profileWithRoles` builds the configurator parts (incl. new `tyres`, `interior`, `trim`) and lamps from keys. Uploads always use roles (saved or guessed); built-ins keep their curated profile until roles are saved for them. Edits are staged with role-colour tints and applied by reloading the car (Apply, or leaving the page). Menu › Parts' **Group by role** makes one group per role (lamps excluded — a group's material would replace their glowing lenses) for meshes not grouped yet, starting from 'original'. Presets also set `interior` and `trim`. |
| `contact-shadow.ts` | Baked soft ground shadow per car (depth from below + blur). |
| `garages/` | `GarageDef`s (hex-bay, studio, underground, hangar, fuji, fuji-meadow, coast, coast-overlook) built from `kit.ts` helpers (`softbox`, `createFloor` = blurred Reflector mirror under a semi-opaque surface, textures, `assembleRoom`). Register in `garages/index.ts`. |
| `post.ts` | pmndrs composer: RenderPass → path-trace blend → N8AO or SSAO → SSR → [DoF pass] → EffectPass(air, flare, bloom [selective "lights only" or all], `GradeEffect`, `ToneMapEffect`, `ColourBalanceEffect`, vignette) → optional SMAA pass → optional film pass (`FilmEffect`). Owns `GraphicsSettings` (sections incl. ao, ssr, toneMapping, grade, balance, vignette, sharpen, aberration, grain, aa, quality, display, pathTracing) persisted in `garage.graphics.v1` (an old save's `grade.toneMapper` migrates to `toneMapping.mode`); `onChange` lets `main.ts` apply the non-composer sections. `refreshGlow()` also marks the SSR scope stale (gathered again before the next frame). |
| `ssr.ts` | Screen-space reflections. Scope Off / Car / Car + room (room meshes within 60 m of the bay — an open-air room's group holds its whole landscape) / Everything, from `main`'s `reflectors` hook. Scope meshes get `SURFACE_LAYER` (4) and are drawn into a half-res G-buffer with `MeshNormalMaterial` stand-ins (octahedral view normal, roughness × map, F0 from metalness, clear coat → its roughness; cut-outs kept); a pixel counts only where G-buffer depth matches the frame's (something unscoped in front → no SSR). Half-res jittered trace against the frame's depth (crossing test: a per-step thickness check missed grazing floors and came out dotted), full-res roughness-widened gather, mixed over the frame by Fresnel × gloss (it replaces the env map's reflection). Off under a path-traced image. Console: `garage.post.ssr.debugView = 1` G-buffer, `2` raw trace. ~1 ms car / ~1.6 ms car + room on Fuji; Everything there +3.6 ms. |
| `ssao.ts` | The "SSAO" AO method (Alchemy/SAO: spiral taps in a radius in metres, normals from depth, half res, depth-aware blur + upsample, multiplied into the frame). pmndrs' `SSAOEffect` was tried first: no blur, and its thresholds are in normalized depth — with a 12 km far plane it came out as sparse noise. ~1.6 ms cheaper than N8AO. |
| `tone-map-effect.ts` | Tone mapping: three's AgX / ACES / Neutral / Cineon, Hable filmic and luminance Reinhard with a white point, Linear. pmndrs' Reinhard2 scales colour by the compressed luminance itself (not the ratio) — don't use it. |
| `colour-balance-effect.ts` | Lift / gamma / gain wheels (hue push + brightness) on the tone-mapped image in a gamma-2 encoding; `widgets.colourWheel` (0° red at the right, counter-clockwise, same axes as the shader). |
| `film-effect.ts` | Last pass, after SMAA (grain would read as edges): contrast-adaptive sharpening, radial lateral chromatic aberration, mid-tone film grain (new pattern per rendered frame via the pass's `time`). |
| `garages/coast/` | Coast House (`garages/coast.ts` = the showroom) and Coast Overlook (`coast-overlook.ts`: the same world, no building — a stone clifftop terrace with a glass balustrade, `planter: false`): glass front facing −z over a tropical cove on a clear midday (`COAST_SUN`, grade look `daylight`; golden hour is a sun preset away). `site.ts` owns the layout — a shoreline mask turned into a **signed distance field** (`shore()`, two EDT rasters, also a half-float texture for the shaders) that drives terrain height, beach/cliff, seabed depth, surf and plant bands; `heightAt`, the coast road, the far compression (`mapFar`, Earth's curve included). `terrain.ts` (triplanar cliff rock, sand with a surf uprush in step with the sea — `SURF` clock), `ocean.ts` (MeshPhysical with per-pixel wave spectrum, depth colour, breakers/foam; no mirror pass), `rocks.ts`, `ranges.ts` (massifs → far terrain), `palms.ts` (valley palms in leaning groups of 3–7), `plants.ts`, `vegetation.ts` (bands + the valley forest system, grown with the **tropical flora** — `garages/flora.ts`: rain tree, fig, and kapok/albizia emergents as the layout's tall kind; Fuji keeps the temperate one), `clouds.ts` (cumulus impostors), `world.ts` (sun, shadows, air). |
| `garages/street/` | Calle Colonial (`garages/street.ts`): no room — a colonial hillside town's street, the car on a level 48 m stretch (`site.FLAT`) at the origin, the street leading up the valley (+z) to a church and a hill. **Phases 1–6 of 8 done (layout/massing, architecture, infrastructure, storytelling, materials, lighting)**; main street 14.4 m (user's call: 2× the first 7.2 — two lanes each way), side streets 6 m; storytelling (festive layer behind a toggle), materials, lighting, background, optimisation to follow. The main street **bends**: `mainHeading(s)` — straight through the car's spot, a ~38° obtuse elbow to the left eased in over s = 40–120 (the view up the street ends on the bend's outer facades), a gentler 18° the other way behind; `mainLine()` integrates it into control points. `site.ts`: `Street` (centre line sampled every 0.5 m, `at(s, d)`, `nearest` by bisecting a monotone axis), `MAIN` + `SIDES` (side streets built off the main street's frame), `mainY` profile, and **`streetY` — the one smooth surface every road, pavement, corner and house sits on** (the main street level across, side streets taking its grade across their mouths), `heightAt` = `streetY` + `hills` + roughness, sunk under paving. `streets.ts`: carriageway ribbons (a side street's starts 0.5 m back, 1 cm under the main one — edge-to-edge left a crack), pavements + kerb faces, rounded kerb corners from a `THREE.Shape` in each junction's frame. `lots.ts`: architectural **families** (walls, dado, storeys, widths, roof go together) walked lot by lot — no family twice in two lots, storeys step ≤ 1, shops near corners, alleys, walled gardens; hand-set sequences round the car (`HERO`). `buildings.ts`: lot massing (shared corners along the street → continuous street wall), church, roof water tanks (instanced). `facade.ts`: the street front (and a corner house's side, `onCorner`) is built **with its openings cut through** — the wall as columns between opening edges (split at the dado line for colour), reveals 0.24–0.32 m deep so every window holds a shadow, infill set back (frames, glazing bars, glass with curtain colours, panelled doors, fanlights, shopfronts), surrounds/sills, iron grilles, balconies (slab on brackets, continuous, Juliet), string courses, coping, spouts, pilasters — all per family `STYLES` (bay widths, door, window kinds, balcony odds, surround colours, frame paints); chance only picks within a family. Materials: walls/trim vertex-coloured (one material), glass (full-strength env, `receiveFarShadow` only), iron, and railing lace (alpha-tested canvas atlas, 2 patterns, uv metres × row). Closing houses at the side streets' ends and walled gardens (piers, railings, gate) use the same pieces. ~+0.3 ms over the massing. `infra.ts`: cast-iron lamp posts (main street, alternating sides, 28 m) and bracket lanterns (side streets), whose glass is the **Street lamps** interior group (emissive member, off by default; Menu › Garage › Interior lights); concrete utility poles (right side of the main street, one side of each side street; the one just ahead of the car moved up the street, `keepClear`) with power/telephone lines and service wires to the houses' brackets (`buildFacade` returns the `drop` point); signs, street plaques and gutter grates/manholes all from one canvas atlas (`signs.ts`; shop boards over shopfronts come from `facade.ts`); bollards round the kerb corners. Wires are 3-sided tubes carrying a `centre` attribute: `wireMaterial` widens them to ≥ ~0.8 px (`uPixel` set per camera in `onBeforeRender`, 0 in shadow passes) — at true width they broke into dashes; they cast **no** shadows (a 1–2 cm wire is ~1 texel of the sun's map: dotted lines on the road). `buildFacade` also returns **features** (balcony/ledge/sill/parapet lines, door and shop fronts with `along`/`out`) that the decor modules place on: `plants.ts` (painted leaf atlas — ivy, geranium, bougainvillea, shrub; pots instanced with crossed-card crowns carrying crown normals; ivy mats and strands hanging off parapets, cascades off balconies as single-layer wall cards; a per-house greenery level 0/1/2 so houses differ), `props.ts` (per shop name: café tables and A-frame, grocers' crates, workshop drums and tyres, hardware ladder and buckets; bikes and cartons by doors, scooters at the kerb, corner bins, plaza benches, roadworks barriers and cones, telecom cabinets, five parked classic saloons > 14 m from the car; all instanced, vertex-coloured, tinted per instance), awnings over most shops (`facade.awning`; the board sits above it). `festive.ts`: bulbs slung across the main street (Wires + instanced emissive spheres, the **Festive lights** interior group), fat striped candy canes, gifts, wreaths — one group behind the **`Room.options`** switch 'Festive decorations' (default off). `Room.options` is generic: Menu › Garage shows each as a titled switch, saved per garage in `garage.options.v1`; `setRoomOption` re-gathers glow, re-renders shadows and re-captures the env. Lighting (phase 6): late-afternoon sun az −140°, 34°; **`far-shadow.WALL_BOUNCE`** — the sunny facades' light across the street (facade albedo × sun on walls × ~half sunlit × ~⅓ view factor × 2, `WALL_BOUNCE_GAIN` 1.4; every face, up-facing ×0.55), set by `street/world.ts`, cleared on dispose; without it the shade got only blue sky light and went navy. The garage's grade look is the new **`afternoon`** (post.ts `LOOKS`; soft grey shadow tint — daylight's blue-teal split tone turned shaded paving navy). Exposure key −3.5 (metered). `surfaces.ts` (phase 5): per-pixel surfaces patched onto standard materials by `surface()` (world position/normal varyings, a colour block setting `diffuseColor`/`sfRough`/`sfH`, bump from screen derivatives; detail box-filtered by pixel footprint, bumps faded with distance). Road: setts in courses across the street in the `street` vertex attribute (s, d, half-width — each street's ribbon its own mesh; pavements/kerbs take the nearest street's), wavy joints, a gutter channel of long stones, wheel polish, oil drip line, dirt, asphalt repairs, **tyre marks** (arcs: pairs a track apart, streaky) and **fans** (rings about a point ~36 m down the street — centred on the junction the rings ran along the street and radiated like shards); Concrete Floor's normal/roughness for grit. Pavement flagstones (cracks, grime, gum), granite kerbs, limewash render (mottling, bleaching, repaint patches, rain streaks, a dirty foot via `site.groundTexture()` — the height above the pavement — render fallen off low down, hairline cracks a pixel wide by `fwidth` of the noise: in noise units they came out as thick snaking bands), dressed stone, wood grain, rubble walls (Rock Wall 02 in `CellMesh` 'box' uvs), clay tile roofs. Facade pieces go to the mesh of their surface (`FacadeMeshes` wall/stone/wood/rubble/roof…). ~+0.8 ms. Sign/plaque uvs: a plate's picture runs toward the viewer's right, and a facade's u can run either way — shop boards check `along × out` (they came out mirrored on one side of the street). Only the streets' own houses are built (user's call: a background town of instanced blocks was dropped — never seen from the street, only draw calls). `mesh.ts` `CellMesh`: triangles bucketed into 60–80 m cells, one mesh each (culling, SSR scope). `world.ts`: sun (default az −140°, 42°: behind the camera's right shoulder — into a low sun the whole street was shade under a backlit grey sky), far shadow narrowed to ±1.5 km (0.7 m texels) so houses shade the street all the way up. The far land's height must stay low (head hill ~3–6°, ranges ~1–3° over the horizon from the car): taller, it read as a dark wall across the sky. ~8.6 ms GPU at 1600×900 (Fuji Meadow ~27). |
| (depth of field) | Settings › Graphics › Depth of field: `dof.mode` Auto/On/Off, focus on the orbit target; Auto = on where a `Room` sets `depthOfField` (Coast House). Own `EffectPass` before the main one, so haze and grade work on the blurred image. |
| `grade-effect.ts` | Custom HDR grade before tone mapping (exposure, contrast, split tone…). |
| `lens-flare-effect.ts` | Sun lens flare (glare, starburst, streak, ghosts), visibility from depth samples round the sun, scaled ×6 to read over the HDR sky. Settings › Graphics › Lens flare; only where a room has `atmosphere` (a sun). |
| `atmosphere-effect.ts` | Open-air rooms' air, first in the effect pass: aerial perspective (exponential height fog from depth, forward scattering toward the sun) and volumetric sun shafts (ray-marches the sun's `sampler2DShadow` map; a dust box makes beams read under a roof). Params come from `room.atmosphere`; Settings › Graphics › Atmosphere. |
| `pathtrace.ts` | Wrapper around three-gpu-pathtracer: builds the scene through proxies (see gotchas), paces GPU work with fence syncs, denoises early samples. |
| (lens) | Default Display › Field of view is 36° (~37 mm) with the start camera a little farther back — a photographer's lens, not a wide game camera. Saved settings keep their own value. |
| `camera-moves.ts` | `CAMERA_MOVES`: 15 parametric moves (turntable, hero sweep, push in, flyover, side track, detail reveal, top-down, dolly zoom, spiral rise, dutch orbit, ground skim, wheel orbit, headlight slide, crane down, handheld hero hold) — `pose(u, framing, out, seconds)` in car space, framed from the car's size, lens and aspect; a pose may set its own `fov` (lens) and `roll` (dutch angle). |
| `director.ts` | Reel model (shots = move + garage + length, fade/cut, resolution, fps, quality), `preview()` live in the window and `exportVideo()`: fixed-timestep render → `CanvasSource` (captured in the same task as the draw) → MP4. Talks to the app only through a `Stage` (implemented in `main.ts`: takes the view, swaps garages without the UI fade, restores camera/garage/grade after). |
| `ui/` | Side panel shell (`panel.ts`: page stack + breadcrumb + `leave()` hook), widgets, and pages: Garage, Collection, Car, Parts, Lights, Capture › Photo / Video, Settings › Graphics / Display. `material-controls.ts` is the shared material picker. (A saved panel path straight to Video is rewritten through Capture at load.) |
| `ui/photo-page.ts` | Menu › Capture › Photo: a still of the current view (orbit, walk or fly — the free camera's zoom included) without the UI. While the page is open a guide (`.photo-guide`, box-shadow dimming, first child of `#app` so the panel draws over it) frames the shot: the largest rect of the aspect in the free area, centred on the lens. `main.photoCamera.take` borrows `videoStage` (`begin` at the photo size, pixel ratio 1), sets the same eye and a lens as tall as the guide, renders 3 warm-up frames (auto exposure) + 1 and reads the canvas in that task (2× supersample → high-quality 2D downscale). Sizes HD / QHD / 4K / screen; supersample only up to QHD: rendering 8K (7680×4320) took 2.4 s and then crashed the tab. PNG / JPEG / WebP, saved in `garage.photo.v1`. `videoStage.end()` restores the placement gizmo's visibility as it was (it used to force it on after every video). |

Rendering model:
- **On-demand rendering** is the default: frames are drawn only after `invalidate(n)`
  (camera moved, setting changed, panel interaction, car/garage load). Anything that
  changes the picture outside those paths must call `invalidate()` (console:
  `garage.invalidate()`). Hidden tabs cancel the rAF loop entirely.
- Camera: OrbitControls, never below 84° polar, **not** clamped to `room.bounds` (no mode is —
  user's call; only video moves keep the dolly-zoom `fitCameraInRoom`), with a view offset so the
  car sits beside the panel.
- Environment map is captured from the room itself (PMREM) whenever a garage is
  installed, so the car reflects the real lights.
- While a video preview/export runs (`directing` in `main.ts`) the app's frame loop draws
  nothing, the panel/HUD hide, the lens is a plain centred one (no panel view offset) and
  an export renders at the video size with pixel ratio 1. The director also pulls the
  camera in front of room geometry blocking the car (`clearLineOfSight`, e.g. hangar pendants).
- Path tracing runs only when the camera has rested ~350 ms and not while picking parts;
  anything that changes geometry/materials/lights must call `traceSceneChanged()`.

Console handle `window.garage`: `scene, camera, controls, renderer, room, post,
configurator, lamps, placement, tracer, invalidate, showGarage, setSun`.

## Adding a car

1. Optimise the export (keep names — the configurator matches on them):
   ```sh
   npx @gltf-transform/cli@4 optimize in.glb public/models/<name>.glb --compress meshopt \
     --texture-compress webp --texture-size 2048 \
     --join false --flatten false --simplify false --instance false --palette false
   ```
   FBX-only sources: `npx fbx2gltf` (npm package ships an FBX2glTF binary) first.
2. Inspect materials/nodes of the **optimised** file (dedup renames/merges materials).
3. Add a `CarProfile`: find front (+z) from headlight/taillight positions, set `yaw`,
   `length` if the scale is off, `hide` shadow planes / motion-blur wheel doubles /
   damage variants / inner glass layers, `glass` fixes for windows exported OPAQUE,
   `parts` and `lamps` matchers.
4. Check in the browser: every part matched (console warns otherwise), windows
   see-through, lamps detected (four spot lights: two head, two tail), texture and
   geometry counts back to baseline after switching away.

5. Give it a `credit` (Sketchfab title, URL, author, licence, `basedOn` if the page credits an
   original): it shows on its card and on `/credits.html` (`src/credits.ts` renders `CARS`).
   Only CC BY / CC0 / CC BY-NC(-SA) models — never ND (we adapt them) or Store licences (the
   .glb is publicly downloadable from the site).

Licences (matched 2026-09-27 via the Sketchfab API by triangle count — within the few % that
gltf-transform's prune drops — and any author the file names): GT3 R "Roxy" (toddeppe, based on
MattDoesBlender), 930 (Lionsharp Studios), SLS and 190E (Dave Love SketchFab), AMG ONE (kevin
(ケビン) — the file came from a spam re-upload whose metadata named a coffee brand) are CC BY 4.0;
GT3 RS (VTX) and RX-7 (Ddiaz Design) are CC BY-NC-SA 4.0 — non-commercial only. Several meshes
look ripped from games (`amgprojone_`, `fast:…_lodA`, `.col` nodes).

## Gotchas learned the hard way

- `gltf-transform optimize` runs **palette** by default: it folds untextured materials
  (body paint, glass) into one and loses their names. Always `--palette false`.
- Ground and centre a car with `Box3.setFromObject(car, true)` (precise, from vertices). The
  default turns each mesh's bounding box into the world, and a wheel turned on its axle gets a
  box ~1.4× the tyre: the GT3 R (LR/RF turned 50°) floated 15 cm, the 930 10 cm.
- GLTFLoader sanitises node names (drops `.`, spaces → `_`) and suffixes duplicates
  (`hub_lf`, `hub_lf_1`) — write regexes against loaded names, not file names.
- Sketchfab exports mark body/interior BLEND just because textures have alpha → render
  as alpha-tested opaque, keep only real glass transparent (`car.ts`).
- The GT3 RS rigs 179 rigid parts to bones: skinning cost a bone texture each and made
  raycasts ~150 ms. They're baked to plain meshes at load.
- three-gpu-pathtracer copies vertex data in its **source array type**: meshopt
  quantized (normalized Int16) attributes become room-sized garbage. `pathtrace.ts`
  hands it float copies. It also ignores `InstancedMesh` (merged first),
  `MeshBasicMaterial` glow (→ emissive proxies), `onBeforeCompile` patterns (→ main
  colour) and can't read a PMREM environment (a stand-in scene with no env is used).
- WebGL queues unbounded work: path tracing without pacing put the GPU ~2.7 s behind
  and froze camera drags. Keep batches small and track them with `fenceSync`.
- No shadow maps existed before the lamps; point lights leaked through bodywork onto
  the floor. Lamps are spots with baked (`shadow.autoUpdate = false`) shadow maps.
- `PCFSoftShadowMap` is deprecated in r185 — use `PCFShadowMap`.
- The floor mirror (`Reflector`) re-renders the scene; objects lying on the floor must be
  in `room.floorLayers` so they're hidden during the mirror pass.
- `THREE.Clock` is deprecated — the loop uses `THREE.Timer`.
- Open-air garages: `garages/site.ts` lays out the Fuji site (terrace → road → valley →
  lake → far shore → ranges → Fuji) and owns `heightAt`, `lakeShape`, `roadZ`,
  `forestDensity`; `landscape.ts` assembles `terrain.ts` (real scale to 3.3 km),
  `roadside.ts` (road, poles, wires, guardrail, signs, cars), `greenery.ts` (garden trees
  around houses and hedgerows on field boundaries, past 450 m), `town.ts` (~2,000
  instanced lakeside houses, hotels and farmsteads; windows drawn by a facade shader in
  building metres, fading to their average once smaller than ~2 px so towns don't
  shimmer; gable/hipped matte roofs), `canopy.ts` (a lumpy crown shell over thick woods —
  far instanced trees alone read as confetti; built on `terrain.TERRAIN_GRID` so it lies
  exactly 3 m under bare ground at every vertex — on its own grid it poked through steep
  slopes and z-fought), `trees.ts` (incl. hand-placed framing pines
  and sakura, `ACCENTS` in landscape.ts), `ranges.ts`, `fuji-mountain.ts`, the lake (`water.ts`, its own low-res mirror) and the
  sky — all from fixed seeds so videos are repeatable. Past 3.3 km the far layers are
  **distance-compressed**: built in real metres (Fuji 2,950 m above the lake at 17 km)
  and mapped vertex by vertex (`site.mapFar`, normals from the real shape first) so each
  point keeps its exact direction from the eye and its depth order; the atmosphere
  effect's `compress` undoes the mapping to haze them for their real distance. Haze is
  two exponential height layers above the lake (650 m scale + a thin 1.5 km `air` layer —
  without it the 20–30 km ranges, whose crests rise out of the haze, kept the contrast of the
  9 km ones and the layers didn't recede; at the old 1.2 km / 8 km scales the ray to Fuji's
  summit crossed nearly as much haze as the ray to its foot and the whole cone washed out
  evenly) plus a terrain-following valley `mist`: ray-marched in 12 steps
  against `ranges.createMistFloor()` (the land raster's local minimum within ~2.5 km, i.e.
  each valley's own floor, + a patchiness channel), ~110 m deep, starting ~900 m out. A mist
  measured from the lake level (the old third layer) lay as one flat band at the water and
  gave every range the same veil; now each range's foot is paler than its crest and Fuji's
  skirts sit in it while the summit stays clear. ~0.05 ms; the far terrain runs out to 34 km (`ranges.ts`). The haze colour is
  set a little darker/bluer than the horizon sky, or far ridges wash out. Two shader bugs
  fixed there: the fog integral must not switch formulas at a fixed |falloff·rd.y| (it
  drew a hard line across Fuji at ~7° elevation), and "sky" is depth ≥ 0.9999999 — at
  0.99999 everything drawn past ~5.4 km (Fuji's cone, far ranges) went unhazed. (A 60 km
  far plane would leave metres of depth error near the lake shore.) The valley profile
  is designed from **depression angles** seen by the orbit camera (`site.VIEW_EYE`, ~8 m
  behind the car): the floor's edge hides everything > ~4.5° below its horizon, so the
  far shore sits within ~1°, the lake (50 m below the deck) at 1.6–2.9°, road/near-shore
  town at 3–4.5°; each farther point must appear a bit higher — a convex slope hid the
  lake. The flanks and far shore rise from the water over a few hundred metres
  (`rise` in `heightAt`) — at full height right at the shore they stood as cliffs. Anything outside the back glass must stay under `site.roomBelowView` (the 3.9°
  line) or it screens the lake; tall trees only at the window's sides. Land keeps ≥ 0.004 × r clear
  of the lake level for depth precision. Camera near/far 0.1 / 12000 m; PMREM far 12000.
  Three mirrors (deck, pool, lake) each hide the other two in their own pass. Optional
  `Room` hooks: `ready` (async assets; env re-captured after, video exports wait),
  `outdoor` (meshes get a second env map captured from an open-air `probe` — the interior
  capture sees the roof, which lit the far land like concrete), `sun` (get/set; main saves
  it per garage in `garage.sun.v1` and re-captures the env 180 ms after the last move),
  `atmosphere`, `view` (the orbit camera's offset from the car when the garage is opened — `main.takeRoomView`; rooms without one leave the camera where it was), `shadowsChanged` (car loaded/removed → re-render the sun's shadow map,
  which has `autoUpdate = false` so mirror passes don't re-render it every frame).
  Far meshes set `raycast = () => {}` so `clearLineOfSight` stays cheap.
- Sky (`garages/sky.ts`): three's analytic `Sky` (Preetham) with a gain uniform patched in
  (the stock shader has no exposure) and its cloud block replaced (`CLOUD_GLSL`: a cloud
  deck banked low over the horizon, lit toward the sun; brightness is scaled to the
  sky's own luminance — the model's output is in large arbitrary units). The sun disc is hidden during env
  captures (its spike smears in the PMREM prefilter). The HDRI photo sky was dropped: its
  sun can't move. The path tracer gets a uniform sky-colour stand-in (`userData.pathTrace`).
- The two Fuji garages share `fuji-world.ts` (landscape, sun + far shadow, fill, atmosphere,
  sun control, open-air Room hooks; room-specific sun reactions via `onSun`). `fuji-meadow.ts`
  has no building: the landscape is lifted (`lift`) so the lawn sits at the car's y = 0, the
  car stands on a Poly Haven "Dry River Pebbles" pad with edging stones, and a pebble ribbon
  (CatmullRom course, draped on `heightAt`, wound to face up, polygonOffset) runs to the road;
  `keepClear` keeps grass/trees off both. No floor mirror: an invisible stand-in Reflector.
  The pebbles (`dryPebbles`) use parallax occlusion mapping from `river-pebbles/height.webp`
  (tangent frame from screen derivatives, so it works on the draped track too; `#define
  vMapUv pomUv` redirects every map lookup; fades out 12–30 m). ~+0.5 ms at 1080p.
- Vegetation (Fuji): `vegetation-layout.ts` plans every tree/shrub up front (`VEGETATION`
  tunables: cluster count/radius/density, lone trees, shrubs, clearings, size log-normal,
  veterans, crown width, lean, LOD bands/caps) — clustered Gaussian stands weighted by
  `site.woodedness`, lone trees, a clearing noise field; `landscape.planVegetation` supplies
  the site rules (not water/road/houses/cliffs, nothing rising into the lake view). Its
  `cover()` darkens the terrain under trees and shapes the canopy shell. `trees.ts` gives
  each plant one of four LODs by distance from the pavilion (`VEGETATION.lod`: 30/70/160 m —
  a driving game's 20/50/120 scaled ~1.3× for the 36° lens): LOD 0 full ez-tree (heroes +
  hand-placed accents); LOD 1 `masses.ts` — limb skeleton (branch triangles with a ring edge
  < `SKELETON_EDGE` dropped) + 20–24 crossed-card foliage masses placed by k-means over the
  full tree's leaves, each card a baked *cluster card* (a thin slab of real leaves, leafy
  broken edge), crown-centred normals — ~1 k tris; LOD 2 three crossed impostor cards; LOD 3
  two; past `VEGETATION.shadowless` (1.5 km) no shadow casting (the canopy shell carries it).
  Card materials use `foliage({ crownNormals })` — three flips a DoubleSide normal on back
  faces, which turned half of every crossed-card tree dark — and `matte` (sky specular made
  shaded clumps blue). Impostors
  (`impostors.ts`: 8 species baked into an albedo atlas with a throwaway WebGL context,
  two crossed quads, view-facing crown normals, mip-scaled alpha so far crowns don't
  vanish, dilated colours so mips don't fringe). ~0.5 M impostors + `greenery.ts` village
  gardens/hedgerows + `ranges.createRangeForest` (skyline trees and the forest stands on
  the far terrain < 14 km, mapped into the compression, not in the far shadow map; they take
  the terrain's horizon-map shadow per instance). All instanced, all
  cast into the shadow maps. Layout takes ~2 s of the ~8 s garage build.
- Vegetation assets (placement unchanged): the meadow (`landscape.createMeadow`) is built
  from grass **patches** (`grass.ts`: 12–40 blades of mixed shapes — thin/broad/curved/bent/
  leaf/dry — per clump, vertex-coloured root→tip), in layers (short sward close in, tufts,
  forbs, tall and dry stands) chosen by smooth noise fields so neighbouring patches share
  height/lean/colour; 3 variants per kind, LOD 0 < 18 m, LOD 1 = `farPatch` (fewer, wider,
  1–2 segment blades). Trees are grown fuller (`grow(..., fullness)`: more, larger leaf cards
  down the twigs, hiding limbs), six archetypes (pines, broad/round oaks, ash, aspen), crowns
  scaled asymmetrically. `foliage.ts` gives all leafy materials: coherent wind (`WIND.time`,
  advanced only in `Room.update`), sun translucency, and `lumaLeaves` — only the leaf
  texture's brightness (normalised by `leafGain`), the hue from the instance colour
  (`trees.foliageTint`), so near cards and impostors share one palette. Impostor atlas bakes
  crown depth shading (inner/low leaves darker). Headless screenshots can return a stale
  composited frame — to test animation, `readPixels` right after `post.render` in one task.
- Trees (`garages/trees.ts`): ez-tree grows 3 near + 3 light variants (pine presets),
  instanced; Poly Haven 2k Japanese cedar bark replaces its 1k bark; its needle atlas is
  kept (straight alpha, `alphaToCoverage`, a lower alphaTest for far crowns — otherwise
  mipmapped alpha thins far trees to bare sticks). Import only the package entry (its
  `exports` hides `src/`); it bundles all its textures inline (~4 MB), hence lazy.
  ~29 near trees ≈ 0.6 M tris + ~490 far ≈ 4.5 M; far forests are left out of both mirror
  passes (Fuji front view ~22 ms GPU at 1600×900 on the RX 7600 — measure with
  `EXT_disjoint_timer_query_webgl2`; wall-clock timings of `post.render` swing ±3 ms).
  Near leaf cards are the expensive part: accents and bushes are kept out of the deck
  and pool mirrors. three evaluates every RectAreaLight on every lit pixel, landscape
  included (~1.6 ms each here) — fake cheap interior light (the roof slab's faint emissive
  "bounce") rather than adding area lights.
- Far shadows (`garages/far-shadow.ts`): the sun's map only covers ±45 m, so beyond it
  sunlit and shaded land looked the same. A second directional light with intensity 0
  and a 3.2 km, 4096² shadow map (re-rendered on sun moves / when trees arrive) casts for
  terrain, Fuji and every tree (6.8 km across, 1.7 m texels); landscape materials get `receiveFarShadow()`, which reads
  `directionalShadowMap[1]` after `lights_fragment_end` where the near map doesn't reach.
  It must be the second shadow-casting directional light added (the sun is index 0).
  Outdoor materials use `envMapIntensity = OUTDOOR_SKY_LIGHT` (0.3) and the sun is
  ×1.7 of `sunLight()`. Calibrated by rendering a white horizontal Lambert patch into a
  float target with only the sun / only the env / only the hemisphere lit: sun:sky must be
  ~5:1 on a clear day (it was 2.6:1 and shade looked washed out). Default sun is late
  afternoon from the right/west (az 70°, 14°): from the left the concrete wall kept it off
  the floor, from behind the mountain Fuji's face was all shade. The haze stays blue at
  a low sun (the gold is only in forward scattering); indoor dust fades below ~20° or it
  veils the car with its own shadow streaks.
- Glass (`garages/glass.ts`): premultiplied-alpha blending (reflection added, background
  × (1 − absorption − Fresnel − dust)) — `opaque_fragment` and `premultiplied_alpha_fragment`
  are replaced; normal-map float-glass waves at `normalScale` 0.06 (more reads as liquid);
  dirt kept faint (wipe arcs read as circles). Panes from `glassPane()` each tilt ~0.1°.
  Fuji roof is 8.25 m with a transom at 4.4 m; its area lights were doubled for the height.
- Volumetric light is its own setting (`volumetric`: strength, quality = shaft ray-march
  steps via the effect's `STEPS` define); the atmosphere effect is built when either haze or
  volumetric is on and zeroes the other's strength.
- Lights-only bloom (`SelectiveBloomEffect`) keeps far-plane pixels by default — the
  analytic sky is drawn there, and bloomed whole it laid a milky veil over every open-air
  view. `ignoreBackground = true` (post.ts).
- The Fuji deck's photographed concrete is already dark (~0.085 albedo): tint it near
  white, or the floor goes black and shows only the blue sky's reflection.
- `envMapIntensity` only applies when a material has its **own** `envMap`; with
  `scene.environment` three uses `scene.environmentIntensity`. `captureEnvironment()`
  (main.ts) hands the room's map to room materials whose `envMapIntensity !== 1` — before
  that the Fuji floor's sheen was full strength and turned it navy blue. The floor mirror
  (`createFloor({ fresnel })`) has a Schlick falloff: ~5% straight down, strong at grazing.
- Landscape materials (`receiveFarShadow`) compile three's point/spot/area light loops out:
  every RectAreaLight otherwise cost ~1.6 ms on every landscape pixel. N8AO runs `halfRes`.
  Fuji front view at 1080p ≈ 17 ms GPU.
- Far terrain (`ranges.ts`): one polar mesh from 3.24 to 34 km (1440 × 170, geometric
  rings), continuing `heightAt` out of the valley. Built from forms, not one noise:
  `MASSIFS` (foothills ~5 km, middle ranges 8–12 km, high ranges 21–26 km) each make a
  meandering main ridge + spurs (asymmetric widths, sharp/round/plateau profiles), merged
  with a smooth max over broad roots and rolling ground; `VALLEYS` cut corridors back into
  them; erosion is a warped periodic spur-and-gully pattern down each ridge's flanks. Erosion
  must be applied once per ridge in a frame blended from its pieces: per piece then maxed, the
  max chose whichever overlapping piece had no gully (erosion vanished); averaged, it
  cancelled; a width or spacing that differs per piece, or a steep-side flag that flips
  behind a ridge's end, left steps. Colour/cover from elevation, slope, aspect and moisture
  (gullies, valley floors); per-pixel crown/clearing detail from a real-metre `realXZ`
  attribute, incl. `crownField` (11/30 m crown relief that tilts the normal, so low sun lights
  one side of each crown — a flat forest colour read as painted green, "no vegetation").
  Range trees are planted by area (650/km² < 8 km, 320/km² to 14 km, ~150 k impostors,
  ~1–1.5 ms); at a few per vertex (~75/km²) the slopes looked bare. Cast shadows: an 8-direction horizon map per vertex (from a 180 m height raster
  of the whole land incl. `fujiSurface`), compared with the sun in the shader (`horizonShadow`,
  applied before `aomap_fragment`, after translucency). Land under Fuji's skirts is pushed
  well below them (depth precision). ~0.95 s to build; GPU cost no higher than the old bands.
  Keep the skyline in front of Fuji at ~4.6–5.2° (`silhouette` of the front ridge) or its
  skirts show and it reads wider.
- Fuji's shape (`fuji-mountain.ts` `profile()`): a steep curve plus a nearly straight one over
  a 15 km radius, fitted to the real north-side elevations — a single-exponent cone read as
  a triangle. The front ranges (`ranges.ts`) hide its lower skirts so the visible mountain
  is ~5:1 wide:tall. The erosion/snow detail is still written in units of 7 km (`t`).
- Near ground (`terrain.groundDetail`): Poly Haven "Sparse Grass" (`public/textures/sparse-grass`)
  used for luminance + normal detail only (relative to its mean `GRASS_MEAN`), per-pixel
  patches (straw / lush / mottling) that fade out past ~1 km.
- Farmland (`garages/fields.ts`): one field layout in GLSL and TS (PCG integer hashes, 24-bit
  floats so a hash never reaches 1.0 — `int(h * 8.0)` indexed past a const array). Warped
  Voronoi districts (~380 m, own orientation/strip width/crop mix; their edges are farm roads
  or ditches), jittered strips cut into offset fields. `fieldShade()` draws it per pixel on the
  terrain (`farm` attribute, from `farmland()`) and on the far terrain's flat low ground
  (`realXZ`, farm clears the forest there), by pixel footprint: rows/furrows/mowing stripes and
  antialiased boundary lines (`fLine`, box-filtered) → a field's crop colour → its district's
  mix → the valley mean. `greenery.ts` puts hedgerows, tree lines, ditch belts and corner copses
  on the same boundaries (`unlocal` + `unwarp` back to the ground). The planned tree layout
  still uses the old, narrower `orchardFarmland()` so the valley's trees didn't move. ~+1 ms
  GPU at 1600×900. The terrain clamps its albedo ≥ 0 (a negative one sparked in the lake's
  half-float mirror); a faint coloured dot on the lake near the far shore predates this (Fuji
  writes a negative texel into the lake mirror — not traced further).
- Coast House: the land below the glass is capped **under the floor edge's sightline** (8.4° from a
  2 m eye), not along it — capping along a sightline squeezed the whole slope into one sliver and hid
  the cove. The cove is a crescent straight ahead (`COVE`: shore ~430 m out, ~150 m of level sand, 34 m below),
  at 4.5–7° — visible over the sill from car height; in front of the sand nothing rises above the
  sill's line (`roomBelowCove`), and the planter is planted only at its ends. Far coast: the coastline wobble is calmed past ~8 km (it folded into thin spits
  with bright water behind that read as white plateaus), and low land keeps 0.4 % of its distance clear
  of the sea for depth precision. Textures held only in shader uniforms (terrain, rocks, clouds) are
  freed by the room's own `dispose` — `disposeTree` only frees material properties. Switching to Fuji
  or Coast and back leaves 2–3 textures behind (pre-existing, shared forest path; not traced yet).
- Cars **receive** shadows (`car.ts`): without it an open-air room's sun lit the paint straight through
  the garage's walls and roof. Nothing may sit level with a floor mirror (y = 0): a slab top there
  z-fights in the reflection as fine stripes that crawl when the camera moves — keep it ≥ 1 cm under.
  The floor mirror clamps its samples (the sun's disc overflows half floats; depth of field spread the
  inf into a blob). Lens flare visibility samples a ~1° disc: a 7 px one flickered behind palm fronds.
- Coast realism (grounding without geometry): `coast/contact.ts` bakes a soft occlusion raster (±320 m,
  0.4 m texels) under every plant, palm, rock and the room's `footprints`; the coast terrain dims its sky
  light and colour by it. The terrain's grass area carries macro/meso/micro variation in the shader (drifts,
  dry patches, bare soil, lodged grass, tussocks, pebbles) — it must look like ground with the grass patches
  hidden; patches stop at 90 m. Dome shrubs (`plants.ts`) are ~26 cards over an opaque lumpy **core**
  (drawn first): 44 cards alone stacked ~10 alpha-tested layers and cost ~3 ms. Blossom is a mask in atlas
  cell 4 (blue > green) coloured by the `bloom` vertex attribute, so flowers stay small among leaves. The
  Coast Overlook's stone is `terraceStone()` (slab joints box-filtered by pixel footprint — thinner than a
  pixel they broke into dashes). Contact shadows add a tight 7 cm bake for the tyres' crease.
- Auto exposure (`exposure-meter.ts` + `GradeEffect`): a pass before the effect pass draws the HDR frame's
  centre-weighted (w·log2 L, w) into a 256×144 half-float target; its top mip is the mean, read by the grade in
  the same frame (no readback, exports stay deterministic). Each `GarageDef.exposureKey` is its default view's
  metered mean (`garage.post.readMeter()` with auto on), so auto exposure only adapts views *within* a garage
  (a dark neon bay stays dark); `grade.auto` is the strength (default 0.6), ±2 EV at most. Measure a new
  garage's key before adding it.
- Ground bounce (`far-shadow.ts` `GROUND_BOUNCE`): landscape materials add ρ·E_sun (×2 for multiple bounces) on
  down-facing normals (foliage with crown normals at least 0.4); set by coast/world.ts from its sun, cleared by
  `world.dispose()`. Not a scene light: the car and room surfaces already see the sunlit ground in their env map
  (a hemisphere light double-counted it there and did nothing for up-facing crown normals).
- Open-air room surfaces (a terrace, not the car) need `envMapIntensity = OUTDOOR_SKY_LIGHT`: at 1 they take
  the sky at ~3× the landscape's strength — the Coast Overlook's stone was nearly as bright with the sun
  off, blue and flat.
- `setHSL` works in **linear** by default — pass `THREE.SRGBColorSpace` for picked colours,
  or foliage comes out pale.
- `kit.disposeTree` disposes lights too (a shadow-casting light's map is a render target,
  2 textures) and lines/points (the power lines' geometry) — both leaked per visit before.
- Photographed surfaces: `kit.SURFACES` + `pbrMaps()` load 2k Poly Haven (CC0) colour /
  normal / roughness maps from `public/textures/<name>/` (WebP, AO baked into colour —
  bake with `blend` on **planar** `gbrp`; on packed `rgb24` it silently turns the result
  green). `boxUV()` puts box uvs in metres so one map set covers boxes of any size;
  share one set per surface per room (2k RGBA ≈ 22 MB of GPU memory each with mips).
  Fuji uses them; the other garages still use the procedural canvas textures.
- Water (`garages/water.ts`): its own `Reflector` with a ripple/Fresnel/sun-glint shader.
  Two mirrors must not render inside each other — the water hides the deck mirror during
  its pass and sits in `floorLayers` for the deck's. Ripples advance through the optional
  `Room.update(dt)` (called by the frame loop and the video director), so idle water holds
  still and exports stay deterministic. Shader materials can hand the path tracer a
  standard stand-in via `material.userData.pathTrace`.
- three-gpu-pathtracer reads vertex colours as RGBA and multiplies albedo **alpha** by
  them: an RGB colour attribute made terrain/grass fully transparent in traces.
  `pathtrace.ts` pads them to RGBA (alpha 1), and bakes `instanceColor` when merging
  instanced meshes. Its texture array resizes every map to 1024².

## Testing / verification

There's no test suite; changes are verified by driving the page in headless Chromium on
the real GPU and looking at screenshots:

- Chromium: `~/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`, launched via
  `playwright-core` (install it in the session scratchpad, not the repo) with
  `--ignore-gpu-blocklist --enable-gpu --use-angle=vulkan --enable-features=Vulkan`
  (renderer string should be the RX 7600 / RADV, not SwiftShader).
- Run a dev server on a spare port (`pnpm exec vite --port 5190 --strictPort`) and stop it
  afterwards. Wait for `.loader.done` and `window.garage.configurator` before measuring.
- Useful levers: `?car=<id>`, `localStorage` keys `garage.venue.v1` (garage),
  `garage.car.v1`, `garage.graphics.v1`, `garage.reel.v1` (video shot list),
  `garage.panel-path.v1` (open panel page), `garage.sun.v1` (sun per open-air garage),
  `garage.interior.v1` (interior lights per garage), `garage.car-position.v1` (car placement per car); `renderer.info` for leaks and draw counts;
  `/sys/class/drm/card1/device/gpu_busy_percent` for GPU load (it's a smoothed value).
- Note: setting the garage via localStorage skips its grade look — pick it through the
  UI when judging colour.
- Video bitrate is set explicitly from bits per pixel per frame × fps (`videoBitrate`):
  mediabunny's own `Quality('high')` ignores frame rate and gave ~6 Mbps at 1080p60 — visibly
  blocky on renders. Presets: standard 0.08 / high 0.15 / very high 0.25 / max 0.4 bpp.
- Video: click "Export MP4" with `acceptDownloads`, save the download, and tile frames with
  `ffmpeg -i out.mp4 -vf "select='not(mod(n\,20))',scale=384:-1,tile=6x4" -frames:v 1 tiles.png`.
  Headless Chromium encodes H.264; 1080p60 takes ~2 s of export per second of video on the RX 7600.
- Path tracing cost (measured 2026-09-23): ~140 ms per sample at 1200×675, 4 bounces with
  the GT3 RS (empty bay ~60 ms), linear in pixels; BVH is already SAH. Realtime isn't
  reachable with three-gpu-pathtracer — only lower res/bounces, or temporal reprojection.

## Branch / PR state (2026-09-26)

Everything is on `main`: PRs #1–#10 are merged, and the old feature branches were deleted
(local and remote). Path tracing stays as it is for now (user's call). Start new work on a
fresh branch from `origin/main`.

Stacking lesson: a stacked PR merges into its **base branch**, not `main`. #5, #6, #7 and #9
merged into each other and `main` got none of it until #10 (`feat/stack-to-main`) brought the
whole stack in. After a base merges, retarget the next PR to `main` before merging it, or end
with one PR from the top of the stack to `main`.

The user's local `main` may still hold two pre-rewrite commits (`64d9f77`, `56b3b53`, both
already in history under other hashes). `origin/main` is the truth.
