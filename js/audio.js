// Tiny procedural SFX — no asset downloads needed.
// Uses WebAudio to synthesize gunshot, reload click, hit, empty, enemy growl.
export class SFX {
  constructor() {
    this.ctx = null;
  }
  _ensure() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    return this.ctx;
  }
  play(name) {
    const ctx = this._ensure();
    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = 0.3;
    master.connect(ctx.destination);

    switch (name) {
      case 'shoot': {
        // sharp noise burst + low thump
        const buf = ctx.createBuffer(1, ctx.sampleRate * 0.15, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
        const src = ctx.createBufferSource(); src.buffer = buf;
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 400;
        src.connect(hp).connect(master);
        const osc = ctx.createOscillator(); osc.frequency.value = 80;
        const og = ctx.createGain(); og.gain.setValueAtTime(0.8, now); og.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
        osc.connect(og).connect(master);
        src.start(now); osc.start(now); osc.stop(now + 0.12);
        break;
      }
      case 'empty': {
        const osc = ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = 220;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.15, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        osc.connect(g).connect(master);
        osc.start(now); osc.stop(now + 0.1);
        break;
      }
      case 'reload': {
        const osc = ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = 480;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.2, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.connect(g).connect(master);
        osc.start(now); osc.stop(now + 0.08);
        break;
      }
      case 'hurt': {
        const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 140;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.25, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.frequency.exponentialRampToValueAtTime(60, now + 0.2);
        osc.connect(g).connect(master);
        osc.start(now); osc.stop(now + 0.2);
        break;
      }
      case 'kill': {
        const osc = ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = 660;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.2, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.frequency.exponentialRampToValueAtTime(990, now + 0.18);
        osc.connect(g).connect(master);
        osc.start(now); osc.stop(now + 0.18);
        break;
      }
      case 'playerDead': {
        // dramatic drop + noise
        const buf = ctx.createBuffer(1, ctx.sampleRate * 1.2, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2) * 0.6;
        const src = ctx.createBufferSource(); src.buffer = buf;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
        src.connect(lp).connect(master);
        const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 220;
        const og = ctx.createGain(); og.gain.setValueAtTime(0.4, now); og.gain.exponentialRampToValueAtTime(0.001, now + 1.1);
        osc.frequency.exponentialRampToValueAtTime(40, now + 1.1);
        osc.connect(og).connect(master);
        src.start(now); osc.start(now); osc.stop(now + 1.1);
        break;
      }
      case 'enemyDie': {
        const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 300;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.35, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
        osc.frequency.exponentialRampToValueAtTime(60, now + 0.45);
        const noise = ctx.createBufferSource();
        const nb = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
        const nd = nb.getChannelData(0);
        for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / nd.length, 2) * 0.4;
        noise.buffer = nb;
        osc.connect(g).connect(master);
        noise.connect(master);
        osc.start(now); noise.start(now); osc.stop(now + 0.45);
        break;
      }
      case 'growl': {
        const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 90;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.15, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
        osc.connect(g).connect(master);
        osc.start(now); osc.stop(now + 0.4);
        break;
      }
    }
  }
}
