import type { ChannelConfig, MatchConfig } from './matchState'

type ChannelNodes = {
  source: AudioScheduledSourceNode
  gain: GainNode
  filter?: BiquadFilterNode
  modulation?: AudioWorkletNode
  pan: StereoPannerNode
}

const RAMP_SECONDS = 0.035

export class NoiseMatchAudioEngine {
  private context?: AudioContext
  private master?: GainNode
  private dryGain?: GainNode
  private wetGain?: GainNode
  private analyser?: AnalyserNode
  private leftAnalyser?: AnalyserNode
  private rightAnalyser?: AnalyserNode
  private workletLoaded = false
  private channels = new Map<string, ChannelNodes>()
  private playing = false

  get isPlaying() {
    return this.playing
  }

  getAnalyser() {
    return this.analyser
  }

  getVisualizerNodes() {
    return {
      frequency: this.analyser,
      left: this.leftAnalyser,
      right: this.rightAnalyser,
    }
  }

  async start(config: MatchConfig) {
    const context = this.ensureContext()
    await this.ensureWorklet(context)
    await context.resume()
    this.playing = true
    this.rebuild(config)
  }

  stop() {
    this.playing = false
    this.channels.forEach((nodes) => {
      rampGain(nodes.gain, 0)
      window.setTimeout(() => stopSource(nodes.source), RAMP_SECONDS * 1000)
    })
    this.channels.clear()
  }

  update(config: MatchConfig) {
    if (!this.playing) {
      return
    }

    this.rebuild(config)
  }

  private ensureContext() {
    if (this.context) {
      return this.context
    }

    const context = new AudioContext()
    const master = context.createGain()
    const dryGain = context.createGain()
    const wetGain = context.createGain()
    const output = context.createGain()
    const splitter = context.createChannelSplitter(2)
    const convolver = context.createConvolver()
    const analyser = context.createAnalyser()
    const leftAnalyser = context.createAnalyser()
    const rightAnalyser = context.createAnalyser()

    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.82
    leftAnalyser.fftSize = 1024
    leftAnalyser.smoothingTimeConstant = 0.78
    rightAnalyser.fftSize = 1024
    rightAnalyser.smoothingTimeConstant = 0.78
    master.gain.value = 0
    dryGain.gain.value = 1
    wetGain.gain.value = 0
    convolver.buffer = createSofteningImpulse(context)
    master.connect(dryGain)
    master.connect(convolver)
    dryGain.connect(output)
    convolver.connect(wetGain)
    wetGain.connect(output)
    output.connect(analyser)
    output.connect(splitter)
    splitter.connect(leftAnalyser, 0)
    splitter.connect(rightAnalyser, 1)
    analyser.connect(context.destination)

    this.context = context
    this.master = master
    this.dryGain = dryGain
    this.wetGain = wetGain
    this.analyser = analyser
    this.leftAnalyser = leftAnalyser
    this.rightAnalyser = rightAnalyser

    return context
  }

  private rebuild(config: MatchConfig) {
    const context = this.ensureContext()
    const master = this.master
    const dryGain = this.dryGain
    const wetGain = this.wetGain

    if (!master || !dryGain || !wetGain) {
      return
    }

    this.channels.forEach((nodes) => {
      rampGain(nodes.gain, 0)
      window.setTimeout(() => stopSource(nodes.source), RAMP_SECONDS * 1000)
    })
    this.channels.clear()

    rampGain(master, config.masterGain, 0.8)
    rampGain(dryGain, 1 - config.softeningAmount * 0.35, 1)
    rampGain(wetGain, config.softeningAmount, 1)

    const hasSolo = config.channels.some((channel) => channel.soloed)

    config.channels.forEach((channel) => {
      const audible = hasSolo ? channel.soloed : !channel.muted
      const nodes = createChannelNodes(
        context,
        channel,
        audible ? channel.gain : 0,
        this.workletLoaded,
      )

      nodes.pan.connect(master)
      nodes.source.start()
      this.channels.set(channel.id, nodes)
    })
  }

  private async ensureWorklet(context: AudioContext) {
    if (this.workletLoaded) {
      return
    }

    if (!context.audioWorklet) {
      return
    }

    try {
      await context.audioWorklet.addModule('/modulation-processor.js?v=2')
      this.workletLoaded = true
    } catch {
      this.workletLoaded = false
    }
  }
}

