/* Three short looping tunes in an arcade style, played by a small Web Audio sequencer.
   They are original, in a Portuguese folk spirit: a vira in 6/8 on an accordion-like lead with
   bombo and ferrinhos, and a fado-style descending cadence for the face-off.
   Every step is an eighth note; the 6/8 tunes loop over bars of six steps. */

import { audioContext } from "./sound.ts";

type Note = number | null;
type Track = {
  bpm: number;
  /** One entry per step; every channel loops over its own length. */
  lead?: Note[];
  bass?: Note[];
  pad?: Note[];
  kick?: string;
  snare?: string;
  hat?: string;
  leadWave?: OscillatorType;
};

const _ = null;
// MIDI numbers: A2 = 45, A3 = 57, A4 = 69.
const E1 = 28, F1 = 29, G1 = 31, A1 = 33;
const G2 = 43, A2 = 45, C3 = 48, D3 = 50, E3 = 52, F3 = 53;
const Gs3 = 56, G3 = 55, A3 = 57, B3 = 59, C4 = 60, D4 = 62, E4 = 64, F4 = 65, Fs4 = 66, G4 = 67;
const A4 = 69, B4 = 71, C5 = 72, D5 = 74, E5 = 76;

export const TRACKS: Record<string, Track> = {
  /* The opening shot: a gentle vira in G. */
  intro: {
    bpm: 90,
    leadWave: "sawtooth",
    lead: [
      G4, _, B4, D5, _, B4, C5, _, A4, Fs4, _, A4,
      G4, _, B4, D5, _, E5, D5, _, C5, B4, _, A4,
      B4, _, G4, A4, _, Fs4, G4, _, _, G4, _, _,
    ],
    bass: [G2, _, _, D3, _, _, D3, _, _, A2, _, _, G2, _, _, D3, _, _, D3, _, _, A2, _, _, G2, _, _, D3, _, _, G2, _, _, _, _, _],
    kick: "x.....",
    hat: "...x..",
  },
  /* The face-off: a slow fado-style descent over a low drone, and a heartbeat. */
  tension: {
    bpm: 70,
    leadWave: "triangle",
    lead: [
      A3, C4, E4, A4, E4, C4, G3, B3, D4, G4, D4, B3,
      F3, A3, C4, F4, C4, A3, E3, Gs3, B3, E4, B3, Gs3,
    ],
    pad: [A1, _, _, _, _, _, G1, _, _, _, _, _, F1, _, _, _, _, _, E1, _, _, _, _, _],
    kick: "x..x....................",
  },
  /* The fight: a fast malhão with bombo and ferrinhos. */
  fight: {
    bpm: 120,
    leadWave: "sawtooth",
    lead: [
      G4, A4, B4, D5, _, B4, C5, _, A4, Fs4, _, D4,
      G4, A4, B4, D5, _, E5, D5, _, C5, B4, _, A4,
      B4, C5, D5, E5, _, D5, C5, _, B4, A4, _, Fs4,
      G4, _, A4, B4, _, A4, G4, _, _, G4, _, _,
    ],
    bass: [
      G2, _, D3, G2, _, D3, D3, _, A2, D3, _, A2, G2, _, D3, G2, _, D3, D3, _, A2, D3, _, A2,
      C3, _, G2, C3, _, G2, D3, _, A2, D3, _, A2, G2, _, D3, D3, _, A2, G2, _, D3, G2, _, _,
    ],
    kick: "x..x..",
    snare: "......x.....",
    hat: "x.xx.x",
  },
};

const LOOKAHEAD_S = 0.25;
const MUSIC_VOLUME = 0.16;

let playing: { name: string; gain: GainNode; timer: ReturnType<typeof setInterval> } | undefined;

const frequency = (note: number) => 440 * 2 ** ((note - 69) / 12);

