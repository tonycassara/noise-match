export type SourceKind = 'oscillator' | 'noise'
export type Waveform = 'sine' | 'square' | 'sawtooth' | 'triangle'
export type NoiseKind = 'white' | 'pink' | 'narrow'
export type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'peaking'
export type ModulationMode = 'off' | 'tremolo' | 'chirp'

export type FilterConfig = {
  enabled: boolean
  type: FilterType
  frequencyHz: number
  q: number
  gainDb: number
}

export type ChannelConfig = {
  id: string
  label: string
  sourceKind: SourceKind
  waveform: Waveform
  noiseKind: NoiseKind
  frequencyHz: number
  gain: number
  pan: number
  filter: FilterConfig
  modulation: ModulationConfig
  muted: boolean
  soloed: boolean
  granularity: '1x' | '2x'
}

export type ModulationConfig = {
  mode: ModulationMode
  rateHz: number
  depth: number
  chirpRateHz: number
  chirpDuty: number
  attack: number
}

export type MatchConfig = {
  id: string
  name: string
  channels: ChannelConfig[]
  masterGain: number
  softeningAmount: number
  updatedAt: string
  summary: string
}

export type SavedTemplate = MatchConfig & {
  savedAt: string
}

export type ConfigHistory = {
  past: MatchConfig[]
  future: MatchConfig[]
}

export const MAX_AUTOSAVES = 5
export const MAX_CONFIG_HISTORY = 50
export const FREQUENCY_RANGE = {
  min: 20,
  max: 20000,
} as const
export const CHANNEL_GAIN_RANGE = {
  min: 0,
  max: 0.5,
} as const
export const MASTER_GAIN_RANGE = {
  min: 0,
  max: 0.8,
  default: 0.45,
} as const
export const SOFTENING_RANGE = {
  min: 0,
  max: 0.8,
  default: 0.45,
} as const

export function createDefaultChannel(id = createId(), index = 0): ChannelConfig {
  return {
    id,
    label: `Source ${index + 1}`,
    sourceKind: 'oscillator',
    waveform: 'sine',
    noiseKind: 'white',
    frequencyHz: 8000,
    gain: 0.12,
    pan: 0,
    filter: {
      enabled: false,
      type: 'bandpass',
      frequencyHz: 8000,
      q: 8,
      gainDb: 0,
    },
    modulation: getDefaultModulation(),
    muted: false,
    soloed: false,
    granularity: '1x',
  }
}

export function createDefaultConfig(): MatchConfig {
  const config: MatchConfig = {
    id: createId(),
    name: 'Untitled match',
    channels: [createDefaultChannel('source-1', 0)],
    masterGain: MASTER_GAIN_RANGE.default,
    softeningAmount: SOFTENING_RANGE.default,
    updatedAt: new Date().toISOString(),
    summary: '',
  }

  return withSummary(config)
}

export function getGainStep(granularity: ChannelConfig['granularity']) {
  return granularity === '2x' ? 0.0025 : 0.005
}

export function gainPercentToValue(percent: number) {
  const gain = percent / 100

  return Math.min(CHANNEL_GAIN_RANGE.max, Math.max(CHANNEL_GAIN_RANGE.min, gain))
}

export function getDefaultFilterEnabled(sourceKind: SourceKind, noiseKind: NoiseKind) {
  return sourceKind === 'noise' && (noiseKind === 'white' || noiseKind === 'pink')
}

export function getDefaultModulation(mode: ModulationMode = 'off'): ModulationConfig {
  return {
    mode,
    rateHz: mode === 'chirp' ? 38 : 6,
    depth: mode === 'off' ? 0 : 0.85,
    chirpRateHz: 5,
    chirpDuty: 0.34,
    attack: 0.025,
  }
}

export function getAudibleTonePartials(
  waveform: Waveform,
  frequencyHz: number,
  upperLimitHz = FREQUENCY_RANGE.max,
) {
  if (waveform === 'sine') {
    return 1
  }

  let count = 0
  for (let harmonic = 1; harmonic * frequencyHz <= upperLimitHz; harmonic += 1) {
    if (waveform === 'sawtooth') {
      count += 1
      continue
    }

    if (harmonic % 2 === 1) {
      count += 1
    }
  }

  return Math.max(1, count)
}

export function getAudioConfigSignature(config: MatchConfig) {
  return JSON.stringify({
    masterGain: config.masterGain,
    softeningAmount: config.softeningAmount,
    channels: config.channels.map((channel) => ({
      id: channel.id,
      sourceKind: channel.sourceKind,
      waveform: channel.waveform,
      noiseKind: channel.noiseKind,
      frequencyHz: channel.frequencyHz,
      gain: channel.gain,
      pan: channel.pan,
      filter: channel.filter,
      modulation: channel.modulation,
      muted: channel.muted,
      soloed: channel.soloed,
    })),
  })
}

export function getConfigHistorySignature(config: MatchConfig) {
  return JSON.stringify({
    id: config.id,
    name: config.name,
    masterGain: config.masterGain,
    softeningAmount: config.softeningAmount,
    channels: config.channels,
  })
}

export function pushConfigHistory(
  history: ConfigHistory,
  config: MatchConfig,
  limit = MAX_CONFIG_HISTORY,
): ConfigHistory {
  return {
    past: [...history.past, config].slice(-limit),
    future: [],
  }
}

export function undoConfigHistory(
  history: ConfigHistory,
  current: MatchConfig,
): { config: MatchConfig; history: ConfigHistory } {
  const previous = history.past.at(-1)

  if (!previous) {
    return { config: current, history }
  }

  return {
    config: previous,
    history: {
      past: history.past.slice(0, -1),
      future: [current, ...history.future],
    },
  }
}

