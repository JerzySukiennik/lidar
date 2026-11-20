// LiDAR Point Cloud 001: first-person body (walking, sprinting, crouching, stairs between floors, footsteps).

export const WALK = 2.7, SPRINT = 5.3, CROUCH = 1.35, RADIUS = 0.3, EYE = 1.62;

export class Player {
  constructor(world) {
    this.world = world;
    this.x = 0; this.z = 0; this.y = 0; this.f = 0;
    this.yaw = 0; this.pitch = 0;
    this.vx = 0; this.vz = 0;
    this.crouch = 0;
    this.stamina = 1;
    this.winded = false;
    this.phase = 0;
    this.speed = 0;
    this.sprinting = false;
    this.bob = 0;
  }

  place(a) {
    this.x = a.x; this.z = a.z; this.f = a.f; this.yaw = a.yaw || 0; this.pitch = 0;
    this.vx = 0; this.vz = 0; this.crouch = 0; this.stamina = 1; this.winded = false;
    this.y = this.world.groundY(this.f, this.x, this.z);
  }

  look(dx, dy) {
    this.yaw -= dx * 0.0022;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - dy * 0.0022));
  }

  update(dt, inp) {
    const w = this.world, steps = [];
    const wantCrouch = inp.crouch ? 1 : 0;
    this.crouch += (wantCrouch - this.crouch) * Math.min(1, dt * 9);
    let mx = inp.strafe, mz = inp.forward;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    const moving = ml > 0.05;
    if (this.stamina <= 0) this.winded = true;
    if (this.stamina > 0.3) this.winded = false;
    this.sprinting = inp.sprint && moving && mz > 0 && !inp.crouch && !this.winded;
    this.stamina = Math.max(0, Math.min(1, this.stamina + (this.sprinting ? -dt / 5.5 : dt / 9)));
    const top = this.sprinting ? SPRINT : inp.crouch ? CROUCH : WALK;
    const sn = Math.sin(this.yaw), cs = Math.cos(this.yaw);
    const tx = (-sn * mz + cs * mx) * top, tz = (-cs * mz - sn * mx) * top, k = Math.min(1, dt * 11);
    this.vx += (tx - this.vx) * k;
    this.vz += (tz - this.vz) * k;
    const sub = dt > 0.025 ? 2 : 1, px = this.x, pz = this.z;
    for (let s = 0; s < sub; s++) {
      const p = w.resolve(this.f, this.x + (this.vx * dt) / sub, this.z + (this.vz * dt) / sub, RADIUS);
      this.x = p[0]; this.z = p[1];
      const R = w.rampOf(this.f, this.x, this.z);
      if (R) this.f = w.rampS(R, this.x, this.z) / R.L < 0.5 ? R.f : R.f + 1;
    }
    const moved = Math.hypot(this.x - px, this.z - pz);
    this.speed = dt > 0 ? moved / dt : 0;
    const gy = w.groundY(this.f, this.x, this.z);
    this.y += (gy - this.y) * Math.min(1, dt * 16);
    const stride = this.sprinting ? 1.05 : inp.crouch ? 0.55 : 0.78, before = Math.floor(this.phase / Math.PI);
    this.phase += (moved / stride) * Math.PI;
    if (Math.floor(this.phase / Math.PI) !== before && moved > 0.0005) {
      steps.push(this.sprinting ? 2 : this.crouch > 0.5 ? 0 : 1);
    }
    const amp = Math.min(1, this.speed / WALK) * (this.sprinting ? 0.055 : 0.032) * (1 - 0.5 * this.crouch);
    this.bob += (Math.abs(Math.sin(this.phase)) * amp - this.bob) * Math.min(1, dt * 14);
    return steps;
  }

  eyeY() { return this.y + EYE - 0.62 * this.crouch - this.bob; }

  onStairs() { return !!this.world.rampOf(this.f, this.x, this.z); }
}
