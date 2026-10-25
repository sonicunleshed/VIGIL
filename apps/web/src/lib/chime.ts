/**
 * Reminder signals for the patient check-in page. The chime is synthesised with Web Audio (no
 * sound file). Phones only allow sound after a tap, so call `unlock()` from a click handler.
 */
type AudioContextCtor = typeof AudioContext;

export class Chime {
  private ctx: AudioContext | null = null;

  /** Returns false when this browser has no Web Audio. */
  unlock(): boolean {
    const Ctor: AudioContextCtor | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
    if (!Ctor) return false;
    this.ctx ??= new Ctor();
    void this.ctx.resume();
    return true;
  }

  /** Two short, soft notes. */
  play(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [freq, delay] of [
      [660, 0],
      [880, 0.18],
    ]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + delay);
      gain.gain.exponentialRampToValueAtTime(0.25, t + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + delay);
      osc.stop(t + delay + 0.4);
    }
  }
}

/** Short double buzz. Android browsers support this; iPhones ignore web vibration. */
export function vibrate(): void {
  if (typeof navigator.vibrate === "function") navigator.vibrate([200, 100, 200]);
}
