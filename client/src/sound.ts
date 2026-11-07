/* Fight sounds made on the fly with Web Audio, so there are no sound files to license or load. */

let audio: AudioContext | undefined;
let noise: AudioBuffer | undefined;

/** Browsers only allow sound after a click or a key, so this runs on the first one. */
export function unlockSound() {
  if (!audio) {
    audio = new AudioContext();
    noise = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
    const data = noise.getChannelData(0);

    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (audio.state === "suspended") void audio.resume();
}

function output(volume: number) {
  const gain = audio!.createGain();

  gain.gain.value = volume;
  gain.connect(audio!.destination);
  return gain;
}

/** Filtered noise whose pitch sweeps from one frequency to another: the air a blade or stick moves. */
function whoosh(from: number, to: number, seconds: number, volume: number, delay = 0) {
  if (!audio || !noise) return;
  const start = audio.currentTime + delay;
  const source = audio.createBufferSource();
  const filter = audio.createBiquadFilter();
  const envelope = audio.createGain();

  source.buffer = noise;
  filter.type = "bandpass";
  filter.Q.value = 1.4;
  filter.frequency.setValueAtTime(from, start);
  filter.frequency.exponentialRampToValueAtTime(to, start + seconds);
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(1, start + seconds * 0.35);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + seconds);
  source.connect(filter).connect(envelope).connect(output(volume));
  source.start(start, Math.random() * 0.5, seconds + 0.05);
}

/** A falling tone with a quick decay: the body of a punch, a thud or a boom. */
function thump(from: number, to: number, seconds: number, volume: number, type: OscillatorType = "sine", delay = 0) {
  if (!audio) return;
  const start = audio.currentTime + delay;
  const oscillator = audio.createOscillator();
  const envelope = audio.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(from, start);
  oscillator.frequency.exponentialRampToValueAtTime(to, start + seconds);
  envelope.gain.setValueAtTime(1, start);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + seconds);
  oscillator.connect(envelope).connect(output(volume));
  oscillator.start(start);
  oscillator.stop(start + seconds + 0.02);
}

/** A short burst of bright noise: the slap on top of an impact. */
function crack(seconds: number, volume: number, frequency = 2500, delay = 0) {
  if (!audio || !noise) return;
  const start = audio.currentTime + delay;
  const source = audio.createBufferSource();
  const filter = audio.createBiquadFilter();
  const envelope = audio.createGain();

  source.buffer = noise;
  filter.type = "highpass";
  filter.frequency.value = frequency;
  envelope.gain.setValueAtTime(1, start);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + seconds);
  source.connect(filter).connect(envelope).connect(output(volume));
  source.start(start, Math.random() * 0.5, seconds + 0.02);
}

export const sounds = {
  knife: () => whoosh(5200, 1400, 0.16, 0.5),
  axe: () => whoosh(1600, 380, 0.3, 0.75),
  /** Virgiliu's blade landing on the policeman. */
  strike: () => {
    crack(0.07, 0.5, 1800);
    thump(190, 60, 0.16, 0.8);
  },
  /** The baton going up and swinging down. */
  baton: (delayMs: number) => whoosh(900, 260, 0.24, 0.6, Math.max(0, delayMs - 180) / 1000),
  /** The baton landing on Virgiliu. */
  hurt: () => {
    crack(0.05, 0.55, 1200);
    thump(140, 45, 0.24, 1, "triangle");
  },
  fireball: () => {
    whoosh(300, 1500, 0.45, 0.55);
    crack(0.3, 0.12, 4000);
  },
  explode: () => {
    thump(110, 30, 0.6, 0.9);
    whoosh(1200, 200, 0.5, 0.5);
  },
  bolt: () => {
    thump(1800, 90, 0.25, 0.25, "sawtooth");
    crack(0.35, 0.4, 3000);
  },
  /** The policeman and his donkey going down. */
  knockout: () => {
    thump(120, 35, 0.7, 1);
    whoosh(700, 120, 0.6, 0.45, 0.05);
  },
};
