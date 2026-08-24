# CENTURY

A 2D survival game. Survive one hundred nights. Then keep going — the count
doesn't stop at a century, and neither does the run.

You wake up somewhere with nothing. **The first five nights, nothing comes.**
That's your window: sweep the corridors for materials, put up a workbench,
ring your ground in torchlight, and get a vehicle built in case the place
turns out to be indefensible. On night six they arrive, and they keep arriving
until one of them gets you.

## Playing it

**<https://davidalexandermurray91-png.github.io/century2.0/>**

To run it locally: it's plain HTML, CSS and JavaScript modules — no build step,
no dependencies. ES modules won't load over `file://`, so serve the folder:

```sh
python3 -m http.server 8000     # then open http://localhost:8000
```

### Controls

| | |
|---|---|
| `WASD` / arrow keys | move (release to stop) |
| `Space` | attack with the equipped weapon |
| `1`–`6` | choose a weapon |
| `Q` | cycle weapons |
| `Tab` | crafting |
| `B` | build mode — `Q`/`E` to pick, `Space` to place, `X` to salvage |
| `E` | get in the vehicle · hold on an `EXIT` tile to evacuate |
| `F` | burn a flare |
| `C` | field notes on the three monsters |
| `M` | sound on/off |

## The three things out there

Nothing is a universal answer. Bringing the wrong weapon to the wrong monster
is how runs end.

**Ghost** — drifts straight through walls, so your barricades mean nothing to
it. Bullets, arrows and steel pass through it just as cleanly. Only **laser**
and **light** touch it.

**Vampire** — fast, and it closes the gap in sudden dashes. It burns in
**light**, and it physically cannot walk past a **garlic pizza**: throw one and
it will stop mid-chase to eat, which is the last thing it does.

**Mutant zombie** — enormous, slow, and it comes *through* your walls rather
than around them. **Guns, arrows and swords** are what kill it — but it wears
an iron spiked shoulder pad on one arm, and anything landing on that side
sparks off it for almost nothing. Watch which side the pad is on and hit the
other one.

All three hate light, which is why a torch-lit base does a lot of the fighting
for you. Not all of it: the zombie barely notices, and anything that spends too
long failing to reach you stops respecting the torches and comes in anyway.

## Systems

**Day and night.** Days start long enough to build something worth defending
and get shorter as the century goes on; nights do the opposite. A full century
is roughly an hour and a bit.

**Gathering.** Materials lie about the maze as dots you collect by walking over
them, Pac-Man style — scrap, wood, iron, crystal, fuel, and the dough and
cheese a pizza needs. More scatters at dawn. The four corners hold **flares**,
which light the entire map at once and burn everything standing on it.

**Building.** Barricades, torches, a workbench, and laser turrets. Torches are
the backbone of a base. Salvaging a building returns half its cost.

**Crafting.** Weapons and ammunition, plus the four vehicle parts — chassis,
engine, wheels and fuel tank. The heavier recipes need you stood at a
workbench.

**Evacuating.** Build all four parts and a vehicle assembles beside your bench.
Drive it to a green `EXIT` on the top or bottom edge and hold `E`. You arrive
at a fresh location with your inventory, your weapons and your vehicle — but
no base, and the ground reset to bare scrap. Each night you stay in one place
raises its **heat**, and heat makes the waves worse; evacuating clears it.

**The side tunnels.** The middle row runs off both edges of the map and comes
back the other side. So does everything chasing you.

## Layout

```
index.html          shell, title card
style.css           page chrome around the canvas
src/config.js       every tunable: monsters, weapons, recipes, pacing curves
src/game.js         the loop — clock, waves, combat, crafting, evacuation
src/world.js        maze generation, pellets, buildings, light and flow fields
src/monsters.js     the three of them, and how they think
src/player.js       inventory, weapons, health, build mode
src/movement.js     arcade grid movement with buffered turns
src/projectiles.js  bullets, arrows, thrown pizza, beams, particles
src/vehicle.js      driving and ramming
src/render.js       the canvas renderer
src/hud.js          HUD, crafting menu, field notes
src/audio.js        WebAudio noises, no asset files
src/input.js        keyboard and mouse
src/main.js         bootstrap and the frame loop
```

Damage multipliers, monster stats, recipes, wave composition and the day/night
curve all live in `src/config.js` — that's the file to open to rebalance
anything.