export function redoConfigHistory(
  history: ConfigHistory,
  current: MatchConfig,
): { config: MatchConfig; history: ConfigHistory } {
  const next = history.future[0]

  if (!next) {
    return { config: current, history }
  }

  return {
    config: next,
    history: {
      past: [...history.past, current].slice(-MAX_CONFIG_HISTORY),
      future: history.future.slice(1),
    },
  }
}

export function createId(prefix = 'match') {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function summarizeConfig(config: Pick<MatchConfig, 'channels'>) {
  if (config.channels.length === 0) {
    return 'No sources'
  }

  const parts = config.channels.slice(0, 3).map((channel) => {
    if (channel.sourceKind === 'noise') {
      return channel.noiseKind === 'narrow'
        ? `narrow noise ${Math.round(channel.frequencyHz)}Hz`
        : `${channel.noiseKind} noise`
    }

    return `${channel.waveform} ${Math.round(channel.frequencyHz)}Hz`
  })

  const suffix = config.channels.length > 3 ? `, +${config.channels.length - 3} more` : ''
  return `${config.channels.length} source${config.channels.length === 1 ? '' : 's'}: ${parts.join(', ')}${suffix}`
}

export function withSummary(config: MatchConfig): MatchConfig {
  const safeConfig = ensureOneChannel(config)

  return {
    ...safeConfig,
    channels: safeConfig.channels.map(normalizeChannel),
    softeningAmount: safeConfig.softeningAmount ?? SOFTENING_RANGE.default,
    summary: summarizeConfig(safeConfig),
  }
}

export function ensureOneChannel(config: MatchConfig): MatchConfig {
  if (config.channels.length > 0) {
    return config
  }

  return {
    ...config,
    channels: [createDefaultChannel('source-1', 0)],
  }
}

export function appendAutosave(autosaves: MatchConfig[], config: MatchConfig) {
  const saved = withSummary({
    ...config,
    updatedAt: config.updatedAt || new Date().toISOString(),
  })

  return [saved, ...autosaves.filter((autosave) => autosave.id !== saved.id)]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, MAX_AUTOSAVES)
}

export function updateChannel(
  config: MatchConfig,
  channelId: string,
  updater: (channel: ChannelConfig) => ChannelConfig,
): MatchConfig {
  return touchConfig({
    ...config,
    channels: config.channels.map((channel) =>
      channel.id === channelId ? updater(channel) : channel,
    ),
  })
}

export function addChannel(config: MatchConfig): MatchConfig {
  return touchConfig({
    ...config,
    channels: [...config.channels, createDefaultChannel(createId('source'), config.channels.length)],
  })
}

export function duplicateChannel(
  config: MatchConfig,
  channelId: string,
  duplicateId = createId('source'),
): MatchConfig {
  const channelIndex = config.channels.findIndex((channel) => channel.id === channelId)
  const channel = config.channels[channelIndex]

  if (!channel) {
    return config
  }

  const duplicate: ChannelConfig = {
    ...channel,
    id: duplicateId,
    label: `${channel.label} copy`,
    muted: false,
    soloed: false,
  }

  return touchConfig({
    ...config,
    channels: [
      ...config.channels.slice(0, channelIndex + 1),
      duplicate,
      ...config.channels.slice(channelIndex + 1),
    ],
  })
}

export function removeChannel(config: MatchConfig, channelId: string): MatchConfig {
  if (config.channels.length <= 1) {
    return config
  }

  return touchConfig({
    ...config,
    channels: config.channels.filter((channel) => channel.id !== channelId),
  })
}

export function touchConfig(config: MatchConfig): MatchConfig {
  return withSummary({
    ...config,
    updatedAt: new Date().toISOString(),
  })
}

export function cloneConfigForSave(config: MatchConfig, name: string): SavedTemplate {
  const now = new Date().toISOString()

  return {
    ...withSummary(config),
    id: createId('template'),
    name: name.trim(),
    updatedAt: now,
    savedAt: now,
  }
}

export function saveTemplateToList(
  templates: SavedTemplate[],
  template: SavedTemplate,
  overwriteMatchingName: boolean,
) {
  const normalizedName = normalizeTemplateName(template.name)
  const matchIndex = templates.findIndex(
    (existingTemplate) => normalizeTemplateName(existingTemplate.name) === normalizedName,
  )

  if (matchIndex >= 0 && !overwriteMatchingName) {
    return templates
  }

  const cleanTemplate = {
    ...template,
    name: template.name.trim(),
  }

  if (matchIndex >= 0) {
    return [
      cleanTemplate,
      ...templates.slice(0, matchIndex),
      ...templates.slice(matchIndex + 1),
    ].slice(0, 20)
  }

  return [cleanTemplate, ...templates].slice(0, 20)
}

export function overwriteTemplateById(
  templates: SavedTemplate[],
  templateId: string,
  config: MatchConfig,
  name: string,
  savedAt = new Date().toISOString(),
) {
  return templates.map((template) => {
    if (template.id !== templateId) {
      return template
    }

    return {
      ...withSummary(config),
      id: template.id,
      name: name.trim(),
      updatedAt: savedAt,
      savedAt,
    }
  })
}

function normalizeTemplateName(name: string) {
  return name.trim().toLowerCase()
}

function normalizeChannel(channel: ChannelConfig): ChannelConfig {
  return {
    ...channel,
    modulation: channel.modulation ?? getDefaultModulation(),
  }
}
