'use client';

type AudioContextState = 'not-initialized' | 'initialized' | 'suspended' | 'closed';

interface OscillatorConfig {
  frequency: number;
  type: OscillatorType;
  duration: number;
  startTime?: number;
  frequency2?: number;
  freqEndTime?: number;
}

interface NoiseConfig {
  duration: number;
  startTime?: number;
  lowFreq?: number;
  highFreq?: number;
  q?: number;
}

interface EnvelopeConfig {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  peakLevel: number;
  sustainLevel?: number;
}

class SoundEngine {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private state: AudioContextState = 'not-initialized';
  private activeNodes: Set<AudioNode> = new Set();
  private crowdLoopNodes: {
    source: AudioBufferSourceNode | null;
    gainNode: GainNode | null;
  } = { source: null, gainNode: null };

  private defaultEnvelopes = {
    punch: {
      attack: 0.01,
      decay: 0.15,
      sustain: 0,
      release: 0.05,
      peakLevel: 1,
      sustainLevel: 0,
    },
    block: {
      attack: 0.005,
      decay: 0.3,
      sustain: 0,
      release: 0.1,
      peakLevel: 1,
      sustainLevel: 0,
    },
    whoosh: {
      attack: 0.02,
      decay: 0.2,
      sustain: 0,
      release: 0.05,
      peakLevel: 1,
      sustainLevel: 0,
    },
    ko: {
      attack: 0.02,
      decay: 0.4,
      sustain: 0.3,
      release: 0.3,
      peakLevel: 1,
      sustainLevel: 0.2,
    },
    bell: {
      attack: 0.01,
      decay: 0.5,
      sustain: 0.1,
      release: 0.2,
      peakLevel: 1,
      sustainLevel: 0.05,
    },
    note: {
      attack: 0.05,
      decay: 0.15,
      sustain: 0,
      release: 0.1,
      peakLevel: 1,
      sustainLevel: 0,
    },
  };

  /**
   * Initialize the AudioContext
   * Must be called on user interaction due to browser autoplay policy
   */
  public init(): boolean {
    if (this.state === 'initialized') {
      return true;
    }

    try {
      const audioContext =
        new (window.AudioContext || (window as any).webkitAudioContext)();
      this.audioContext = audioContext;
      this.masterGain = audioContext.createGain();
      this.masterGain.connect(audioContext.destination);
      this.masterGain.gain.value = 0.3;
      this.state = 'initialized';
      return true;
    } catch (e) {
      console.error('Failed to initialize AudioContext:', e);
      this.state = 'closed';
      return false;
    }
  }

  /**
   * Ensure AudioContext is running (resume if suspended)
   */
  private async ensureContextRunning(): Promise<void> {
    if (!this.audioContext) {
      this.init();
    }

    if (
      this.audioContext &&
      this.audioContext.state === 'suspended'
    ) {
      try {
        await this.audioContext.resume();
        this.state = 'initialized';
      } catch (e) {
        console.error('Failed to resume AudioContext:', e);
      }
    }
  }

  /**
   * Create an oscillator with envelope
   */
  private createOscillator(
    config: OscillatorConfig,
    envelope: EnvelopeConfig
  ): { osc: OscillatorNode; gain: GainNode } {
    if (!this.audioContext) throw new Error('AudioContext not initialized');

    const now = this.audioContext.currentTime;
    const startTime = config.startTime || now;

    const osc = this.audioContext.createOscillator();
    osc.type = config.type;
    osc.frequency.value = config.frequency;

    // Frequency sweep if specified
    if (config.frequency2 && config.freqEndTime) {
      osc.frequency.exponentialRampToValueAtTime(
        config.frequency2,
        startTime + config.freqEndTime
      );
    }

    const gain = this.audioContext.createGain();

    // Apply envelope to gain
    this.applyEnvelope(gain, startTime, config.duration, envelope);

    osc.connect(gain);
    gain.connect(this.masterGain!);

    // Auto-cleanup
    setTimeout(() => {
      osc.stop();
      this.activeNodes.delete(osc);
      this.activeNodes.delete(gain);
    }, (config.duration + 0.1) * 1000);

    this.activeNodes.add(osc);
    this.activeNodes.add(gain);

    osc.start(startTime);
    return { osc, gain };
  }

