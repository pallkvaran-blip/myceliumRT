/* SFX METER — an init script that measures what the page's audio really does, independently of the
 * game's own bookkeeping. Shared by tests/sfx-probe.cjs (a tool) and tests/juice-check.cjs ('loud').
 *
 *   PEAK: every connection to an AudioDestinationNode is also routed into a per-context tap bus, which
 *   feeds an AudioWorklet that tracks the largest |sample| on the AUDIO THREAD and posts it back.
 *   The first version (sfx-probe) polled an AnalyserNode from a 10 ms setInterval on the main thread,
 *   and headless throttles timers: it read a seam ping at -31 dBFS that is really ~-20, i.e. it missed
 *   most short cues. The worklet sees every render quantum. `window.__peak` (linear), reset by writing 0
 *   (the worklet is told through its port).
 *
 *   WARM BEFORE MEASURING (M12 minors): the tap bus and its worklet are installed when a context is
 *   CONSTRUCTED, not on its first connect to the speakers, and `window.__meterReady()` resolves once every
 *   context's meter is attached. The first version built the bus lazily on the first connect and attached
 *   the worklet when `addModule` resolved, so the first cue a page played went out through a bus with
 *   nothing listening: the first seam ping read -34.4 dBFS and the same ping a moment later -20.8. Await
 *   `__meterReady()` before the first scenario.
 *
 *   PHONE: the same signal through a 300 Hz 4th-order highpass (two Butterworth biquads) into a second
 *   meter, `window.__peakPhone` — a stand-in for a phone speaker's low roll-off. A 62 Hz sine loses ~55 dB
 *   there, a 1 kHz one nothing. It is a proxy, not a speaker measurement; what it can say is whether a cue
 *   carries ANY energy where a phone speaker plays.
 *
 *   VOICES: AudioScheduledSourceNode.start/stop are wrapped, so every oscillator and buffer source the
 *   page schedules is an interval [start, stop) on the audio clock — a buffer source with no stop ends
 *   at its buffer's length / playbackRate. `window.__voiceMax()` is the most that overlap at any instant
 *   since `window.__voiceReset()`. Counts SOURCES, which is what a voice is: a gong is three.
 */
module.exports = (page) => page.addInitScript(() => {
  const W = window;
  W.__peak = 0; W.__peakPhone = 0;
  const meters = [];
  Object.defineProperty(W, '__peakReset', { value: () => { W.__peak = 0; W.__peakPhone = 0; for (const m of meters) try { m.port.postMessage('reset'); } catch (_) {} } });
  const SRC = 'class PeakMeter extends AudioWorkletProcessor{constructor(){super();this.m=0;this.port.onmessage=()=>{this.m=0;};}' +
    'process(inp){const ch=inp[0];if(ch)for(let c=0;c<ch.length;c++){const d=ch[c];for(let i=0;i<d.length;i++){const v=d[i]<0?-d[i]:d[i];if(v>this.m){this.m=v;this.port.postMessage(v);}}}return true;}}' +
    "registerProcessor('peak-meter',PeakMeter);";
  const url = URL.createObjectURL(new Blob([SRC], { type: 'application/javascript' }));
  const C = AudioNode.prototype.connect;
  const buses = new WeakMap();
  const pending = [];
  // The bus for a context, built once: everything the page connects to the speakers also feeds it.
  const busFor = (ctx) => {
    let bus = buses.get(ctx);
    if (bus) return bus;
    bus = ctx.createGain(); buses.set(ctx, bus);
    pending.push(ctx.audioWorklet.addModule(url).then(() => {
      const z = ctx.createGain(); z.gain.value = 0;
      const m = new AudioWorkletNode(ctx, 'peak-meter');
      meters.push(m);
      m.port.onmessage = (e) => { if (e.data > W.__peak) W.__peak = e.data; };
      C.call(bus, m); C.call(m, z);
      // the phone proxy: 300 Hz, 24 dB/octave below
      const h1 = ctx.createBiquadFilter(), h2 = ctx.createBiquadFilter();
      for (const h of [h1, h2]) { h.type = 'highpass'; h.frequency.value = 300; h.Q.value = Math.SQRT1_2; }
      const mp = new AudioWorkletNode(ctx, 'peak-meter');
      meters.push(mp);
      mp.port.onmessage = (e) => { if (e.data > W.__peakPhone) W.__peakPhone = e.data; };
      C.call(bus, h1); C.call(h1, h2); C.call(h2, mp); C.call(mp, z);
      C.call(z, ctx.destination);
    }).catch((e) => { W.__meterError = String(e); }));
    return bus;
  };
  // ...installed as the context is made, so the first cue is metered whole
  for (const name of ['AudioContext', 'webkitAudioContext']) {
    const K = W[name];
    if (typeof K !== 'function') continue;
    const Wrapped = function (...args) { const c = new K(...args); try { busFor(c); } catch (_) {} return c; };
    Wrapped.prototype = K.prototype;
    try { W[name] = Wrapped; } catch (_) {}
  }
  W.__meterReady = () => Promise.all(pending.slice()).then(() => meters.length);
  AudioNode.prototype.connect = function (dst) {
    const r = C.apply(this, arguments);
    try { if (dst && dst instanceof AudioDestinationNode) C.call(this, busFor(this.context)); } catch (_) {}
    return r;
  };
  // voices
  const iv = [];
  let vReset = 0;
  // AudioBufferSourceNode overrides start(when, offset, duration), so both prototypes are wrapped.
  for (const S of [AudioScheduledSourceNode.prototype, AudioBufferSourceNode.prototype]) {
    if (!Object.prototype.hasOwnProperty.call(S, 'start')) continue;
    const st = S.start, sp = S.stop;
    S.start = function (when) {
      if (!this.__iv) {
        const t = Math.max(+when || 0, this.context.currentTime);
        let end = Infinity;
        if (this.buffer) end = t + this.buffer.duration / ((this.playbackRate && this.playbackRate.value) || 1);
        this.__iv = { t, end };
        iv.push(this.__iv);
        if (iv.length > 4000) { iv.splice(0, 2000); vReset = Math.max(0, vReset - 2000); }
      }
      return st.apply(this, arguments);
    };
    if (Object.prototype.hasOwnProperty.call(S, 'stop')) S.stop = function (when) {
      if (this.__iv) this.__iv.end = Math.min(this.__iv.end, Math.max(+when || 0, this.context.currentTime));
      return sp.apply(this, arguments);
    };
  }
  W.__voiceReset = () => { vReset = iv.length; };
  W.__voiceMax = () => {
    const ev = [];
    for (let i = vReset; i < iv.length; i++) { const v = iv[i]; if (!isFinite(v.end)) continue; ev.push([v.t, 1], [v.end, -1]); }
    ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let n = 0, m = 0;
    for (const e of ev) { n += e[1]; if (n > m) m = n; }
    return m;
  };
});