function tone(out: GainNode, wave: OscillatorType, note: number, start: number, length: number, volume: number, cutoff?: number) {
  const audio = audioContext()!;
  const oscillator = audio.createOscillator();
  const envelope = audio.createGain();

  oscillator.type = wave;
  oscillator.frequency.value = frequency(note);
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(volume, start + 0.01);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + length);
  let chain: AudioNode = oscillator;

  if (cutoff) {
    const filter = audio.createBiquadFilter();

    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    chain = chain.connect(filter);
  }
  chain.connect(envelope).connect(out);
  oscillator.start(start);
  oscillator.stop(start + length + 0.02);
}

function drum(out: GainNode, kind: "kick" | "snare" | "hat", start: number, noise: AudioBuffer) {
  const audio = audioContext()!;

  if (kind === "kick") {
    const oscillator = audio.createOscillator();
    const envelope = audio.createGain();

    oscillator.frequency.setValueAtTime(130, start);
    oscillator.frequency.exponentialRampToValueAtTime(42, start + 0.12);
    envelope.gain.setValueAtTime(1, start);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
    oscillator.connect(envelope).connect(out);
    oscillator.start(start);
    oscillator.stop(start + 0.25);
    return;
  }
  const source = audio.createBufferSource();
  const filter = audio.createBiquadFilter();
  const envelope = audio.createGain();
  const length = kind === "snare" ? 0.16 : 0.04;

  source.buffer = noise;
  filter.type = kind === "snare" ? "bandpass" : "highpass";
  filter.frequency.value = kind === "snare" ? 1800 : 7000;
  envelope.gain.setValueAtTime(kind === "snare" ? 0.7 : 0.25, start);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + length);
  source.connect(filter).connect(envelope).connect(out);
  source.start(start, Math.random() * 0.5, length + 0.02);
}

/** Switches to a tune, fading the previous one out. Does nothing until sound is unlocked. */
export function playMusic(name: string | undefined) {
  const audio = audioContext();

  if (!audio || playing?.name === name) return;
  stopMusic(0.6);
  if (!name) return;

  const track = TRACKS[name];
  const gain = audio.createGain();
  const noise = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
  const data = noise.getChannelData(0);
  const step = 60 / track.bpm / 4;
  let next = audio.currentTime + 0.05;
  let index = 0;

  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  gain.gain.setValueAtTime(0.0001, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(MUSIC_VOLUME, audio.currentTime + 0.4);
  gain.connect(audio.destination);

  const at = <T>(list: T[] | string | undefined, i: number) => (list ? list[i % list.length] : undefined);
  const schedule = () => {
    while (next < audio.currentTime + LOOKAHEAD_S) {
      const lead = at(track.lead, index) as Note | undefined;
      const bass = at(track.bass, index) as Note | undefined;
      const pad = at(track.pad, index) as Note | undefined;

      if (lead) tone(gain, track.leadWave ?? "square", lead, next, step * 1.8, 0.22, 3200);
      if (bass) tone(gain, "sawtooth", bass, next, step * 1.6, 0.4, 700);
      if (pad) tone(gain, "triangle", pad, next, step * 15, 0.5, 400);
      if (at(track.kick, index) === "x") drum(gain, "kick", next, noise);
      if (at(track.snare, index) === "x") drum(gain, "snare", next, noise);
      if (at(track.hat, index) === "x") drum(gain, "hat", next, noise);
      next += step;
      index++;
    }
  };

  schedule();
  playing = { name, gain, timer: setInterval(schedule, 60) };
}

export function stopMusic(fadeSeconds = 1) {
  const audio = audioContext();

  if (!audio || !playing) return;
  const { gain, timer } = playing;

  clearInterval(timer);
  gain.gain.cancelScheduledValues(audio.currentTime);
  gain.gain.setValueAtTime(gain.gain.value, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + fadeSeconds);
  setTimeout(() => gain.disconnect(), fadeSeconds * 1000 + 300);
  playing = undefined;
}