  /**
   * Create white noise with optional bandpass filter
   */
  private createNoise(
    config: NoiseConfig,
    envelope: EnvelopeConfig
  ): { source: AudioBufferSourceNode; gain: GainNode } {
    if (!this.audioContext) throw new Error('AudioContext not initialized');

    const now = this.audioContext.currentTime;
    const startTime = config.startTime || now;

    // Generate white noise buffer
    const bufferSize =
      this.audioContext.sampleRate * config.duration;
    const noiseBuffer = this.audioContext.createBuffer(
      1,
      bufferSize,
      this.audioContext.sampleRate
    );
    const data = noiseBuffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = noiseBuffer;

    let output: AudioNode = source;

    // Apply bandpass filter if specified
    if (config.lowFreq && config.highFreq) {
      const filter = this.audioContext.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = (config.lowFreq + config.highFreq) / 2;
      filter.Q.value = config.q || 1;
      source.connect(filter);
      output = filter;
    }

    const gain = this.audioContext.createGain();
    this.applyEnvelope(gain, startTime, config.duration, envelope);

    output.connect(gain);
    gain.connect(this.masterGain!);

    // Auto-cleanup
    setTimeout(() => {
      source.stop();
      this.activeNodes.delete(source);
      this.activeNodes.delete(gain);
    }, (config.duration + 0.1) * 1000);

    this.activeNodes.add(source);
    this.activeNodes.add(gain);

    source.start(startTime);
    return { source, gain };
  }

  /**
   * Apply ADSR envelope to a gain node
   */
  private applyEnvelope(
    gainNode: GainNode,
    startTime: number,
    duration: number,
    envelope: EnvelopeConfig
  ): void {
    const { attack, decay, sustain, release, peakLevel, sustainLevel = 0 } =
      envelope;

    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(
      peakLevel,
      startTime + attack
    );
    gainNode.gain.linearRampToValueAtTime(
      sustainLevel,
      startTime + attack + decay
    );

    const endTime = startTime + duration;
    gainNode.gain.setValueAtTime(sustainLevel, endTime);
    gainNode.gain.linearRampToValueAtTime(0, endTime + release);
  }

  /**
   * Light attack sound — quick punchy impact
   */
  public async playHitLight(): Promise<void> {
    await this.ensureContextRunning();
    if (!this.audioContext) return;

    // Noise burst with high-pass filtering for punchy feel
    const noiseGain = this.audioContext.createGain();
    noiseGain.connect(this.masterGain!);

    const bufferSize = this.audioContext.sampleRate * 0.15;
    const noiseBuffer = this.audioContext.createBuffer(
      1,
      bufferSize,
      this.audioContext.sampleRate
    );
    const data = noiseBuffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noiseSource = this.audioContext.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 2000;
    filter.Q.value = 0.5;

    noiseSource.connect(filter);
    filter.connect(noiseGain);

    // Quick sharp envelope
    const now = this.audioContext.currentTime;
    noiseGain.gain.setValueAtTime(0.8, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);

    // Add a short sine wave for pitch
    const osc = this.audioContext.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(400, now + 0.12);

    const oscGain = this.audioContext.createGain();
    oscGain.gain.setValueAtTime(0.3, now);
    oscGain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);

    osc.connect(oscGain);
    oscGain.connect(this.masterGain!);

    noiseSource.start(now);
    osc.start(now);

    const cleanup = () => {
      noiseSource.stop();
      osc.stop();
      this.activeNodes.delete(noiseSource);
      this.activeNodes.delete(osc);
      this.activeNodes.delete(noiseGain);
      this.activeNodes.delete(oscGain);
    };

