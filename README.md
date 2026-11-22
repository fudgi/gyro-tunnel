# Gyro Tunnel

Browser MVP: a plane stays fixed at the center of the screen while a 3D tunnel
and oncoming meteors roll around it. On a phone, lock screen rotation if you can, then rotate the device like a
steering wheel (gravity-vector roll from `DeviceMotionEvent`). On desktop,
use arrow keys / A-D or drag with the mouse.

MVP has no score, levels, or power-ups — just the core dodge mechanic and
tap-to-restart after a collision.

## Develop

```bash
npm install
npm run dev
```

Open the URL on your phone (HTTPS or localhost). iOS will ask for motion
permission after you tap to start.

## Build

```bash
npm run build
npm run preview
```
