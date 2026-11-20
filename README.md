# LiDAR Point Cloud 001

A multiplayer horror game in total darkness. You only see what your scanner touches.
Everyone who presses PLAY drops into the same facility, and every dot anyone scans is shared with everyone else.

Something lives down there. It is blind. It hears your scanner, your footsteps and, through your microphone, your voice.

## How it plays

- **Left mouse**: a fast stream of single points. Hold it as long as you like. Mouse wheel changes the beam width.
- **Right mouse (hold, release)**: a charged pulse that throws thousands of points in a cone. Next to a wall it paints a small circle, in a hall it reveals the room. It is loud.
- **WASD** move, **Shift** run (loud), **C** crouch (quiet).
- White dots are the world, green dots are stairs, blue dots are other operators, red dots are the thing.
- Blue and red dots are a frozen trace: they stay where the body was at the moment of the scan and fade within three seconds.
- Five levels: station, storage, mine, caves, the bottom. Whoever reaches the bottom ends the round and a new map is generated for everyone.
- Caught? You wake up on level 01.

## Tech

Zero build. ES modules, three.js and three-mesh-bvh from a CDN.

| File | Role |
| --- | --- |
| `js/world.js` | seeded procedural world, pathfinding, collision |
| `js/geometry.js` | triangle soup, BVH for lidar rays, black occluder |
| `js/cloud.js` | point cloud ring buffer on the GPU, beams |
| `js/scanner.js` | stream, pulse, replay of other players' scans |
| `js/figure.js` | capsule figures (operators, statues, creature) and ray tests |
| `js/monster.js` | creature AI, simulated by the host |
| `js/net.js` | Firebase Realtime Database: presence, host election, scans, rounds |
| `js/audio.js` | positional sound, wall occlusion, microphone meter |
| `js/title.js` | title screen simulation |
| `js/game.js`, `js/main.js` | session and boot |

Other clients never receive individual points. A scan travels as a tiny event (pose, power, seed) and every client casts the same rays against the same generated world.

The microphone only measures loudness on your device. Nothing is recorded or sent.

Run locally: `python3 Niepotrzebne/devserver.py 8641` and open `http://localhost:8641`. On localhost the game uses the `dev` realm.
Add `?solo=1` to play without the network.

Database rules for the `lidar001` block live in `rules/lidar001.rules.json`.

## Sound credits

All recordings come from Freesound and are CC0.

| Files | Recording | Author | License |
| --- | --- | --- | --- |
| `static` | [am band static.wav](https://freesound.org/people/cognito%20perceptu/sounds/38693/) | cognito perceptu | CC0 |
| `pipe` | [Metallic Pipe Hits on Concrete in Basement.aif](https://freesound.org/people/RutgerMuller/sounds/104373/) | RutgerMuller | CC0 |
| `scare2` | [Monster Screech.wav](https://freesound.org/people/thegoose09/sounds/125388/) | thegoose09 | CC0 |
| `bang2` | [Elevator-doors2x.mp3](https://freesound.org/people/Eelke/sounds/170420/) | Eelke | CC0 |
| `spark` | [Spark](https://freesound.org/people/elliott.klein/sounds/189630/) | elliott.klein | CC0 |
| `whisper` | [Four_Voices_Whispering_5.wav](https://freesound.org/people/geoneo0/sounds/193808/) | geoneo0 | CC0 |
| `amb_drip` | [Dripping water](https://freesound.org/people/Electroviolence/sounds/234554/) | Electroviolence | CC0 |
| `m_click2`, `m_click3` | [Predator Clicking 3](https://freesound.org/people/SlendyManGame/sounds/235529/) | SlendyManGame | CC0 |
| `breath` | [Young boy, frightened breathing.wav](https://freesound.org/people/SpliceSound/sounds/260186/) | SpliceSound | CC0 |
| `heart` | [Heart Beating](https://freesound.org/people/michorvath/sounds/273150/) | michorvath | CC0 |
| `charge`, `shock` | [defibrillator.wav](https://freesound.org/people/reg7783/sounds/321800/) | reg7783 | CC0 |
| `m_growl1`, `m_growl2`, `m_growl3` | [Stöhnen.wav](https://freesound.org/people/Jeffreys2/sounds/333469/) | Jeffreys2 | CC0 |
| `thump` | [LowThump_01.wav](https://freesound.org/people/Faulkin/sounds/336494/) | Faulkin | CC0 |
| `m_step1`, `m_step2`, `m_step3`, `m_step4`, `m_step5`, `m_step6` | [Footsteps, barefoot on wet tile.wav](https://freesound.org/people/SpliceSound/sounds/338106/) | SpliceSound | CC0 |
| `drip` | [Water Drop 01](https://freesound.org/people/LilMati/sounds/348022/) | LilMati | CC0 |
| `step_b1`, `step_b2`, `step_b3`, `step_b4`, `step_b5`, `step_b6` | [Footsteps_6_Dirt_shoe.wav](https://freesound.org/people/monte32/sounds/353799/) | monte32 | CC0 |
| `bang1` | [Bang 2.wav](https://freesound.org/people/dbspin/sounds/396555/) | dbspin | CC0 |
| `amb_deep` | [Dark Cave Drone](https://freesound.org/people/Kinoton/sounds/421826/) | Kinoton | CC0 |
| `scare` | [monster shriek.ogg](https://freesound.org/people/Darsycho/sounds/442564/) | Darsycho | CC0 |
| `amb_station` | [room tone large room church basement heavy deep ventilation or furnace hum.flac](https://freesound.org/people/kyles/sounds/451924/) | kyles | CC0 |
| `gong` | [Black Gong](https://freesound.org/people/sleepCircle/sounds/473523/) | sleepCircle | CC0 |
| `m_groan` | [groan.mp3](https://freesound.org/people/Kneeling/sounds/473525/) | Kneeling | CC0 |
| `door` | [door close distant 1.wav](https://freesound.org/people/IanStarGem/sounds/478076/) | IanStarGem | CC0 |
| `m_click1` | [Alien Clicks.wav](https://freesound.org/people/michael_grinnell/sounds/512472/) | michael_grinnell | CC0 |
| `step_a1`, `step_a2`, `step_a3`, `step_a4` | [Hiking Boot Footsteps on Stone](https://freesound.org/people/Fission9/sounds/521590/) | Fission9 | CC0 |
| `bone1`, `bone2`, `bone3`, `bone4`, `bone5`, `bone6` | [Bone Breaks (celery snaps)](https://freesound.org/people/ericnorcross81/sounds/574752/) | ericnorcross81 | CC0 |
| `m_shriek` | [Scary horror terror shriek](https://freesound.org/people/SamsterBirdies/sounds/580320/) | SamsterBirdies | CC0 |
| `m_click4` | [bat-like monster sonar click.wav](https://freesound.org/people/vestibule-door/sounds/669717/) | vestibule-door | CC0 |
| `geiger` | [Geiger counter (dry)](https://freesound.org/people/Sanderboah/sounds/674113/) | Sanderboah | CC0 |
| `m_throat1`, `m_throat2` | [Weird Throat Clicking](https://freesound.org/people/Fupicat/sounds/688417/) | Fupicat | CC0 |
