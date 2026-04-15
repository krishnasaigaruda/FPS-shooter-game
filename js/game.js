// Game manager: waves, enemies, scoring, upgrades, win/lose.
import * as THREE from 'three';
import { Player } from './player.js';
import { Enemy } from './enemy.js';
import { SFX } from './audio.js';

const MAX_ROUND = 10;

export class Game {
  constructor({ renderer, scene, camera, composer, playerGLB, enemyGLB, gunGLB, mapRoot, ui, spawnPoint, mapBounds, streetY }) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.composer = composer;
    this.enemyTemplate = enemyGLB;
    this.mapRoot = mapRoot;
    this.ui = ui;
    this.sfx = new SFX();
    this.mapBounds = mapBounds;
    this.streetY = streetY;

    this.enemies = [];
    this.pickups = [];
    this._groundRay = new THREE.Raycaster();
    this._down = new THREE.Vector3(0, -1, 0);
    this.startPos = new THREE.Vector3(spawnPoint.x, spawnPoint.y + 1.7, spawnPoint.z);
    this.score = 0;
    this.round = 0;
    this.killsThisRound = 0;
    this.roundKillQuota = 0;
    this.state = 'idle'; // idle | playing | between | over

    this.player = new Player({
      camera, scene, domElement: renderer.domElement, gunGLB, sfx: this.sfx,
    });
    // Hide the imported player.glb body in first person (keep for minimap/shadow if desired).
    this.playerBody = playerGLB.scene;
    this.playerBody.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.visible = false; }});
    scene.add(this.playerBody);
  }

  // Raycast downward; return Y of the first hit whose face points upward
  // (filters out ceilings, awnings, undersides that would teleport the player).
  groundAt(x, z, fromY = 1000) {
    this._groundRay.set(new THREE.Vector3(x, fromY, z), this._down);
    this._groundRay.far = 2000;
    const hits = this._groundRay.intersectObject(this.mapRoot, true);
    for (const h of hits) {
      if (!h.face) continue;
      // face normal in world space
      const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
      if (n.y > 0.2) return h.point.y;
    }
    return null;
  }

  // Push a point out of walls. Rays fire outward horizontally; if a wall is
  // within `radius`, we nudge the point away. Cheap, no mesh colliders needed.
  resolveCollision(pos, radius = 0.6) {
    const dirs = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [0.707, 0.707], [-0.707, 0.707], [0.707, -0.707], [-0.707, -0.707],
    ];
    const ray = this._groundRay;
    for (const [dx, dz] of dirs) {
      ray.set(new THREE.Vector3(pos.x, pos.y, pos.z), new THREE.Vector3(dx, 0, dz));
      ray.far = radius;
      const hits = ray.intersectObject(this.mapRoot, true);
      if (hits.length) {
        const push = radius - hits[0].distance + 0.01;
        pos.x -= dx * push;
        pos.z -= dz * push;
      }
    }
  }

  start() {
    this.ui.hideStart();
    this.player.spawn(this.startPos);
    this.player.controls.lock();
    this.state = 'playing';
    this.round = 0;
    this.spawnAmmoCrates(20);
    this.startNextRound();
  }

  spawnAmmoCrates(n) {
    for (let i = 0; i < n; i++) {
      // Random position inside map bounds with valid ground
      let p = null;
      for (let tries = 0; tries < 20; tries++) {
        const x = THREE.MathUtils.lerp(this.mapBounds.minX, this.mapBounds.maxX, Math.random());
        const z = THREE.MathUtils.lerp(this.mapBounds.minZ, this.mapBounds.maxZ, Math.random());
        const gy = this.groundAt(x, z, 5000);
        if (gy != null) { p = new THREE.Vector3(x, gy + 0.35, z); break; }
      }
      if (!p) continue;
      // Bright visible ammo crate (~1.5m cube)
      const group = new THREE.Group();
      const crate = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 1.0, 1.4),
        new THREE.MeshBasicMaterial({ color: 0xffcc00 })
      );
      const glow = new THREE.Mesh(
        new THREE.BoxGeometry(1.6, 1.2, 1.6),
        new THREE.MeshBasicMaterial({ color: 0xffff66, transparent: true, opacity: 0.25, side: THREE.BackSide })
      );
      group.add(crate);
      group.add(glow);
      const light = new THREE.PointLight(0xffcc00, 2, 12, 2);
      light.position.y = 1;
      group.add(light);
      group.position.copy(p);
      group.position.y += 0.6;
      this.scene.add(group);
      this.pickups.push({ mesh: group, amount: 60 });
    }
  }

  updatePickups() {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.mesh.rotation.y += 0.03;
      if (p.mesh.position.distanceTo(this.player.position) < 2) {
        this.player.reserve += p.amount;
        this.sfx.play('reload');
        this.scene.remove(p.mesh);
        this.pickups.splice(i, 1);
      }
    }
  }

  startNextRound() {
    this.round++;
    if (this.round > MAX_ROUND) { return this.endGame(true); }
    this.killsThisRound = 0;
    this.roundKillQuota = 4 + this.round * 2;
    this._spawnBudget = this.roundKillQuota;
    this._spawnTimer = 0;
    this._spawnInterval = Math.max(0.6, 2.0 - this.round * 0.12);
    this.state = 'playing';
  }

  spawnEnemy() {
    if (this._spawnBudget <= 0) return;
    // Retry up to 10 random positions until we find one with solid ground
    let pos = null;
    for (let tries = 0; tries < 10; tries++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 25 + Math.random() * 35;
      const p = new THREE.Vector3(
        this.player.position.x + Math.cos(angle) * dist,
        0,
        this.player.position.z + Math.sin(angle) * dist,
      );
      if (this.mapBounds) {
        p.x = THREE.MathUtils.clamp(p.x, this.mapBounds.minX, this.mapBounds.maxX);
        p.z = THREE.MathUtils.clamp(p.z, this.mapBounds.minZ, this.mapBounds.maxZ);
      }
      const gy = this.groundAt(p.x, p.z, 5000);
      if (gy == null) continue;
      // Require clear sky all the way up — any hit means we're under a
      // ceiling, awning, or floor of an upper level (inside a building).
      const upRay = this._groundRay;
      upRay.set(new THREE.Vector3(p.x, gy + 0.8, p.z), new THREE.Vector3(0, 1, 0));
      upRay.far = 500;
      const upHits = upRay.intersectObject(this.mapRoot, true);
      if (upHits.length > 0) continue;
      // Require ground near street level — deep underground also rejected.
      if (this.streetY != null && gy < this.streetY - 0.5) continue;
      p.y = gy; pos = p; break;
    }
    // Fallback: if we couldn't find ground, just use the player's current Y
    // (guaranteed to be standing on valid ground), so the enemy never fails to spawn.
    if (!pos) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 25 + Math.random() * 35;
      pos = new THREE.Vector3(
        this.player.position.x + Math.cos(angle) * dist,
        this.player.position.y - 1.7,
        this.player.position.z + Math.sin(angle) * dist,
      );
      if (this.mapBounds) {
        pos.x = THREE.MathUtils.clamp(pos.x, this.mapBounds.minX, this.mapBounds.maxX);
        pos.z = THREE.MathUtils.clamp(pos.z, this.mapBounds.minZ, this.mapBounds.maxZ);
      }
    }
    this._spawnBudget--;
    const tier = Math.min(3, Math.floor(Math.random() * (1 + this.round / 3)));
    const e = new Enemy({ scene: this.scene, template: this.enemyTemplate, position: pos, tier });
    e._game = this;
    this.enemies.push(e);
    if (Math.random() < 0.5) this.sfx.play('growl');
  }

  onHit(head) {
    this.ui.showHit(head);
  }

  enemyKilled(enemy) {
    this.score += 100 + enemy.tier * 50;
    this.killsThisRound++;
    this.sfx.play('kill');
  }

  offerUpgrades() {
    const pool = [
      { name: '+Damage', desc: '+25% weapon damage', apply: (p) => p.damage *= 1.25 },
      { name: '+Fire Rate', desc: '+20% fire rate', apply: (p) => p.fireRate *= 1.2 },
      { name: '+Reload', desc: '-25% reload time', apply: (p) => p.reloadTime *= 0.75 },
      { name: '+Mag Size', desc: '+10 magazine', apply: (p) => { p.magSize += 10; p.ammo += 10; } },
      { name: '+Max HP', desc: '+25 max HP (heal)', apply: (p) => { p.maxHp += 25; p.hp = p.maxHp; } },
      { name: '+Armor', desc: '+50 armor', apply: (p) => p.armor += 50 },
      { name: '+Speed', desc: '+15% movement', apply: (p) => p.moveSpeed *= 1.15 },
      { name: '+Reserve', desc: '+60 reserve ammo', apply: (p) => p.reserve += 60 },
    ];
    // pick 3 unique random
    const opts = [];
    while (opts.length < 3) {
      const o = pool[Math.floor(Math.random() * pool.length)];
      if (!opts.includes(o)) opts.push(o);
    }
    this.state = 'between';
    this.player.controls.unlock();
    this.ui.showUpgrades(opts, (choice) => {
      choice.apply(this.player);
      this.player.controls.lock();
      this.startNextRound();
    });
  }

  endGame(won) {
    this.state = 'over';
    if (!won) {
      // Death animation: sink camera to knee level + roll, fade red
      this.sfx.play('playerDead');
      const obj = this.player.controls.getObject();
      const startY = obj.position.y;
      const startTime = performance.now();
      const duration = 1200;
      const animate = () => {
        const t = Math.min(1, (performance.now() - startTime) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        obj.position.y = startY - eased * 1.2;
        this.camera.rotation.z = eased * 0.6;
        if (t < 1) requestAnimationFrame(animate);
        else {
          this.player.controls.unlock();
          this.ui.showEnd(false, { round: this.round, score: this.score, kills: (this.round - 1) * 4 });
        }
      };
      document.getElementById('dmgvignette').classList.add('hit');
      animate();
    } else {
      this.player.controls.unlock();
      this.ui.showEnd(true, { round: this.round, score: this.score, kills: (this.round - 1) * 4 });
    }
  }

  update(dt) {
    if (this.state === 'over') return;

    if (this.state === 'playing') {
      this.player.update(dt, this);

      // Spawn
      this._spawnTimer -= dt;
      if (this._spawnTimer <= 0 && this._spawnBudget > 0) {
        this.spawnEnemy();
        this._spawnTimer = this._spawnInterval * (0.7 + Math.random() * 0.6);
      }

      // Update enemies + cull dead
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        e.update(dt, this.player);
        if (e.hp <= 0 && e.state === 3 /*DEAD*/ && !e._scored) {
          e._scored = true;
          this.enemyKilled(e);
        }
        if (e._removed) this.enemies.splice(i, 1);
      }

      this.updatePickups();

      // Move player body mesh under camera (for shadow)
      this.playerBody.position.set(this.player.position.x, 0, this.player.position.z);

      // Check lose
      if (this.player.hp <= 0) return this.endGame(false);

      // Check round cleared
      if (this.killsThisRound >= this.roundKillQuota && this.enemies.every((e) => !e.alive)) {
        if (this.round >= MAX_ROUND) this.endGame(true);
        else this.offerUpgrades();
      }
    }

    this.ui.update({
      player: this.player,
      score: this.score,
      round: this.round,
      killsThisRound: this.killsThisRound,
      roundKillQuota: this.roundKillQuota,
    });
    this.ui.drawMinimap(this.player, this.enemies);
  }
}
