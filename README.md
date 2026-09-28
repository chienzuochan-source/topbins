# Top Bins

A browser football game. It's six-a-side, Reds against Blues. It started as Fairgreens, a golf game, and the golf swing's power bar and strike bar are now how you shoot.

**Play it:** once it's published (see *Publishing* below), the game is at `https://<your-github-name>.github.io/top-bins/`.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
npm test         # shooting, ball physics, match rules and online sync tests
```

## The home screen

- **Play the computer**: you're the Reds and the computer plays the Blues.
- **Multiplayer**:
  - **Online**: two players on two devices. **Make a room** gives you a 4-letter code and an invite link. Your friend types the code (or opens the link) and presses **Join**. The one who made the room plays the Reds, and their friend plays the Blues.
  - **Same keyboard**: two players on one computer.
- **How to play**: all the controls.
- **Computer**: how good the bot is, from **Easy** to **Normal**, **Hard** and **Legend**. Harder bots run faster, tackle more, shoot straighter, and slide in more often, and their keeper saves more. Your own teammates always play at Normal.
- **Match**: 2, 4 or 6 minutes for the full 90.

Both settings are remembered.

## Controls

| Key | What it does |
| --- | --- |
| `W` `A` `S` `D` (or the arrow keys) | Run. You control the player with the ring round their feet. |
| `Shift` | Sprint. It uses up stamina, which comes back while you jog. |
| `E` | Pass along the ground. It goes to the teammate you're facing, or the way you're pressing. |
| `Q` | Lofted pass over the defenders. |
| `Space` | Shoot (see below). |
| `T` | Slide tackle. |
| `C` | Switch player. Press it again to go to the next nearest. |
| `P` / `Esc` | Pause. |
| `M` | Mute. |

You can also tackle by running into whoever has the ball.

**Two on one keyboard:** the Reds use the keys above, with `Left Shift` to sprint. The Blues use the arrow keys to run, `Right Shift` to sprint, `K` to pass, `J` to lob, `L` to shoot, `U` to slide and `I` to switch.

**Phones and tablets:** put your left thumb anywhere on the left half of the screen and a joystick appears where you touched. The buttons on the right are **Shoot**, **Pass**, **Lob**, **Sprint**, **Slide** and **Switch**. Buttons that don't do anything right now are dimmed: shooting and passing when you haven't got the ball, and sliding and switching when you have. The game is best held sideways, and it tells you so if you hold the phone upright. Phones draw fewer pixels and softer shadows to keep the game smooth. Same-keyboard play needs a keyboard, so it's turned off on touch screens.

## Shooting: power bar and strike bar

This works like the golf swing in Fairgreens:

1. **Hold Space** to wind up. The power bar fills. Past 100% is the red zone: the shot is harder but rises over the bar, and the green band gets narrower. Stay in the red too long and you lose your balance.
2. **Let go** and the strike needle runs across the strike bar.
3. **Press Space again** while the needle is in the green band. The gold centre is a **perfect strike**. A touch early pulls the shot and a touch late pushes it. Too early and you lean back and sky it. Too late and you scuff it along the ground. Way off and you shank it. If you never press, it's an air kick and your player falls over.

Hold `W` or `S` as you strike to aim for the far or near post. Otherwise the shot goes to the far post. A ring on the goal shows where it's heading. If a defender is close, the green band is narrower.

## Slide tackles

Press `T` and your player slides in the way you're running, or the way you're pressing. If the slide reaches the ball, the ball is knocked loose and it's yours to chase. If it takes the player and not the ball, that's a **foul**: a free kick to the other side. Either way you're on the ground for a moment afterwards, so a missed slide leaves a gap behind you. On Normal and above, the computer slides in too.

## Switching player

When the other side has the ball, the game moves you onto whoever's nearest it. Press `C` to choose for yourself: it goes to the nearest teammate, and pressing it again goes to the next one. After you press `C`, the game waits a couple of seconds before switching you by itself, so it doesn't undo your choice.

## The rules it plays

- **Kick-off** at the start and after every goal. The side that conceded kicks off. Until the kicker plays the ball, the other side has to stay in its own half and out of the centre circle, so nobody can rush you. You have to pass to start (`E` or `Q`).
- **Throw-ins, corners and goal kicks** when the ball goes out. On a throw-in or corner you have to pass.
- **Free kicks** after a foul. You can pass or shoot.
- Keepers come out for loose balls, dive for shots, and can parry them or catch them.
- The ball can hit the posts and crossbar, and ends up in the net.
- There's no offside.

## Online play: how it works

Online play is peer to peer, using [PeerJS](https://peerjs.com). The player who makes the room hosts it. Their browser runs the match and sends it to their friend about 30 times a second. The friend's browser sends back their controls. PeerJS's free public service is only used to help the two browsers find each other, so there's no server to set up and no accounts.

- If the friend drops out, the room stays open and they can join again with the same code. If the host leaves, the match ends.
- Online play needs the game running on a website, or on your computer with `npm run dev`. It doesn't work inside the claude.ai preview, because that blocks the connections it needs. The other modes work there.
- Some strict networks (school, office or mobile networks) block direct connections. PeerJS's free relay servers are used then, but those can be slow or busy.
- To test online play without the internet, run a PeerJS server on your computer (`npx -p peer peerjs --port 9000`). Then start the game with `VITE_PEER_HOST=localhost:9000 npm run dev` and open it in two browser windows.

## How the code is laid out

| File | What's in it |
| --- | --- |
| `src/game/ShotMeter.js` | The power and strike bars, and how a press on the strike bar turns into a shot. It's based on the golf swing from Fairgreens. |
| `src/game/Match.js` | The whole match: players, passing, shooting, tackles and slides, keepers, the AI and its skill levels (`SKILL`), and the rules. It has no graphics, so the tests can run it. |
| `src/game/Ball.js` | Ball physics: gravity, bounces, grass friction and curve. |
| `src/game/pitch.js` | Pitch and goal sizes. |
| `src/game/Input.js` | The keyboard controls (one or two players) and the on-screen touch controls. |
| `src/net/Online.js` | Online rooms: making one, joining one, and sending messages between the two browsers. |
| `src/net/sync.js` | What the host sends the guest (a snapshot of the match), and how the guest's controls get back to the host. |
| `src/render/Scene.js` | The 3D drawing with three.js: pitch, goals, stadium, players, ball and the TV camera. |
| `src/ui/HUD.js` | Scoreboard, each player's stamina and shot meters, announcements and the radar. |
| `src/main.js` | The home screen and menus, and the game loop for each mode. |
| `src/audio/Sfx.js` | Kicks, whistle and crowd noise, made in code (there are no sound files). |

## Publishing

Every push to `main` runs the tests, builds the game and publishes it with GitHub Pages (`.github/workflows/pages.yml`). The first time, if the workflow can't turn Pages on by itself, go to the repository's **Settings → Pages** and set **Source** to **GitHub Actions**, then run the workflow again from the **Actions** tab.

Some easy things to change:

- **Match lengths on the home screen**: the `#length` buttons in `index.html`.
- **How good each bot level is**: `SKILL` in `src/game/Match.js`.
- **Run and sprint speed**: `JOG` and `SPRINT` in the same file.
- **Team line-up**: `FORMATION` in the same file.
- **Kit colours**: `KITS` in `src/render/Scene.js`.
- **How hard shooting is**: the `window` and `tempo` passed to `meter.setup` in `handleHuman` (`src/game/Match.js`). A bigger window is easier and a longer tempo makes the needle slower.
