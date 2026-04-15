// First-person player: movement, camera, weapon, shooting, health.
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const GRAVITY = 28;
const EYE_HEIGHT = 1.7;

export class Player {
  constructor({ camera, scene, domElement, gunGLB, sfx }) {
    this.camera = camera;
    this.scene = scene;
    this.sfx = sfx;
    this.controls = new PointerLockControls(camera, domElement);
    scene.add(this.controls.getObject());

    this.velocity = new THREE.Vector3();
    this.input = { f: 0, b: 0, l: 0, r: 0, sprint: false, jump: false };
    this.onGround = true;

    // Stats (upgradeable)
    this.maxHp = 100; this.hp = 100;
    this.armor = 0;
    this.moveSpeed = 4.5;
    this.damage = 22;
    this.fireRate = 7;    // shots/sec
    this.reloadTime = 1.8;
    this.magSize = 30;
    this.ammo = 30;
    this.reserve = 120;
    this.headshotMult = 2.2;

    this._fireCd = 0;
    this._reloading = 0;
    this._bob = 0;
    this._lastGroundY = 0;

    // Gun rig: outer pivot holds world-space offset, inner pivot handles model-space orientation.
    const gunPivot = new THREE.Group();
    const gunInner = new THREE.Group();
    const gun = gunGLB.scene;
    gun.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.frustumCulled = false;
        // Make sure PBR materials pick up the scene environment for reflections
        if (o.material && 'envMapIntensity' in o.material) o.material.envMapIntensity = 1.0;
      }
    });
    // Scale to ~0.55m long
    const gbox = new THREE.Box3().setFromObject(gun);
    const gsize = gbox.getSize(new THREE.Vector3());
    const gmax = Math.max(gsize.x, gsize.y, gsize.z) || 1;
    gun.scale.setScalar(0.55 / gmax);
    // Re-measure at new scale, then offset the gun so its center sits at the inner pivot
    const gbox2 = new THREE.Box3().setFromObject(gun);
    const gcenter = gbox2.getCenter(new THREE.Vector3());
    gun.position.sub(gcenter);
    gunInner.add(gun);
    // Inner rotation aligns the gun's barrel with -Z (camera forward)
    // Values here will be tweaked live via number keys 1-6 if needed.
    gunInner.rotation.set(0, 0, 0);
    gunPivot.add(gunInner);
    gunPivot.position.set(0.22, -0.22, -0.55);
    this.camera.add(gunPivot);
    this.gun = gunPivot;
    this._gunInner = gunInner;

    // Muzzle flash
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0 });
    this.flash = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), flashMat);
    this.flash.position.set(0.3, -0.24, -0.9);
    this.camera.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffcc66, 0, 4, 2);
    this.camera.add(this.flashLight);

    this._bindInput();
    this.spawn(new THREE.Vector3(0, EYE_HEIGHT, 0));
  }

  spawn(pos) {
    this.controls.getObject().position.copy(pos);
    this.velocity.set(0, 0, 0);
    this._lastGroundY = pos.y - EYE_HEIGHT;
  }

  _bindInput() {
    const k = this.input;
    addEventListener('keydown', (e) => {
      switch (e.code) {
        case 'KeyW': k.f = 1; break;
        case 'KeyS': k.b = 1; break;
        case 'KeyA': k.l = 1; break;
        case 'KeyD': k.r = 1; break;
        case 'ShiftLeft': k.sprint = true; break;
        case 'Space': if (this.onGround) { this.velocity.y = 9; this.onGround = false; } break;
        case 'KeyR': this.reload(); break;
        // Debug: tweak gun orientation live. Press these and log final values.
        case 'BracketLeft':  this._gunInner.rotation.y -= 0.1; console.log('gun rot', this._gunInner.rotation); break;
        case 'BracketRight': this._gunInner.rotation.y += 0.1; console.log('gun rot', this._gunInner.rotation); break;
        case 'Semicolon':    this._gunInner.rotation.x -= 0.1; console.log('gun rot', this._gunInner.rotation); break;
        case 'Quote':        this._gunInner.rotation.x += 0.1; console.log('gun rot', this._gunInner.rotation); break;
      }
    });
    addEventListener('keyup', (e) => {
      switch (e.code) {
        case 'KeyW': k.f = 0; break;
        case 'KeyS': k.b = 0; break;
        case 'KeyA': k.l = 0; break;
        case 'KeyD': k.r = 0; break;
        case 'ShiftLeft': k.sprint = false; break;
      }
    });

    this._firing = false;
    addEventListener('mousedown', (e) => { if (e.button === 0) this._firing = true; });
    addEventListener('mouseup',   (e) => { if (e.button === 0) this._firing = false; });
  }

  reload() {
    if (this._reloading > 0 || this.ammo === this.magSize || this.reserve <= 0) return;
    this._reloading = this.reloadTime;
    this.sfx?.play('reload');
  }

  takeDamage(dmg) {
    const absorb = Math.min(this.armor, dmg * 0.5);
    this.armor -= absorb;
    this.hp -= (dmg - absorb);
    document.getElementById('dmgvignette').classList.add('hit');
    setTimeout(() => document.getElementById('dmgvignette').classList.remove('hit'), 180);
    this.sfx?.play('hurt');
  }

  get position() { return this.controls.getObject().position; }

  update(dt, game) {
    const obj = this.controls.getObject();
    const input = this.input;

    // --- Horizontal velocity from input ---
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0; forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));

    const wish = new THREE.Vector3();
    wish.addScaledVector(forward, input.f - input.b);
    wish.addScaledVector(right,  input.r - input.l);
    if (wish.lengthSq() > 0) wish.normalize();

    const speed = this.moveSpeed * (input.sprint ? 1.4 : 1);
    const targetVx = wish.x * speed;
    const targetVz = wish.z * speed;
    // Snappy damping
    const t = Math.min(1, 14 * dt);
    this.velocity.x += (targetVx - this.velocity.x) * t;
    this.velocity.z += (targetVz - this.velocity.z) * t;

    // --- Gravity ---
    this.velocity.y -= GRAVITY * dt;

    // --- Integrate horizontal first (so wall collision only pushes X/Z) ---
    obj.position.x += this.velocity.x * dt;
    obj.position.z += this.velocity.z * dt;
    if (game?.resolveCollision) game.resolveCollision(obj.position, 0.5);

    // --- Ground sample (single cast from high up — stable) ---
    let groundY = null;
    if (game?.groundAt) groundY = game.groundAt(obj.position.x, obj.position.z, 5000);
    if (groundY == null) groundY = this._lastGroundY;
    // Never let the ground sink below street level (prevents walking into
    // basements/underground sections through broken colliders).
    if (game?.streetY != null && groundY < game.streetY - 0.2) groundY = game.streetY;
    // Ignore large downward drops in one frame (basement floors beneath
    // open streets). A big jump down more than 3u is probably a hole.
    if (groundY < this._lastGroundY - 3) groundY = this._lastGroundY;
    this._lastGroundY = groundY;

    // --- Integrate vertical and clamp to ground ---
    obj.position.y += this.velocity.y * dt;
    const floor = groundY + EYE_HEIGHT;
    if (obj.position.y <= floor) {
      obj.position.y = floor;
      this.velocity.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    // Clamp to map bounds
    const b = game?.mapBounds;
    if (b) {
      obj.position.x = THREE.MathUtils.clamp(obj.position.x, b.minX, b.maxX);
      obj.position.z = THREE.MathUtils.clamp(obj.position.z, b.minZ, b.maxZ);
    }

    // --- Weapon ---
    if (this._reloading > 0) {
      this._reloading -= dt;
      // dip gun
      this.gun.rotation.x = THREE.MathUtils.lerp(this.gun.rotation.x, -0.6, 0.15);
      if (this._reloading <= 0) {
        const needed = this.magSize - this.ammo;
        const take = Math.min(needed, this.reserve);
        this.ammo += take; this.reserve -= take;
      }
    } else {
      this.gun.rotation.x = THREE.MathUtils.lerp(this.gun.rotation.x, 0, 0.2);
    }

    this._fireCd -= dt;
    if (this._firing && this._fireCd <= 0 && this._reloading <= 0) {
      if (this.ammo > 0) {
        this.shoot(game);
        this._fireCd = 1 / this.fireRate;
      } else if (this.reserve > 0) {
        this.reload();
      } else {
        this.sfx?.play('empty');
        this._firing = false;
      }
    }
    // Auto-reload when empty
    if (this.ammo === 0 && this.reserve > 0 && this._reloading <= 0) {
      this.reload();
    }

    // Fade muzzle flash
    this.flash.material.opacity = THREE.MathUtils.damp(this.flash.material.opacity, 0, 18, dt);
    this.flashLight.intensity = THREE.MathUtils.damp(this.flashLight.intensity, 0, 18, dt);
  }

  shoot(game) {
    this.ammo--;
    this.sfx?.play('shoot');
    this.flash.material.opacity = 1;
    this.flashLight.intensity = 3;

    // Recoil kick — position only, rotation is lerped in update()
    this.gun.position.z = -0.5;
    setTimeout(() => { this.gun.position.z = -0.55; }, 40);

    // Raycast from camera center
    const origin = new THREE.Vector3();
    this.camera.getWorldPosition(origin);
    const dirv = new THREE.Vector3();
    this.camera.getWorldDirection(dirv);

    const ray = new THREE.Raycaster(origin, dirv, 0, 300);
    const hits = ray.intersectObjects(game.enemies.map((e) => e.hitbox), false);
    if (hits.length) {
      const hit = hits[0];
      const enemy = hit.object.userData.enemy;
      const isHead = hit.point.y > enemy.mesh.position.y + 1.7;
      const dmg = this.damage * (isHead ? this.headshotMult : 1);
      enemy.takeDamage(dmg, isHead);
      game.onHit(isHead);
    }
  }
}