    setTimeout(cleanup, 200);
    this.activeNodes.add(noiseSource);
    this.activeNodes.add(osc);
    this.activeNodes.add(noiseGain);
    this.activeNodes.add(oscGain);
  }

  /**
   * Heavy attack sound — deeper, louder impact
   * For heavy_punch, heavy_kick, uppercut, sweep
   */
  public async playHitHeavy(): Promise<void> {
    await this.ensureContextRunning();
    if (!this.audioContext) return;

    const now = this.audioContext.currentTime;

    // Low frequency sine for impact depth
    const osc1 = this.audioContext.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(150, now);
    osc1.frequency.exponentialRampToValueAtTime(60, now + 0.25);

    const gain1 = this.audioContext.createGain();
    gain1.gain.setValueAtTime(0.7, now);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.25);

    osc1.connect(gain1);
    gain1.connect(this.masterGain!);

    // Mid-range sine for punch character
    const osc2 = this.audioContext.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(400, now);
    osc2.frequency.exponentialRampToValueAtTime(200, now + 0.2);

    const gain2 = this.audioContext.createGain();
    gain2.gain.setValueAtTime(0.5, now);
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.2);

    osc2.connect(gain2);
    gain2.connect(this.masterGain!);

    // Noise component for aggressive texture
    const bufferSize = this.audioContext.sampleRate * 0.2;
    const noiseBuffer = this.audioContext.createBuffer(
      1,
      bufferSize,
      this.audioContext.sampleRate
    );
    const data = noiseBuffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noiseSource = this.audioContext.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1500;

    const noiseGain = this.audioContext.createGain();
    noiseGain.gain.setValueAtTime(0.4, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);

    noiseSource.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.masterGain!);

    osc1.start(now);
    osc2.start(now);
    noiseSource.start(now);

    const cleanup = () => {
      osc1.stop();
      osc2.stop();
      noiseSource.stop();
      this.activeNodes.delete(osc1);
      this.activeNodes.delete(osc2);
      this.activeNodes.delete(noiseSource);
      this.activeNodes.delete(gain1);
      this.activeNodes.delete(gain2);
      this.activeNodes.delete(noiseGain);
    };

    setTimeout(cleanup, 300);
    this.activeNodes.add(osc1);
    this.activeNodes.add(osc2);
    this.activeNodes.add(noiseSource);
    this.activeNodes.add(gain1);
    this.activeNodes.add(gain2);
    this.activeNodes.add(noiseGain);
  }

  /**
   * Block/shield sound — metallic clang
   */
  public async playBlock(): Promise<void> {
    await this.ensureContextRunning();
    if (!this.audioContext) return;

    const now = this.audioContext.currentTime;
    const duration = 0.4;

    // Metallic tone using sine wave with harmonics
    const baseFreq = 950;
    const osc1 = this.audioContext.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(baseFreq, now);
    osc1.frequency.exponentialRampToValueAtTime(baseFreq * 0.7, now + duration);

    const gain1 = this.audioContext.createGain();
    gain1.gain.setValueAtTime(0.4, now);
    gain1.gain.linearRampToValueAtTime(0.2, now + 0.08);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + duration);

    // Higher harmonic for metallic ring
    const osc2 = this.audioContext.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = baseFreq * 1.5;

    const gain2 = this.audioContext.createGain();
    gain2.gain.setValueAtTime(0.2, now);
    gain2.gain.exponentialRampToValueAtTime(0.01, now + duration);

    osc1.connect(gain1);
    gain1.connect(this.masterGain!);

    osc2.connect(gain2);
    gain2.connect(this.masterGain!);

    osc1.start(now);
    osc2.start(now);

    const cleanup = () => {
      osc1.stop();
      osc2.stop();
      this.activeNodes.delete(osc1);
      this.activeNodes.delete(osc2);
      this.activeNodes.delete(gain1);
      this.activeNodes.delete(gain2);
    };

    setTimeout(cleanup, (duration + 0.1) * 1000);
    this.activeNodes.add(osc1);
    this.activeNodes.add(osc2);
    this.activeNodes.add(gain1);
    this.activeNodes.add(gain2);
  }

  /**
   * Dodge sound — quick whoosh/wind
   */
  public async playDodge(): Promise<void> {
    await this.ensureContextRunning();
    if (!this.audioContext) return;

    const now = this.audioContext.currentTime;
    const duration = 0.2;

    // Filtered noise sweep from high to low
    const bufferSize = this.audioContext.sampleRate * duration;
    const noiseBuffer = this.audioContext.createBuffer(
      1,
      bufferSize,
      this.audioContext.sampleRate
    );
    const data = noiseBuffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noiseSource = this.audioContext.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(8000, now);
    filter.frequency.exponentialRampToValueAtTime(1000, now + duration);
    filter.Q.value = 2;

    const gain = this.audioContext.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.6, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.01, now + duration);

    noiseSource.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain!);

    noiseSource.start(now);

    const cleanup = () => {
      noiseSource.stop();
      this.activeNodes.delete(noiseSource);
      this.activeNodes.delete(gain);
    };

    setTimeout(cleanup, (duration + 0.1) * 1000);
    this.activeNodes.add(noiseSource);
    this.activeNodes.add(gain);
  }

  /**
   * KO sound — big dramatic impact with reverb
   */
  public async playKO(): Promise<void> {
    await this.ensureContextRunning();
    if (!this.audioContext) return;

    const now = this.audioContext.currentTime;
    const duration = 0.8;

    // Very low sub bass impact
    const osc1 = this.audioContext.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(80, now);
    osc1.frequency.exponentialRampToValueAtTime(20, now + 0.3);

    const gain1 = this.audioContext.createGain();
    gain1.gain.setValueAtTime(0.9, now);
    gain1.gain.linearRampToValueAtTime(0.6, now + 0.1);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + duration);

    // Add reverb simulation with delayed copies
    const convolver = this.audioContext.createConvolver();

    osc1.connect(gain1);
    gain1.connect(convolver);

    // Create a simple impulse response for reverb
    const impulseLength = this.audioContext.sampleRate * 0.5;
    const impulse = this.audioContext.createBuffer(
      1,
      impulseLength,
      this.audioContext.sampleRate
    );
    const impulseData = impulse.getChannelData(0);

    for (let i = 0; i < impulseLength; i++) {
      impulseData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / impulseLength, 2);
    }

    convolver.buffer = impulse;
    convolver.connect(this.masterGain!);

    // Noise burst for impact
    const bufferSize = this.audioContext.sampleRate * 0.3;
    const noiseBuffer = this.audioContext.createBuffer(
      1,
      bufferSize,
      this.audioContext.sampleRate
    );
    const data = noiseBuffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noiseSource = this.audioContext.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    const noiseGain = this.audioContext.createGain();
    noiseGain.gain.setValueAtTime(0.5, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.05, now + 0.3);

    noiseSource.connect(noiseGain);
    noiseGain.connect(convolver);

    osc1.start(now);
    noiseSource.start(now);

    const cleanup = () => {
      osc1.stop();
      noiseSource.stop();
      this.activeNodes.delete(osc1);
      this.activeNodes.delete(noiseSource);
      this.activeNodes.delete(gain1);
      this.activeNodes.delete(noiseGain);
    };

    setTimeout(cleanup, (duration + 0.5) * 1000);
    this.activeNodes.add(osc1);
    this.activeNodes.add(noiseSource);
    this.activeNodes.add(gain1);
    this.activeNodes.add(noiseGain);
  }

  /**
   * Round bell — classic fight bell ding (3 quick dings)
   */
  public async playRoundBell(): Promise<void> {
    await this.ensureContextRunning();
    if (!this.audioContext) return;

    const now = this.audioContext.currentTime;
    const dings = 3;
    const interval = 0.25;
    const duration = 0.4;

    for (let d = 0; d < dings; d++) {
      const startTime = now + d * interval;

      // Bell tone using sine wave
      const osc = this.audioContext.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1050, startTime);
      osc.frequency.exponentialRampToValueAtTime(900, startTime + duration);

      const gain = this.audioContext.createGain();
      gain.gain.setValueAtTime(0.7, startTime);
      gain.gain.linearRampToValueAtTime(0.5, startTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

      // Add harmonic
      const osc2 = this.audioContext.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1620, startTime);
      osc2.frequency.exponentialRampToValueAtTime(1400, startTime + duration);

      const gain2 = this.audioContext.createGain();
      gain2.gain.setValueAtTime(0.3, startTime);
      gain2.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

      osc.connect(gain);
      gain.connect(this.masterGain!);

      osc2.connect(gain2);
      gain2.connect(this.masterGain!);

      osc.start(startTime);
      osc2.start(startTime);

      const cleanupDing = () => {
        osc.stop();
        osc2.stop();
        this.activeNodes.delete(osc);
        this.activeNodes.delete(osc2);
        this.activeNodes.delete(gain);
        this.activeNodes.delete(gain2);
      };

      setTimeout(cleanupDing, (duration + 0.1) * 1000);
      this.activeNodes.add(osc);
      this.activeNodes.add(osc2);
      this.activeNodes.add(gain);
      this.activeNodes.add(gain2);
    }
  }

  /**
   * Victory fanfare — ascending notes (C5, E5, G5, C6)
   */
  public async playVictory(): Promise<void> {
    await this.ensureContextRunning();
    if (!this.audioContext) return;

    const now = this.audioContext.currentTime;

    // Note frequencies (C5, E5, G5, C6)
    const notes = [523.25, 659.25, 783.99, 1046.5];
    const noteDuration = 0.15;
    const noteSpacing = 0.12;

    for (let i = 0; i < notes.length; i++) {
      const startTime = now + i * noteSpacing;

      const osc = this.audioContext.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = notes[i];

      const gain = this.audioContext.createGain();
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.5, startTime + 0.02);
      gain.gain.setValueAtTime(0.5, startTime + noteDuration - 0.05);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + noteDuration);

      osc.connect(gain);
      gain.connect(this.masterGain!);

      osc.start(startTime);

      const cleanup = () => {
        osc.stop();
        this.activeNodes.delete(osc);
        this.activeNodes.delete(gain);
      };

      setTimeout(cleanup, (noteDuration + 0.05) * 1000);
      this.activeNodes.add(osc);
      this.activeNodes.add(gain);
    }
  }

  /**
   * Crowd cheer — bandpass-filtered white noise shaped to sound like cheering
   */
  public async playCrowdCheer(): Promise<void> {
    await this.ensureContextRunning();
    if (!this.audioContext) return;

    const now = this.audioContext.currentTime;
    const duration = 1.5;

    // Generate white noise
    const bufferSize = this.audioContext.sampleRate * duration;
    const noiseBuffer = this.audioContext.createBuffer(
      1,
      bufferSize,
      this.audioContext.sampleRate
    );
    const data = noiseBuffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noiseSource = this.audioContext.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    // Bandpass filter to shape like human voices
    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1500;
    filter.Q.value = 0.8;

    const gain = this.audioContext.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.6, now + 0.1);
    gain.gain.setValueAtTime(0.6, now + duration - 0.2);
    gain.gain.exponentialRampToValueAtTime(0.01, now + duration);

    noiseSource.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain!);

    noiseSource.start(now);

    const cleanup = () => {
      noiseSource.stop();
      this.activeNodes.delete(noiseSource);
      this.activeNodes.delete(gain);
    };

    setTimeout(cleanup, (duration + 0.1) * 1000);
    this.activeNodes.add(noiseSource);
    this.activeNodes.add(gain);
  }

  /**
   * Crowd ambient — loopable background crowd murmur
   */
  public playCrowdAmbient(start: boolean = true): void {
    if (!this.audioContext) {
      console.warn('AudioContext not initialized');
      return;
    }

    if (!start) {
      // Stop the ambient crowd
      if (this.crowdLoopNodes.source) {
        this.crowdLoopNodes.source.stop();
        this.crowdLoopNodes.source = null;
      }
      if (this.crowdLoopNodes.gainNode) {
        this.crowdLoopNodes.gainNode = null;
      }
      return;
    }

    // Stop any existing ambient
    if (this.crowdLoopNodes.source) {
      this.crowdLoopNodes.source.stop();
    }

    const now = this.audioContext.currentTime;
    const loopDuration = 4; // 4-second loop

    // Generate loopable crowd noise
    const bufferSize = this.audioContext.sampleRate * loopDuration;
    const noiseBuffer = this.audioContext.createBuffer(
      1,
      bufferSize,
      this.audioContext.sampleRate
    );
    const data = noiseBuffer.getChannelData(0);

    // Create more naturalistic crowd by mixing frequencies
    for (let i = 0; i < bufferSize; i++) {
      let sample = 0;

      // Low rumble
      sample += Math.sin((i / this.audioContext.sampleRate) * 2 * Math.PI * 150) * 0.3;

      // Mid murmur
      sample += Math.sin((i / this.audioContext.sampleRate) * 2 * Math.PI * 400) * 0.2;

      // White noise
      sample += (Math.random() * 2 - 1) * 0.4;

      data[i] = sample / 2;
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;

    const gainNode = this.audioContext.createGain();
    gainNode.gain.value = 0.15;

    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 3000;

    source.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(this.masterGain!);

    source.start(now);

    this.crowdLoopNodes.source = source;
    this.crowdLoopNodes.gainNode = gainNode;

    this.activeNodes.add(source);
    this.activeNodes.add(gainNode);
  }

  /**
   * Landing thud — short bass thump when a fighter lands from a jump
   */
  public async playLandingThud(): Promise<void> {
    await this.ensureContextRunning();
    if (!this.audioContext) return;

    const now = this.audioContext.currentTime;

    const osc = this.audioContext.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(100, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.12);

    const gain = this.audioContext.createGain();
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);

    osc.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(now);

    setTimeout(() => {
      osc.stop();
      this.activeNodes.delete(osc);
      this.activeNodes.delete(gain);
    }, 200);

    this.activeNodes.add(osc);
    this.activeNodes.add(gain);
  }

  /**
   * Set master volume (0 to 1)
   */
  public setMasterVolume(vol: number): void {
    if (this.masterGain) {
      this.masterGain.gain.value = Math.max(0, Math.min(1, vol));
    }
  }

  /**
   * Get current master volume
   */
  public getMasterVolume(): number {
    return this.masterGain?.gain.value || 0;
  }

  /**
   * Clean up and release resources
   */
  public cleanup(): void {
    this.playCrowdAmbient(false);

    // Stop all active nodes
    this.activeNodes.forEach((node) => {
      if (node instanceof OscillatorNode) {
        try {
          node.stop();
        } catch (e) {
          // Already stopped
        }
      } else if (node instanceof AudioBufferSourceNode) {
        try {
          node.stop();
        } catch (e) {
          // Already stopped
        }
      }
    });

    this.activeNodes.clear();

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch (e) {
        console.error('Error closing AudioContext:', e);
      }
    }

    this.audioContext = null;
    this.masterGain = null;
    this.state = 'closed';
  }
}

// Singleton instance
const soundEngine = new SoundEngine();

export { SoundEngine, soundEngine };
