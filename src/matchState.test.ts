import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  appendAutosave,
  createDefaultChannel,
  createDefaultConfig,
  duplicateChannel,
  ensureOneChannel,
  CHANNEL_GAIN_RANGE,
  FREQUENCY_RANGE,
  MASTER_GAIN_RANGE,
  SOFTENING_RANGE,
  getDefaultModulation,
  getDefaultFilterEnabled,
  getGainStep,
  gainPercentToValue,
  getAudibleTonePartials,
  getAudioConfigSignature,
  getConfigHistorySignature,
  exportPortableTemplate,
  importPortableTemplate,
  pushConfigHistory,
  redoConfigHistory,
  undoConfigHistory,
  overwriteTemplateById,
  saveTemplateToList,
  summarizeConfig,
} from './matchState.ts'

describe('match state helpers', () => {
  it('summarizes source count, source types, and key frequencies', () => {
    const config = createDefaultConfig()

    config.channels = [
      {
        ...createDefaultChannel('tone-a', 0),
        sourceKind: 'oscillator',
        waveform: 'sine',
        frequencyHz: 8372,
      },
      {
        ...createDefaultChannel('noise-b', 1),
        sourceKind: 'noise',
        noiseKind: 'pink',
        frequencyHz: 4200,
      },
    ]

    assert.equal(summarizeConfig(config), '2 sources: sine 8372Hz, pink noise')
  })

  it('keeps only the five most recent autosaves', () => {
    const config = createDefaultConfig()
    const autosaves = Array.from({ length: 7 }, (_, index) =>
      appendAutosave([], {
        ...config,
        id: `match-${index}`,
        updatedAt: `2026-06-26T12:0${index}:00.000Z`,
      })[0],
    )

    const capped = autosaves.reduce<ReturnType<typeof appendAutosave>>(
      (versions, save) => appendAutosave(versions, save),
      [],
    )

    assert.equal(capped.length, 5)
    assert.deepEqual(
      capped.map((save) => save.id),
      ['match-6', 'match-5', 'match-4', 'match-3', 'match-2'],
    )
  })

  it('restores a default channel if every channel is removed', () => {
    const config = createDefaultConfig()
    config.channels = []

    const safe = ensureOneChannel(config)

    assert.equal(safe.channels.length, 1)
    assert.equal(safe.channels[0].label, 'Source 1')
  })

  it('uses the fine granularity mode to halve fader movement speed', () => {
    assert.equal(getGainStep('1x'), 0.005)
    assert.equal(getGainStep('2x'), 0.0025)
  })

  it('uses the full common hearing range for frequency controls', () => {
    assert.deepEqual(FREQUENCY_RANGE, { min: 20, max: 20000 })
  })

  it('starts with softening on and allows up to 80 percent', () => {
    assert.deepEqual(SOFTENING_RANGE, { min: 0, max: 0.8, default: 0.45 })
    assert.equal(createDefaultConfig().softeningAmount, SOFTENING_RANGE.default)
  })

  it('starts tone channels with filter and EQ disabled', () => {
    assert.equal(createDefaultChannel('source-a', 0).filter.enabled, false)
  })

  it('enables filter and EQ by default for white and pink noise only', () => {
    assert.equal(getDefaultFilterEnabled('oscillator', 'white'), false)
    assert.equal(getDefaultFilterEnabled('noise', 'white'), true)
    assert.equal(getDefaultFilterEnabled('noise', 'pink'), true)
    assert.equal(getDefaultFilterEnabled('noise', 'narrow'), false)
  })

  it('allows individual channels to get louder while keeping a cap', () => {
    assert.deepEqual(CHANNEL_GAIN_RANGE, { min: 0, max: 0.5 })
  })

  it('converts typed gain percentages to capped gain values', () => {
    assert.equal(gainPercentToValue(32), 0.32)
    assert.equal(gainPercentToValue(-12), CHANNEL_GAIN_RANGE.min)
    assert.equal(gainPercentToValue(88), CHANNEL_GAIN_RANGE.max)
  })

  it('starts the master at 45 percent and allows up to 80 percent', () => {
    assert.deepEqual(MASTER_GAIN_RANGE, { min: 0, max: 0.8, default: 0.45 })
    assert.equal(createDefaultConfig().masterGain, MASTER_GAIN_RANGE.default)
  })

  it('starts channels with modulation disabled and cricket-friendly chirp defaults available', () => {
    assert.deepEqual(createDefaultChannel('source-a', 0).modulation, getDefaultModulation())
    assert.equal(getDefaultModulation('chirp').mode, 'chirp')
    assert.equal(getDefaultModulation('chirp').rateHz, 38)
    assert.equal(getDefaultModulation('chirp').chirpRateHz, 5)
  })

  it('reports when high frequency waveforms collapse to the fundamental', () => {
    assert.equal(getAudibleTonePartials('square', 12679), 1)
    assert.equal(getAudibleTonePartials('triangle', 12679), 1)
    assert.equal(getAudibleTonePartials('sawtooth', 12679), 1)
    assert.ok(getAudibleTonePartials('sawtooth', 1200) > 1)
    assert.ok(getAudibleTonePartials('square', 1200) > 1)
  })

  it('keeps channel names out of the audio update signature', () => {
    const config = createDefaultConfig()
    const renamed = {
      ...config,
      name: 'Renamed match',
      updatedAt: '2026-06-26T14:00:00.000Z',
      summary: 'Different summary',
      channels: [
        {
          ...config.channels[0],
          label: 'Renamed source',
        },
      ],
    }
    const louder = {
      ...config,
      channels: [
        {
          ...config.channels[0],
          gain: config.channels[0].gain + 0.1,
        },
      ],
    }

    assert.equal(getAudioConfigSignature(config), getAudioConfigSignature(renamed))
    assert.notEqual(getAudioConfigSignature(config), getAudioConfigSignature(louder))
  })

  it('tracks undo and redo history for meaningful config changes', () => {
    const initial = createDefaultConfig()
    const renamed = {
      ...initial,
      updatedAt: '2026-06-26T14:00:00.000Z',
      summary: 'Derived text can change',
      channels: [
        {
          ...initial.channels[0],
          label: 'Renamed source',
        },
      ],
    }
    const louder = {
      ...renamed,
      channels: [
        {
          ...renamed.channels[0],
          gain: 0.28,
        },
      ],
    }

    let history = pushConfigHistory({ past: [], future: [] }, initial)
    history = pushConfigHistory(history, renamed)

    const undo = undoConfigHistory(history, louder)
    assert.equal(undo.config.channels[0].label, 'Renamed source')
    assert.equal(undo.config.channels[0].gain, initial.channels[0].gain)

    const redo = redoConfigHistory(undo.history, undo.config)
    assert.equal(redo.config.channels[0].gain, 0.28)
  })

  it('ignores derived timestamp and summary changes in config history signatures', () => {
    const config = createDefaultConfig()
    const derivedOnly = {
      ...config,
      updatedAt: '2026-06-26T14:00:00.000Z',
      summary: 'Different derived summary',
    }
    const renamed = {
      ...derivedOnly,
      channels: [{ ...derivedOnly.channels[0], label: 'New source name' }],
    }

    assert.equal(getConfigHistorySignature(config), getConfigHistorySignature(derivedOnly))
    assert.notEqual(getConfigHistorySignature(config), getConfigHistorySignature(renamed))
  })

  it('exports and imports portable template JSON', () => {
    const config = {
      ...createDefaultConfig(),
      name: 'Brave transfer',
      channels: [
        {
          ...createDefaultChannel('source-a', 0),
          label: 'Left ring',
          frequencyHz: 12679,
          gain: 0.22,
        },
      ],
    }

    const portable = exportPortableTemplate(config)
    const imported = importPortableTemplate(portable)

    assert.equal(imported.name, 'Brave transfer')
    assert.equal(imported.channels.length, 1)
    assert.equal(imported.channels[0].label, 'Left ring')
    assert.equal(imported.channels[0].frequencyHz, 12679)
    assert.equal(imported.channels[0].gain, 0.22)
    assert.match(imported.summary, /1 source/)
  })

  it('rejects invalid portable template JSON', () => {
    assert.throws(() => importPortableTemplate('not json'), /valid Noise Match template/)
    assert.throws(
      () => importPortableTemplate(JSON.stringify({ kind: 'other', config: createDefaultConfig() })),
      /valid Noise Match template/,
    )
  })

  it('duplicates a channel with the same settings and a fresh identity', () => {
    const config = createDefaultConfig()
    config.channels[0] = {
      ...config.channels[0],
      label: 'Left hiss',
      sourceKind: 'noise',
      noiseKind: 'pink',
      gain: 0.2,
      pan: -0.55,
    }

    const duplicated = duplicateChannel(config, config.channels[0].id, 'source-copy')

    assert.equal(duplicated.channels.length, 2)
    assert.equal(duplicated.channels[1].id, 'source-copy')
    assert.equal(duplicated.channels[1].label, 'Left hiss copy')
    assert.equal(duplicated.channels[1].noiseKind, 'pink')
    assert.equal(duplicated.channels[1].gain, 0.2)
    assert.equal(duplicated.channels[1].pan, -0.55)
  })

  it('replaces a template with a matching name when overwrite is allowed', () => {
    const config = createDefaultConfig()
    const existing = {
      ...config,
      id: 'template-old',
      name: 'Evening Match',
      savedAt: '2026-06-26T12:00:00.000Z',
    }
    const next = {
      ...config,
      id: 'template-new',
      name: ' evening match ',
      savedAt: '2026-06-26T13:00:00.000Z',
    }

    const templates = saveTemplateToList([existing], next, true)

    assert.equal(templates.length, 1)
    assert.equal(templates[0].id, 'template-new')
    assert.equal(templates[0].name, 'evening match')
  })

  it('keeps templates unchanged when a matching name is not overwritten', () => {
    const config = createDefaultConfig()
    const existing = {
      ...config,
      id: 'template-old',
      name: 'Evening Match',
      savedAt: '2026-06-26T12:00:00.000Z',
    }
    const next = {
      ...config,
      id: 'template-new',
      name: 'Evening Match',
      savedAt: '2026-06-26T13:00:00.000Z',
    }

    const templates = saveTemplateToList([existing], next, false)

    assert.deepEqual(templates, [existing])
  })

  it('overwrites a specific template with the current match settings', () => {
    const existing = {
      ...createDefaultConfig(),
      id: 'template-existing',
      name: 'Night match',
      savedAt: '2026-06-26T12:00:00.000Z',
    }
    const second = {
      ...createDefaultConfig(),
      id: 'template-second',
      name: 'Backup match',
      savedAt: '2026-06-26T12:05:00.000Z',
    }
    const current = {
      ...createDefaultConfig(),
      channels: [
        {
          ...createDefaultChannel('source-live', 0),
          frequencyHz: 12345,
          gain: 0.33,
        },
      ],
    }

    const templates = overwriteTemplateById(
      [existing, second],
      'template-existing',
      current,
      'Night match',
      '2026-06-26T13:00:00.000Z',
    )

    assert.equal(templates.length, 2)
    assert.equal(templates[0].id, 'template-existing')
    assert.equal(templates[0].name, 'Night match')
    assert.equal(templates[0].savedAt, '2026-06-26T13:00:00.000Z')
    assert.equal(templates[0].channels[0].frequencyHz, 12345)
    assert.equal(templates[0].channels[0].gain, 0.33)
    assert.equal(templates[1].id, 'template-second')
  })
})
