class ModulationProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.tremoloPhase = 0
    this.chirpPhase = 0
  }

  static get parameterDescriptors() {
    return [
      { name: 'mode', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
      { name: 'rateHz', defaultValue: 6, minValue: 0.1, maxValue: 120, automationRate: 'k-rate' },
      { name: 'depth', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'chirpRateHz', defaultValue: 5, minValue: 0.1, maxValue: 20, automationRate: 'k-rate' },
      { name: 'chirpDuty', defaultValue: 0.34, minValue: 0.05, maxValue: 0.95, automationRate: 'k-rate' },
      { name: 'attack', defaultValue: 0.025, minValue: 0.001, maxValue: 0.25, automationRate: 'k-rate' },
    ]
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0]
    const output = outputs[0]
    const mode = Math.round(parameters.mode[0] || 0)
    const rateHz = parameters.rateHz[0] || 6
    const depth = parameters.depth[0] || 0
    const chirpRateHz = parameters.chirpRateHz[0] || 5
    const chirpDuty = parameters.chirpDuty[0] || 0.34
    const attack = parameters.attack[0] || 0.025

    if (!input[0]) {
      for (let channelIndex = 0; channelIndex < output.length; channelIndex += 1) {
        output[channelIndex].fill(0)
      }
      return true
    }

    for (let sampleIndex = 0; sampleIndex < output[0].length; sampleIndex += 1) {
      const tremolo = 0.5 + 0.5 * Math.sin(this.tremoloPhase)
      const pulse = mode === 1 ? tremolo : this.getChirpEnvelope(chirpDuty, attack) * tremolo
      const gain = mode === 0 ? 1 : 1 - depth + depth * pulse

      for (let channelIndex = 0; channelIndex < output.length; channelIndex += 1) {
        const inputChannel = input[channelIndex] || input[0]
        const outputChannel = output[channelIndex]
        outputChannel[sampleIndex] = inputChannel[sampleIndex] * gain
      }

      this.tremoloPhase += (Math.PI * 2 * rateHz) / sampleRate
      this.chirpPhase += chirpRateHz / sampleRate

      if (this.tremoloPhase >= Math.PI * 2) {
        this.tremoloPhase -= Math.PI * 2
      }
      if (this.chirpPhase >= 1) {
        this.chirpPhase -= 1
      }
    }

    return true
  }

  getChirpEnvelope(duty, attackSeconds) {
    if (this.chirpPhase > duty) {
      return 0
    }

    const attackPortion = Math.min(0.45, attackSeconds * 8)
    const releaseStart = Math.max(attackPortion, duty - attackPortion)

    if (this.chirpPhase < attackPortion) {
      return this.chirpPhase / attackPortion
    }
    if (this.chirpPhase > releaseStart) {
      return Math.max(0, (duty - this.chirpPhase) / Math.max(0.001, duty - releaseStart))
    }

    return 1
  }
}

registerProcessor('modulation-processor', ModulationProcessor)
