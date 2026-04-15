// HUD + overlays (start, upgrade, end).
import * as THREE from 'three';

export class UI {
  constructor() {
    this.hp = document.getElementById('hp');
    this.hpfill = document.getElementById('hpfill');
    this.ammo = document.getElementById('ammo');
    this.score = document.getElementById('score');
    this.round = document.getElementById('round');
    this.kills = document.getElementById('kills');
    this.hitmark = document.getElementById('hitmark');
    this.overlay = document.getElementById('overlay');
    this.upgradeEl = document.getElementById('upgrade');
    this.upgradeList = document.getElementById('upgradeList');
    this.endscreen = document.getElementById('endscreen');
    this.minimap = document.getElementById('minimap');
    this.mmctx = this.minimap.getContext('2d');
  }
  showStart() { this.overlay.classList.remove('hidden'); }
  hideStart() { this.overlay.classList.add('hidden'); }
  showHit(head) {
    this.hitmark.classList.remove('show');
    void this.hitmark.offsetWidth;
    this.hitmark.style.background = head
      ? 'linear-gradient(45deg,transparent 45%,#f33 45% 55%,transparent 55%),linear-gradient(-45deg,transparent 45%,#f33 45% 55%,transparent 55%)'
      : 'linear-gradient(45deg,transparent 45%,#ff3 45% 55%,transparent 55%),linear-gradient(-45deg,transparent 45%,#ff3 45% 55%,transparent 55%)';
    this.hitmark.classList.add('show');
  }
  update(state) {
    const { player, score, round, killsThisRound, roundKillQuota } = state;
    this.hp.textContent = Math.max(0, Math.round(player.hp));
    this.hpfill.style.width = `${Math.max(0, player.hp / player.maxHp) * 100}%`;
    this.ammo.textContent = `${player.ammo} / ${player.reserve}`;
    this.score.textContent = score;
    this.round.textContent = round;
    this.kills.textContent = `${killsThisRound}/${roundKillQuota}`;
  }
  showUpgrades(options, onPick) {
    this.upgradeList.innerHTML = '';
    options.forEach((opt) => {
      const d = document.createElement('div');
      d.className = 'upcard';
      d.innerHTML = `<h3>${opt.name}</h3><p>${opt.desc}</p>`;
      d.onclick = () => { this.upgradeEl.classList.add('hidden'); onPick(opt); };
      this.upgradeList.appendChild(d);
    });
    this.upgradeEl.classList.remove('hidden');
  }
  showEnd(won, stats) {
    document.getElementById('endTitle').textContent = won ? 'VICTORY' : 'YOU DIED';
    document.getElementById('endStats').textContent =
      `Round ${stats.round} • Score ${stats.score} • Kills ${stats.kills}`;
    this.endscreen.classList.remove('hidden');
  }
  drawMinimap(player, enemies) {
    const ctx = this.mmctx;
    const W = this.minimap.width, H = this.minimap.height;
    const cx = W / 2, cy = H / 2;
    const R = Math.min(cx, cy) - 6;
    const scale = 0.18; // world units → px
    ctx.clearRect(0, 0, W, H);

    // Circular dark background clip
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R + 4, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = 'rgba(15,18,24,0.88)';
    ctx.fillRect(0, 0, W, H);

    // Rotate canvas so the player always faces "up"
    // Camera forward in world space — we want its yaw.
    const fwd = new THREE.Vector3();
    player.camera.getWorldDirection(fwd);
    const yaw = Math.atan2(fwd.x, fwd.z); // + rotates clockwise for north=up
    ctx.translate(cx, cy);
    ctx.rotate(yaw);

    // Range rings
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath(); ctx.arc(0, 0, (R * i) / 3, 0, Math.PI * 2); ctx.stroke();
    }
    // Cardinal lines
    ctx.beginPath();
    ctx.moveTo(-R, 0); ctx.lineTo(R, 0);
    ctx.moveTo(0, -R); ctx.lineTo(0, R);
    ctx.stroke();

    // Enemies (positions relative to player, in map-space)
    let alive = 0;
    enemies.forEach((e) => {
      if (!e.alive) return;
      alive++;
      const ex = (e.mesh.position.x - player.position.x) * scale;
      const ez = (e.mesh.position.z - player.position.z) * scale;
      if (!Number.isFinite(ex) || !Number.isFinite(ez)) return;
      const d = Math.hypot(ex, ez);
      const onEdge = d > R;
      const ux = onEdge && d > 0 ? (ex / d) * R : ex;
      const uz = onEdge && d > 0 ? (ez / d) * R : ez;
      if (onEdge) {
        // Direction arrow on the rim
        const ang = Math.atan2(uz, ux);
        ctx.save();
        ctx.rotate(ang);
        ctx.fillStyle = '#ffcc00';
        ctx.beginPath();
        ctx.moveTo(R - 2, 0);
        ctx.lineTo(R - 10, -5);
        ctx.lineTo(R - 10, 5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = '#ff3838';
        ctx.beginPath();
        ctx.arc(ux, uz, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // Player in center (triangle pointing up = camera forward)
    ctx.fillStyle = '#4dffb5';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 5);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();

    // Rim
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, R + 4, 0, Math.PI * 2);
    ctx.stroke();

    // Alive count badge
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(W - 38, 6, 32, 18);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(alive, W - 22, 15);
  }
}
