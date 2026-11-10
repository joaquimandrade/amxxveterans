/** Every sound is synthesised on the spot: filtered noise bursts and a few tones. */
let context: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
export let muted = false;

export function unlockAudio() {
  if (context) { void context.resume(); return; }
  try {
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = 0.5;
    master.connect(context.destination);
    noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  } catch { context = null; }
}

export function setMuted(value: boolean) {
  muted = value;
  if (master) master.gain.value = value ? 0 : 0.5;
}

function burst(type: BiquadFilterType, from: number, to: number, length: number, volume: number, delay = 0) {
  if (!context || !master || !noise) return;
  const start = context.currentTime + delay;
  const source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain();

  source.buffer = noise;
  source.playbackRate.value = 0.8 + Math.random() * 0.4;
  filter.type = type;
  filter.frequency.setValueAtTime(from, start);
  filter.frequency.exponentialRampToValueAtTime(to, start + length);
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + length);
  source.connect(filter).connect(gain).connect(master);
  source.start(start, Math.random() * 0.5, length + 0.05);
}

function tone(wave: OscillatorType, from: number, to: number, length: number, volume: number, delay = 0) {
  if (!context || !master) return;
  const start = context.currentTime + delay;
  const oscillator = context.createOscillator(), gain = context.createGain();

  oscillator.type = wave;
  oscillator.frequency.setValueAtTime(from, start);
  oscillator.frequency.exponentialRampToValueAtTime(to, start + length);
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + length);
  oscillator.connect(gain).connect(master);
  oscillator.start(start);
  oscillator.stop(start + length + 0.02);
}

const SOUNDS: Record<string, () => void> = {
  swing: () => burst("bandpass", 500, 1800, 0.16, 0.35),
  thud: () => { tone("sine", 150, 60, 0.14, 0.7); burst("lowpass", 900, 200, 0.1, 0.4); },
  clang: () => { tone("square", 880, 620, 0.12, 0.12); tone("sine", 1320, 1180, 0.22, 0.14); burst("highpass", 3000, 2000, 0.06, 0.25); },
  glass: () => { burst("highpass", 5200, 2600, 0.24, 0.45); tone("triangle", 2400, 1500, 0.1, 0.1); burst("highpass", 6500, 4000, 0.18, 0.2, 0.07); },
  shot: () => { burst("lowpass", 3200, 240, 0.3, 1); tone("sine", 130, 40, 0.22, 0.9); },
  throw: () => burst("bandpass", 900, 300, 0.25, 0.25),
  whoosh: () => { burst("lowpass", 300, 1500, 0.5, 0.6); burst("highpass", 4000, 2500, 0.12, 0.3); },
  crash: () => { burst("lowpass", 2000, 120, 0.55, 0.9); tone("sine", 90, 35, 0.4, 0.8); burst("highpass", 3500, 1500, 0.3, 0.3, 0.05); },
  pick: () => tone("triangle", 520, 780, 0.08, 0.25),
  end: () => { [392, 494, 587, 784].forEach((f, i) => tone("triangle", f, f, 0.3, 0.3, i * 0.14)); },
};

const last: Record<string, number> = {};

export function play(name: string) {
  const now = performance.now();

  // The same sound a few milliseconds apart only adds mud.
  if (!context || muted || now - (last[name] ?? 0) < 45) return;
  last[name] = now;
  SOUNDS[name]?.();
}
