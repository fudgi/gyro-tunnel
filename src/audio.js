const MUTE_KEY = "gyro-tunnel-muted";

const SFX_FILES = {
  engine: "engine",
  closeCall: "close-call",
  pickupShield: "pickup-shield",
  pickupSlow: "pickup-slow",
  pickupX2: "pickup-x2",
  shieldAbsorb: "shield-absorb",
  powerEndSlow: "power-end-slow",
  powerEndX2: "power-end-x2",
  crash: "crash",
  milestone: "milestone",
};

export const MUSIC_TRACKS = [
  { id: "neon-sign-circuit", title: "Neon Sign Circuit", artist: "MintoDog", bpm: 144, license: "CC0 1.0" },
];

const MUSIC_LEVEL = 0.22;
const ENGINE_LEVEL = 0.11;
// Lowpass opens at each 1000 m palette milestone. Values are Hz.
export const MUSIC_CUTOFFS = [500, 1000, 2000, 4500, 9000, 20000];
const MUSIC_FILTER_Q = 1;
const MUSIC_FILTER_RAMP = 1.75;

export function musicCutoffForDistance(distance) {
  const step = Math.min(MUSIC_CUTOFFS.length - 1, Math.max(0, Math.floor((distance || 0) / 1000)));
  return MUSIC_CUTOFFS[step];
}

function loadMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

function saveMuted(on) {
  try {
    localStorage.setItem(MUTE_KEY, on ? "1" : "0");
  } catch {
    // private mode
  }
}

function preferSafari() {
  const ua = navigator.userAgent || "";
  return /iP(hone|od|ad)/.test(ua) || (/Safari/.test(ua) && !/Chrome|Chromium|Android/.test(ua));
}

function sfxExt() {
  const probe = document.createElement("audio");
  if (!preferSafari() && probe.canPlayType('audio/ogg; codecs="opus"')) return "ogg";
  return "m4a";
}

