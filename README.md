# ARNA Web Control

Browser-based teleoperation GUI for the ARNA mobile manipulator (Kinova Gen3 7-DOF arm + omnidirectional mobile base). It's a static Node.js/React/Next.js/TypeScript site — no server-side rendering — that talks directly to ROS from the browser over rosbridge websockets. It can be hosted on the robot's control machine or any other computer using a web server like nginx.

## Features
- Arm Cartesian velocity control via joysticks, with XY / YZ / XZ plane selection and a normal-axis slider
- Arm rotation control (roll / pitch / yaw joysticks)
- Gripper open/close slider with live position feedback
- Home button — drives the arm to a fixed joint-angle pose via the Kinova `execute_action` service
- Mobile base translation + rotation joysticks, publishing to `/ARNA_TELEOP_MOV`
- Dual live camera viewers (arm + base), streamed as CBOR-compressed JPEG over rosbridge
- Click-to-pick: click a point in the arm camera feed, then trigger the pick-and-place pipeline
- Network quality probe (round-trip latency) and a safety-mode badge (NOMINAL / DEGRADED / POOR / FAILED) fed by a network watchdog node
- Light/dark theme toggle

## Architecture
The frontend opens three separate websocket connections so that video bandwidth can never stall control traffic:

| Connection | Purpose |
|---|---|
| Control | joystick/service commands, gripper, home, safety mode, network probe |
| Base camera | base RGB camera stream |
| Arm camera | Kinova wrist camera stream |

These map to three separate rosbridge servers on the robot's control host, fronted by a Cloudflare tunnel for remote access. Full system topology — ROS master placement, robot-side runtime, camera pipeline tuning, safety watchdog behavior, deployment/runtime procedure — is documented in [`Architecture Overview.txt`](./Architecture%20Overview.txt).

## File Structure
- `app/` — Next.js app router entry point.
  - `page.tsx` — the entire control UI: ROS connections, topic/service definitions, and all UI components.
  - `layout.tsx` — root layout.
  - `globals.css` / `fonts/` — global styles and fonts.
- `components/`
  - `Joystick2D.tsx` / `Joystick1D.tsx` — custom pointer/touch-driven joystick controls.
  - `Joystick.module.css` — joystick styling.
  - `TFViewer.tsx` — three.js TF-tree visualizer. Currently disabled (commented out in `page.tsx`, replaced by the base control joysticks); can be re-enabled there if needed.
- Root-level files (`next.config.ts`, `tailwind.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `.eslintrc.json`) configure the build, styling, and linting.

## Key packages
Worth familiarizing yourself with before contributing:
- TypeScript, Node.js, React, Next.js
- Tailwind CSS + DaisyUI (styling)
- three.js (used only by the currently-disabled TF viewer)
- `@breq/roslib` — TypeScript rosbridge client

See `package.json` for the full dependency list.

## Building and running
1. Clone the repo
2. Install Node.js 20+ (`node -v` to check version)
3. On an old Ubuntu release (e.g. Ubuntu 18), follow [these instructions](https://github.com/nodesource/distributions/issues/1392#issuecomment-1815887430) to install Node.js 20
4. From the repo root (same folder as `package.json`): `npm i`
5. `npm run dev` — starts a local dev server at `localhost:3000`
6. `npm run build` — produces a static production build in `out/`; copy that folder to any static web server (nginx, etc.) to host the site

In production, the exported build is served locally on `127.0.0.1:3000` (managed via a systemd service) and exposed remotely through a Cloudflare tunnel. See `Architecture Overview.txt` for deployment details and operational health checks.

## Notes
- The ROS websocket URLs and topic/service names in `app/page.tsx` are hardcoded for the current production deployment — update them there if the rosbridge endpoints or topic names change.
- The TF tree viewer (`components/TFViewer.tsx`) is currently disabled in `page.tsx`; the commented-out sections show how to re-enable it.
