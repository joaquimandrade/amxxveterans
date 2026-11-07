/* Three short looping tunes in an arcade style, played by a small Web Audio sequencer.
   They are original, written in A Phrygian dominant (A Bb C# D E F G) for a Balkan flavour. */

import { audioContext } from "./sound.ts";

type Note = number | null;
type Track = {
  bpm: number;
  /** One entry per sixteenth note; every channel loops over its own length. */
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
const A2 = 45, Bb2 = 46, D3 = 50, E3 = 52, F3 = 53, G3 = 55, A3 = 57;
const Bb3 = 58, Cs4 = 61, D4 = 62, E4 = 64, F4 = 65, G4 = 67;
const A4 = 69, Bb4 = 70, Cs5 = 73, D5 = 74, E5 = 76, F5 = 77;
const A1 = 33, Bb1 = 34;

export const TRACKS: Record<string, Track> = {
  /* The opening shot: a plain village tune on a soft square lead. */
  intro: {
    bpm: 112,
    leadWave: "square",
    lead: [
      A4, _, _, Cs5, D5, _, E5, _, F5, _, E5, _, D5, _, Cs5, _,
      D5, _, Cs5, _, Bb4, _, A4, _, Bb4, _, A4, _, A4, _, _, _,
    ],
    bass: [A2, _, _, _, E3, _, _, _, A2, _, _, _, E3, _, _, _, D3, _, _, _, A2, _, _, _, Bb2, _, _, _, A2, _, _, _],
    hat: "x...x...x...x...",
  },
  /* The face-off: a low drone, a creeping semitone and a heartbeat. */
  tension: {
    bpm: 76,
    leadWave: "triangle",
    pad: [A1, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, Bb1, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
    bass: [A2, _, Bb2, _, A2, _, Bb2, _, A2, _, Bb2, _, A2, _, Bb2, _],
    lead: [
      _, _, _, _, _, _, _, _, E5, _, _, _, F5, _, _, _,
      _, _, _, _, _, _, _, _, Cs5, _, _, _, D5, _, _, _,
    ],
    kick: "x..x............",
  },
  /* The fight: a fast beat, a driving bass and a Balkan lead. */
  fight: {
    bpm: 148,
    leadWave: "square",
    lead: [
      A4, _, A4, Bb4, Cs5, _, A4, _, D5, _, Cs5, _, Bb4, _, A4, _,
      E5, _, D5, _, Cs5, _, D5, _, Bb4, _, Cs5, _, A4, _, _, _,
      A4, _, A4, Bb4, Cs5, _, A4, _, D5, _, E5, _, F5, _, E5, _,
      D5, _, Cs5, _, Bb4, _, A4, _, G4, _, Bb4, _, A4, _, _, _,
    ],
    bass: [
      A2, _, A3, A2, _, A2, A3, _, A2, _, A3, A2, _, A2, Bb2, _,
      A2, _, A3, A2, _, A2, A3, _, G3, _, F3, _, E3, _, Bb2, _,
    ],
    kick: "x.....x.x.......",
    snare: "....x.......x...",
    hat: "x.x.x.x.x.x.x.xx",
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