export function createAudio() {
  let ctx = null;
  let master = null;
  let sfxBus = null;
  let engineGain = null;
  let engineFilter = null;
  let musicGain = null;
  let musicFilter = null;
  let musicCutoffTarget = MUSIC_CUTOFFS[0];
  let muted = loadMuted();
  let engineOn = false;
  let fadingOut = false;
  let engineSrc = null;
  let buffers = {};
  let sfxLoading = null;
  let musicEl = null;
  let musicNode = null;
  let currentTrack = null;
  let musicPlaying = false;
  let duckTimer = 0;

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 8;
    compressor.ratio.value = 3.5;
    compressor.attack.value = 0.008;
    compressor.release.value = 0.18;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3.5;
    limiter.knee.value = 0.4;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;

    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;

    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.8;

    engineFilter = ctx.createBiquadFilter();
    engineFilter.type = "lowpass";
    engineFilter.frequency.value = 520;
    engineFilter.Q.value = 0.65;

    engineGain = ctx.createGain();
    engineGain.gain.value = 0;

    musicGain = ctx.createGain();
    musicGain.gain.value = 0;

    musicFilter = ctx.createBiquadFilter();
    musicFilter.type = "lowpass";
    musicFilter.frequency.value = MUSIC_CUTOFFS[0];
    musicFilter.Q.value = MUSIC_FILTER_Q;
    musicCutoffTarget = MUSIC_CUTOFFS[0];

    engineFilter.connect(engineGain);
    engineGain.connect(compressor);
    sfxBus.connect(compressor);
    musicFilter.connect(musicGain);
    musicGain.connect(compressor);
    compressor.connect(limiter);
    limiter.connect(master);
    master.connect(ctx.destination);
    return ctx;
  }

  async function unlock() {
    const audio = ensure();
    if (!audio) return false;
    if (audio.state === "suspended") {
      try {
        await audio.resume();
      } catch {
        // iOS may reject outside a gesture
      }
    }
    try {
      const buffer = audio.createBuffer(1, 1, audio.sampleRate);
      const src = audio.createBufferSource();
      src.buffer = buffer;
      src.connect(audio.destination);
      src.start(0);
    } catch {
      // ignore
    }
    void loadSfx();
    return audio.state === "running" || audio.state === "suspended";
  }

  async function loadSfx() {
    if (!ensure()) return;
    if (sfxLoading) return sfxLoading;
    sfxLoading = (async () => {
      const primary = sfxExt();
      const fallback = primary === "ogg" ? "m4a" : "ogg";
      await Promise.all(
        Object.values(SFX_FILES).map(async (name) => {
          if (buffers[name]) return;
          for (const ext of [primary, fallback]) {
            try {
              const res = await fetch(`/audio/sfx/${name}.${ext}`);
              if (!res.ok) continue;
              const raw = await res.arrayBuffer();
              buffers[name] = await ctx.decodeAudioData(raw.slice(0));
              return;
            } catch {
              // try the other container
            }
          }
        })
      );
    })();
    return sfxLoading;
  }

  function setMaster(value, tau = 0.05) {
    if (!master || !ctx) return;
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setTargetAtTime(value, now, tau);
  }

  function isMuted() {
    return muted;
  }

  function setMuted(on) {
    muted = !!on;
    saveMuted(muted);
    setMaster(muted ? 0 : 1, 0.04);
    if (musicEl) musicEl.muted = muted;
  }

  function toggleMuted() {
    setMuted(!muted);
    return muted;
  }

  function playSfx(name, { gain = 0.45, rate = 1, when = 0 } = {}) {
    if (!ctx || muted) return;
    const buffer = buffers[name];
    if (!buffer) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = Math.max(0.5, rate);
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(sfxBus);
    const start = ctx.currentTime + when;
    src.start(start);
    return src;
  }

  function stopEngineSource() {
    if (!engineSrc) return;
    try {
      engineSrc.stop();
    } catch {
      // already stopped
    }
    engineSrc = null;
  }

  function startEngineLoop() {
    if (!ctx || !buffers.engine || !engineOn) return;
    stopEngineSource();
    const src = ctx.createBufferSource();
    src.buffer = buffers.engine;
    src.loop = true;
    src.playbackRate.value = 0.96;
    src.connect(engineFilter);
    src.start();
    engineSrc = src;
  }

  function startMusic() {
    const audio = ensure();
    if (!audio || !musicGain) return;
    const track = MUSIC_TRACKS[0];
    currentTrack = track;
    if (!musicEl) {
      musicEl = new Audio();
      musicEl.preload = "auto";
      musicEl.loop = true;
      musicEl.crossOrigin = "anonymous";
      musicEl.playsInline = true;
      try {
        musicNode = audio.createMediaElementSource(musicEl);
        musicNode.connect(musicFilter);
      } catch {
        // already connected
      }
    }
    musicEl.pause();
    const src = `/audio/music/${track.id}.m4a`;
    if (!musicEl.src || !musicEl.src.endsWith(src)) musicEl.src = src;
    try {
      musicEl.currentTime = 0;
    } catch {
      // some browsers throw if the element is not ready
    }
    musicEl.muted = muted;
    snapMusicCutoff(MUSIC_CUTOFFS[0]);
    const now = audio.currentTime;
    musicGain.gain.cancelScheduledValues(now);
    musicGain.gain.setValueAtTime(0.0001, now);
    musicGain.gain.exponentialRampToValueAtTime(Math.max(0.0002, MUSIC_LEVEL), now + 1.15);
    musicPlaying = true;
    const playPromise = musicEl.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {
        musicPlaying = false;
      });
    }
  }

  function snapMusicCutoff(hz) {
    if (!ctx || !musicFilter) return;
    const value = Math.max(20, hz);
    musicCutoffTarget = value;
    const now = ctx.currentTime;
    musicFilter.frequency.cancelScheduledValues(now);
    musicFilter.frequency.value = value;
    musicFilter.frequency.setValueAtTime(value, now);
  }

  function setMusicDistance(distance, { snap = false, ramp = MUSIC_FILTER_RAMP } = {}) {
    const audio = ensure();
    if (!audio || !musicFilter) return musicCutoffForDistance(distance);
    const target = musicCutoffForDistance(distance);
    if (snap) {
      snapMusicCutoff(target);
      return target;
    }
    if (Math.abs(target - musicCutoffTarget) < 0.5) return musicCutoffTarget;
    const now = audio.currentTime;
    const current = Math.max(20, musicFilter.frequency.value);
    musicFilter.frequency.cancelScheduledValues(now);
    musicFilter.frequency.setValueAtTime(current, now);
    const seconds = Math.max(0.2, ramp);
    musicFilter.frequency.exponentialRampToValueAtTime(Math.max(20, target), now + seconds);
    musicCutoffTarget = target;
    return target;
  }

  function fadeMusicOut(seconds = 1.05) {
    if (!ctx || !musicGain) return;
    const now = ctx.currentTime;
    const current = Math.max(0.0001, musicGain.gain.value);
    musicGain.gain.cancelScheduledValues(now);
    musicGain.gain.setValueAtTime(current, now);
    musicGain.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.12, seconds));
    window.clearTimeout(duckTimer);
    duckTimer = window.setTimeout(() => {
      if (musicEl) {
        try {
          musicEl.pause();
        } catch {
          // ignore
        }
      }
      musicPlaying = false;
    }, Math.ceil(seconds * 1000) + 40);
  }

  function startEngine() {
    const audio = ensure();
    if (!audio) return;
    fadingOut = false;
    engineOn = true;
    const now = audio.currentTime;
    engineGain.gain.cancelScheduledValues(now);
    engineGain.gain.setTargetAtTime(ENGINE_LEVEL, now, 0.2);
    void loadSfx().then(() => {
      if (engineOn && !engineSrc) startEngineLoop();
    });
    startMusic();
  }

  function stopEngine(fade = 0.9) {
    if (!ctx || !engineGain) return;
    fadingOut = true;
    engineOn = false;
    const now = ctx.currentTime;
    engineGain.gain.cancelScheduledValues(now);
    engineGain.gain.setTargetAtTime(0.0001, now, Math.max(0.08, fade / 4));
    window.setTimeout(stopEngineSource, Math.ceil(fade * 1000) + 80);
  }

  function updateEngine({ speedFactor = 1, boosting = false, timeScale = 1, active = false } = {}) {
    if (!ctx || !engineGain || fadingOut) return;
    if (!active) {
      if (engineOn) stopEngine(0.35);
      return;
    }
    if (!engineOn) startEngine();
    const now = ctx.currentTime;
    const k = Math.max(0, Math.min(1, (speedFactor - 1) / 7));
    const boost = boosting ? 1 : 0;
    if (engineSrc) {
      engineSrc.playbackRate.setTargetAtTime(0.92 + k * 0.28 + boost * 0.14, now, 0.12);
    }
    engineFilter.frequency.setTargetAtTime(380 + k * 520 + boost * 360, now, 0.12);
    const volScale = 0.78 + 0.22 * Math.max(0.45, timeScale);
    engineGain.gain.setTargetAtTime((ENGINE_LEVEL + k * 0.05 + boost * 0.045) * volScale, now, 0.14);
  }

  function closeCall(combo = 1) {
    if (!ensure() || muted) return;
    const step = Math.max(1, Math.min(5, combo));
    const rate = 0.96 + (step - 1) * 0.1;
    void loadSfx().then(() => playSfx("closeCall", { gain: 0.42, rate }));
  }

  function pickup(kind) {
    if (!ensure() || muted) return;
    const name = kind === "shield" ? "pickupShield" : kind === "slow" ? "pickupSlow" : "pickupX2";
    const rate = kind === "slow" ? 0.88 : kind === "x2" ? 1.06 : 1;
    void loadSfx().then(() => playSfx(name, { gain: 0.48, rate }));
  }

  function shieldAbsorb() {
    if (!ensure() || muted) return;
    void loadSfx().then(() => playSfx("shieldAbsorb", { gain: 0.4, rate: 0.95 }));
  }

  function powerEnd(kind) {
    if (!ensure() || muted) return;
    const name = kind === "x2" ? "powerEndX2" : "powerEndSlow";
    void loadSfx().then(() => playSfx(name, { gain: 0.32, rate: 0.92 }));
  }

  function crash() {
    const audio = ensure();
    if (!audio) return;
    stopEngine(1.05);
    if (musicGain) {
      const now = audio.currentTime;
      const current = Math.max(0.0001, musicGain.gain.value);
      musicGain.gain.cancelScheduledValues(now);
      musicGain.gain.setValueAtTime(current, now);
      musicGain.gain.exponentialRampToValueAtTime(Math.max(0.0002, MUSIC_LEVEL * 0.28), now + 0.08);
    }
    fadeMusicOut(1.15);
    if (muted) return;
    void loadSfx().then(() => playSfx("crash", { gain: 0.52, rate: 0.92 }));
  }

  function milestone() {
    if (!ensure() || muted) return;
    void loadSfx().then(() => playSfx("milestone", { gain: 0.34, rate: 1 }));
  }

  function getMusicState() {
    return {
      trackId: currentTrack?.id || null,
      title: currentTrack?.title || null,
      artist: currentTrack?.artist || null,
      playing: musicPlaying && !muted,
      src: musicEl?.src || null,
      count: MUSIC_TRACKS.length,
      cutoffHz: musicFilter ? musicFilter.frequency.value : null,
      targetCutoffHz: musicCutoffTarget,
      cutoffs: MUSIC_CUTOFFS.slice(),
    };
  }

  return {
    unlock,
    isMuted,
    setMuted,
    toggleMuted,
    startEngine,
    stopEngine,
    updateEngine,
    closeCall,
    pickup,
    shieldAbsorb,
    powerEnd,
    crash,
    milestone,
    getMusicState,
    setMusicDistance,
    musicCutoffForDistance,
    tracks: MUSIC_TRACKS,
  };
}
