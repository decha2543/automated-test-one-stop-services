import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface NotificationSoundStore {
  enabled: boolean;
  toggle: () => void;
}

export const useNotificationSound = create<NotificationSoundStore>()(
  persist(
    (set) => ({
      enabled: true,
      toggle: () => set((s) => ({ enabled: !s.enabled })),
    }),
    { name: 'hub-notification-sound' },
  ),
);

const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
let audioCtx: InstanceType<typeof window.AudioContext> | null = null;

function getAudioCtx(): InstanceType<typeof window.AudioContext> {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

function playTone(frequency: number, duration: number, type: OscillatorType = 'sine'): void {
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, ctx.currentTime);
  gain.gain.setValueAtTime(0.3, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + duration);
}

/** Play a success chime (two ascending tones). */
export function playSuccessSound(): void {
  if (!useNotificationSound.getState().enabled) return;
  playTone(523, 0.15, 'sine'); // C5
  setTimeout(() => playTone(659, 0.25, 'sine'), 150); // E5
}

/** Play a failure sound (two descending tones). */
export function playFailureSound(): void {
  if (!useNotificationSound.getState().enabled) return;
  playTone(440, 0.2, 'square'); // A4
  setTimeout(() => playTone(330, 0.35, 'square'), 200); // E4
}
