# CENTURY

Two halves of one game. **Survival** is a 2D maze where you hold out for a
hundred nights. **World mode** is a 3D voxel world you own and build in. What
you drag out of a survival run is what you have to build with.

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

To produce a single self-contained `.html` file (everything inlined, for
dropping on any host or opening directly):

```sh
npx esbuild src/main.js --bundle --format=iife --charset=ascii --outfile=century.js
```

then inline that output and `style.css` into a copy of `index.html`. Nothing in
the repository depends on this — it's only for when one file is easier to move
around than fifteen.

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

## The two halves

### Survival — the 2D game
A hundred nights in a Pac-Man-ish maze. Gather, build a base, fight, evacuate
when a place gets too hot. Runs always start you empty-handed; that is what
makes them worth playing. Everything you are carrying when the run ends gets
**banked**.

### World mode — your own 3D world
A voxel island, first person, that you own. Being the owner is what gives you
the **admin panel**: creative rules by default (free blocks, flight, nothing
can hurt you), plus control of the clock, the monsters, and whether visitors
may build. Flip a world to **survival rules** and blocks start costing real
materials and monsters come at night — for people who want their walls to mean
something.

Worlds save to this browser. You can copy one out as text and someone else can
import it, but it arrives stamped with your owner id, so it lands read-only for
them unless you left visitor building switched on. There is no server: nothing
here is multiplayer, and a world is never shared live between two people.

### The bank ties them together
One profile spans both. Materials flow **survival → worlds**, never back, so no
amount of building can make a night easier. Crystal is the clearest case: a
whole generated island holds about twenty crystal blocks, while ghosts drop two
apiece. **If you want crystal, go and take it off a ghost.**

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

### What they leave behind

| | drops |
|---|---|
| **Ghost** | 2 crystal, 1 **laser battery** |
| **Vampire** | 2 fuel, 1 **fang** |
| **Zombie** | 4 iron, 2 **bones**, and at 5% a piece of **iron plating** |

Batteries make laser cells six at a time and power the emitter block in world
mode. Bones and fangs make **bone armour** (&minus;22% off every hit, +15
health). Iron plating is the rarest thing in the game and the only route to
**iron armour** (&minus;42%, +35 health) — armour never downgrades, so a spare
set of bones is wasted on it.

### Gunpowder and the laser gun

**Gunpowder has exactly one source: a ghost and a vampire dying within two and
a half seconds of each other.** Both deaths are spent on the payout, so a
single ghost kill cannot be cashed against a row of vampires — every charge
costs a fresh pair.

Spend it on the **laser gun**: 3 laser beams, 6 iron, 2 gunpowder, at a
workbench. Laser beams are bottled crystal. It is the only weapon in the game
that hurts all three monsters properly, which is the point of making it that
hard to reach.

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

**Laser emitters.** In world mode, an emitter block watches fourteen blocks
around it and burns anything that comes near. It costs a laser beam, a battery
and two iron — so a defended base is paid for out of ghosts.

## Layout

```
index.html          shell, title card
style.css           page chrome around the canvas
src/config.js       every tunable: monsters, weapons, drops, armour, recipes
src/game.js         the loop — clock, waves, combat, crafting, evacuation
src/profile.js      the one save that spans both halves
src/worlds.js       world records, ownership, export and import
src/menu.js         the front door
src/builder/        world mode: blocks.js, voxel.js, builder.js
vendor/             three.js r180, committed so world mode works offline
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

Damage multipliers, monster stats, drop tables, armour values, recipes, wave
composition and the day/night curve all live in `src/config.js` — that's the
file to open to rebalance anything. Block types and their costs live in
`src/builder/blocks.js`.

World mode loads three.js only when you open a world, so the 2D game costs
nothing if you never do. The library is committed under `vendor/` rather than
pulled from a CDN, so it works offline and behind a strict content policy.
