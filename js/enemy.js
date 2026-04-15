// Enemy: simple AI (patrol → chase → attack), health, hitbox, damage reaction.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const STATES = { PATROL: 0, CHASE: 1, ATTACK: 2, DEAD: 3 };

export class Enemy {
  constructor({ scene, template, position, tier = 0 }) {
    this.scene = scene;
    this.tier = tier;
    // Clone preserving skeleton so multiple instances animate independently.
    // Wrap the raw model in an outer Group so position = foot, not model origin.
    this.mesh = new THREE.Group();
    const inner = SkeletonUtils.clone(template.scene);
    inner.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        if (o.material && 'envMapIntensity' in o.material) o.material.envMapIntensity = 1.2;
      }
    });
    // Normalize scale so all enemies are roughly 1.8m tall
    const rawBox = new THREE.Box3().setFromObject(inner);
    const h = rawBox.getSize(new THREE.Vector3()).y || 1;
    const s = 1.8 / h;
    inner.scale.setScalar(s);
    // Shift inner model so its feet sit at outer-group origin y=0
    const scaledBox = new THREE.Box3().setFromObject(inner);
    inner.position.y -= scaledBox.min.y;
    this.mesh.add(inner);
    this.mesh.position.copy(position);
    scene.add(this.mesh);
    this._inner = inner;

    // High-contrast look: strong color tint + glowing emissive so enemies
    // read clearly against the city. Color varies by tier.
    const tints = [0xff4433, 0xff8800, 0xff00aa, 0x00e0ff];
    const col = tints[Math.min(tier, tints.length - 1)];
    this.mesh.traverse((o) => {
      if (o.isMesh && o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          m.color?.setHex?.(col);
          if (m.emissive) {
            m.emissive.setHex(col);
            if ('emissiveIntensity' in m) m.emissiveIntensity = 0.6;
          }
          if ('roughness' in m) m.roughness = 0.5;
          if ('metalness' in m) m.metalness = 0;
        });
      }
    });
    // Rim shell: slightly larger back-faced copy to produce an outline glow
    const rimMesh = SkeletonUtils.clone(template.scene);
    rimMesh.scale.setScalar(s * 1.05);
    rimMesh.position.y -= scaledBox.min.y;
    rimMesh.traverse((o) => {
      if (o.isMesh) {
        o.material = new THREE.MeshBasicMaterial({ color: col, side: THREE.BackSide });
        o.castShadow = false;
        o.receiveShadow = false;
      }
    });
    this.mesh.add(rimMesh);

    // Invisible capsule hitbox for raycasts (easier + consistent)
    const hb = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.45, 1.8, 8),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hb.position.copy(position); hb.position.y += 0.9;
    hb.userData.enemy = this;
    scene.add(hb);
    this.hitbox = hb;

    // Animations (if any)
    this.mixer = null;
    if (template.animations && template.animations.length) {
      this.mixer = new THREE.AnimationMixer(this.mesh);
      const clip = template.animations[0];
      this.action = this.mixer.clipAction(clip);
      this.action.play();
    }

    // Stats scale with tier
    this.maxHp = 60 + tier * 40;
    this.hp = this.maxHp;
    this.speed = 2.4 + tier * 0.6;
    this.damage = 8 + tier * 4;
    this.shootRange = 18;   // can shoot from here
    this.meleeRange = 2.0;  // extra damage at melee
    this.sightRange = 80;
    this.attackCd = 0;

    this.state = STATES.PATROL;
    this._patrolTarget = position.clone();
    this._patrolTimer = 0;
  }

  takeDamage(dmg, head) {
    if (this.state === STATES.DEAD) return;
    this.hp -= dmg;
    // Flash red
    this.mesh.traverse((o) => {
      if (o.isMesh && o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => { if (m.emissive) m.emissive.setHex(head ? 0xff2200 : 0xaa0000); });
      }
    });
    setTimeout(() => {
      this.mesh.traverse((o) => {
        if (o.isMesh && o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => { if (m.emissive) m.emissive.setHex(0x000000); });
        }
      });
    }, 90);
    if (this.hp <= 0) this.die();
  }

  die() {
    this.state = STATES.DEAD;
    this._dieT = 0;
    this._game?.sfx?.play('enemyDie');
  }

  get alive() { return this.state !== STATES.DEAD; }

  update(dt, player) {
    if (this.mixer) this.mixer.update(dt);
    if (this.state === STATES.DEAD) {
      this._dieT += dt;
      this.mesh.rotation.z += dt * 3;
      this.mesh.position.y -= dt * 0.8;
      if (this._dieT > 2) {
        this.scene.remove(this.mesh);
        this.scene.remove(this.hitbox);
        this._removed = true;
      }
      return;
    }

    const toPlayer = new THREE.Vector3().subVectors(player.position, this.mesh.position);
    toPlayer.y = 0;
    const dist = toPlayer.length();

    if (dist < this.sightRange) this.state = dist < this.meleeRange ? STATES.ATTACK : STATES.CHASE;
    else this.state = STATES.PATROL;

    let move = new THREE.Vector3();
    if (this.state === STATES.CHASE) {
      // Slow down within shoot range so they pepper you from distance
      const s = dist < this.shootRange ? this.speed * 0.4 : this.speed;
      move.copy(toPlayer).normalize().multiplyScalar(s);
    } else if (this.state === STATES.PATROL) {
      this._patrolTimer -= dt;
      if (this._patrolTimer <= 0 || this.mesh.position.distanceTo(this._patrolTarget) < 1) {
        this._patrolTarget = this.mesh.position.clone().add(
          new THREE.Vector3((Math.random() - 0.5) * 30, 0, (Math.random() - 0.5) * 30)
        );
        this._patrolTimer = 4 + Math.random() * 3;
      }
      const d = new THREE.Vector3().subVectors(this._patrolTarget, this.mesh.position);
      d.y = 0;
      if (d.lengthSq() > 0.01) move.copy(d.normalize()).multiplyScalar(this.speed * 0.4);
    }

    this.mesh.position.addScaledVector(move, dt);
    // Wall collision — same raycast push-out the player uses
    if (this._game?.resolveCollision) this._game.resolveCollision(this.mesh.position, 0.5);
    // Keep enemy feet at the player's last known ground level
    const playerFootY = (player._lastGroundY != null) ? player._lastGroundY : (player.position.y - 1.7);
    this.mesh.position.y = playerFootY;
    this.hitbox.position.set(this.mesh.position.x, this.mesh.position.y + 0.9, this.mesh.position.z);

    // Face player/target
    const faceTo = this.state === STATES.PATROL ? this._patrolTarget : player.position;
    const look = new THREE.Vector3(faceTo.x, this.mesh.position.y, faceTo.z);
    this.mesh.lookAt(look);

    // Attack — melee close, ranged at any distance within shootRange (LOS required)
    this.attackCd -= dt;
    if (this.attackCd <= 0 && dist < this.sightRange) {
      if (dist < this.meleeRange) {
        player.takeDamage(this.damage * 1.5);
        this.attackCd = 1.0;
      } else if (dist < this.shootRange && this._inPlayerView(player) && this._hasLineOfSight(player)) {
        player.takeDamage(this.damage * 0.6);
        this.attackCd = 1.3;
      }
    }
  }

  // True if this enemy is inside the player's forward view cone (~70°).
  _inPlayerView(player) {
    const cam = player.camera;
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    const toMe = new THREE.Vector3().subVectors(this.mesh.position, player.position).normalize();
    return fwd.dot(toMe) > 0.35;
  }

  _hasLineOfSight(player) {
    if (!this._game?.mapRoot) return true;
    this._losRay = this._losRay || new THREE.Raycaster();
    // Cast from three heights (chest, head, hip) on the enemy → camera.
    // ALL must be clear — any wall hit blocks the shot.
    const offsets = [1.6, 1.2, 0.6];
    const to = player.position;
    for (const oy of offsets) {
      const from = new THREE.Vector3(
        this.mesh.position.x,
        this.mesh.position.y + oy,
        this.mesh.position.z,
      );
      const dir = new THREE.Vector3().subVectors(to, from);
      const dist = dir.length();
      if (dist < 0.5) return true;
      dir.normalize();
      this._losRay.set(from, dir);
      this._losRay.far = dist - 0.3;
      const hits = this._losRay.intersectObject(this._game.mapRoot, true);
      if (hits.length > 0) return false;
    }
    return true;
  }
}