function createChannelNodes(
  context: AudioContext,
  channel: ChannelConfig,
  targetGain: number,
  canUseWorklet: boolean,
): ChannelNodes {
  const source = createSource(context, channel)
  const gain = context.createGain()
  const pan = context.createStereoPanner()
  const modulation = canUseWorklet ? createModulationNode(context, channel) : undefined
  const sourceFilter = createSourceFilter(context, channel)
  const userFilter = channel.filter.enabled ? createUserFilter(context, channel) : undefined

  gain.gain.value = 0
  pan.pan.value = channel.pan

  let tail: AudioNode = source
  if (sourceFilter) {
    tail.connect(sourceFilter)
    tail = sourceFilter
  }
  if (userFilter) {
    tail.connect(userFilter)
    tail = userFilter
  }
  if (modulation) {
    tail.connect(modulation)
    tail = modulation
  }
  tail.connect(gain)
  gain.connect(pan)
  rampGain(gain, targetGain)

  return {
    source,
    gain,
    filter: userFilter,
    modulation,
    pan,
  }
}

function createModulationNode(context: AudioContext, channel: ChannelConfig) {
  if (channel.modulation.mode === 'off') {
    return undefined
  }

  const node = new AudioWorkletNode(context, 'modulation-processor')
  setWorkletParam(node, 'mode', channel.modulation.mode === 'tremolo' ? 1 : 2)
  setWorkletParam(node, 'rateHz', channel.modulation.rateHz)
  setWorkletParam(node, 'depth', channel.modulation.depth)
  setWorkletParam(node, 'chirpRateHz', channel.modulation.chirpRateHz)
  setWorkletParam(node, 'chirpDuty', channel.modulation.chirpDuty)
  setWorkletParam(node, 'attack', channel.modulation.attack)
  return node
}

function setWorkletParam(node: AudioWorkletNode, name: string, value: number) {
  node.parameters.get(name)?.setValueAtTime(value, node.context.currentTime)
}

function createSource(context: AudioContext, channel: ChannelConfig) {
  if (channel.sourceKind === 'oscillator') {
    const oscillator = context.createOscillator()
    oscillator.type = channel.waveform
    oscillator.frequency.value = channel.frequencyHz
    return oscillator
  }

  const source = context.createBufferSource()
  source.buffer =
    channel.noiseKind === 'pink' ? createPinkNoiseBuffer(context) : createWhiteNoiseBuffer(context)
  source.loop = true
  return source
}

function createSourceFilter(context: AudioContext, channel: ChannelConfig) {
  if (channel.sourceKind !== 'noise' || channel.noiseKind !== 'narrow') {
    return undefined
  }

  const filter = context.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = channel.frequencyHz
  filter.Q.value = Math.max(1, channel.filter.q)
  return filter
}

function createUserFilter(context: AudioContext, channel: ChannelConfig) {
  const filter = context.createBiquadFilter()
  filter.type = channel.filter.type
  filter.frequency.value = channel.filter.frequencyHz
  filter.Q.value = channel.filter.q
  filter.gain.value = channel.filter.gainDb
  return filter
}

function createWhiteNoiseBuffer(context: AudioContext) {
  const length = context.sampleRate * 2
  const buffer = context.createBuffer(1, length, context.sampleRate)
  const data = buffer.getChannelData(0)

  for (let index = 0; index < length; index += 1) {
    data[index] = Math.random() * 2 - 1
  }

  return buffer
}

function createPinkNoiseBuffer(context: AudioContext) {
  const length = context.sampleRate * 2
  const buffer = context.createBuffer(1, length, context.sampleRate)
  const data = buffer.getChannelData(0)
  let b0 = 0
  let b1 = 0
  let b2 = 0
  let b3 = 0
  let b4 = 0
  let b5 = 0
  let b6 = 0

  for (let index = 0; index < length; index += 1) {
    const white = Math.random() * 2 - 1
    b0 = 0.99886 * b0 + white * 0.0555179
    b1 = 0.99332 * b1 + white * 0.0750759
    b2 = 0.969 * b2 + white * 0.153852
    b3 = 0.8665 * b3 + white * 0.3104856
    b4 = 0.55 * b4 + white * 0.5329522
    b5 = -0.7616 * b5 - white * 0.016898
    data[index] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11
    b6 = white * 0.115926
  }

  return buffer
}

function createSofteningImpulse(context: AudioContext) {
  const duration = 0.42
  const length = Math.floor(context.sampleRate * duration)
  const buffer = context.createBuffer(2, length, context.sampleRate)

  for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
    const data = buffer.getChannelData(channelIndex)
    for (let index = 0; index < length; index += 1) {
      const progress = index / length
      const decay = (1 - progress) ** 2.7
      data[index] = (Math.random() * 2 - 1) * decay * 0.45
    }
  }

  return buffer
}

function rampGain(gain: GainNode, value: number, max = 0.6) {
  const context = gain.context
  gain.gain.cancelScheduledValues(context.currentTime)
  gain.gain.setTargetAtTime(clamp(value, 0, max), context.currentTime, RAMP_SECONDS)
}

function stopSource(source: AudioScheduledSourceNode) {
  try {
    source.stop()
  } catch {
    // Source may already have been stopped during a fast control change.
  }
  source.disconnect()
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
