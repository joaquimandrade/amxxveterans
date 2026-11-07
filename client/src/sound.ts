/* Swing sounds made on the fly with Web Audio, so there are no sound files to license or load.
   Only the blades and the baton make a sound: the impacts sounded wrong and were taken out. */

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

export const sounds = {
  knife: () => whoosh(2400, 500, 0.26, 0.7),
  axe: () => whoosh(1600, 380, 0.3, 0.75),
  /** The baton going up and swinging down. */
  baton: (delayMs: number) => whoosh(900, 260, 0.24, 0.6, Math.max(0, delayMs - 180) / 1000),
};

/** The shared audio context, once a click or key has unlocked it. */
export const audioContext = () => audio;
