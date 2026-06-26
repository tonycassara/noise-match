import React, { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

import { NoiseMatchAudioEngine } from './audioEngine'
import {
  addChannel,
  appendAutosave,
  cloneConfigForSave,
  createDefaultConfig,
  duplicateChannel,
  CHANNEL_GAIN_RANGE,
  FREQUENCY_RANGE,
  MASTER_GAIN_RANGE,
  SOFTENING_RANGE,
  getDefaultFilterEnabled,
  getDefaultModulation,
  getGainStep,
  getAudibleTonePartials,
  getAudioConfigSignature,
  getConfigHistorySignature,
  overwriteTemplateById,
  pushConfigHistory,
  redoConfigHistory,
  removeChannel,
  saveTemplateToList,
  touchConfig,
  undoConfigHistory,
  updateChannel,
  withSummary,
  gainPercentToValue,
  type ChannelConfig,
  type ConfigHistory,
  type FilterType,
  type MatchConfig,
  type ModulationMode,
  type NoiseKind,
  type SavedTemplate,
  type SourceKind,
  type Waveform,
} from './matchState'
import {
  loadWorkspace,
  saveAutosaves,
  saveCurrentConfig,
  saveTemplates,
} from './storage'
import { calculateStereoFieldPoint } from './visualizerMath'

const waveforms: Waveform[] = ['sine', 'square', 'sawtooth', 'triangle']
const noiseKinds: NoiseKind[] = ['white', 'pink', 'narrow']
const filterTypes: FilterType[] = ['lowpass', 'highpass', 'bandpass', 'peaking']
const modulationModes: ModulationMode[] = ['off', 'tremolo', 'chirp']

function App() {
  const engineRef = useRef<NoiseMatchAudioEngine | null>(null)
  const [config, setConfig] = useState<MatchConfig>(() => createDefaultConfig())
  const [configHistory, setConfigHistory] = useState<ConfigHistory>({ past: [], future: [] })
  const [autosaves, setAutosaves] = useState<MatchConfig[]>([])
  const [templates, setTemplates] = useState<SavedTemplate[]>([])
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)
  const [templateName, setTemplateName] = useState('My tinnitus match')
  const [pendingTemplate, setPendingTemplate] = useState<SavedTemplate | null>(null)
  const [templateToReplace, setTemplateToReplace] = useState<SavedTemplate | null>(null)
  const [overwriteTemplate, setOverwriteTemplate] = useState<SavedTemplate | null>(null)
  const [channelToRemove, setChannelToRemove] = useState<ChannelConfig | null>(null)
  const [templateToDelete, setTemplateToDelete] = useState<SavedTemplate | null>(null)
  const [storageStatus, setStorageStatus] = useState('Loading saved workspace...')
  const templateDialogRef = useRef<HTMLDialogElement | null>(null)
  const overwriteDialogRef = useRef<HTMLDialogElement | null>(null)
  const removeChannelDialogRef = useRef<HTMLDialogElement | null>(null)
  const deleteTemplateDialogRef = useRef<HTMLDialogElement | null>(null)

  if (engineRef.current === null) {
    engineRef.current = new NoiseMatchAudioEngine()
  }
  const audioEngine = engineRef.current
  const latestConfigRef = useRef(config)
  const audioConfigSignature = useMemo(() => getAudioConfigSignature(config), [config])

  useEffect(() => {
    const dialog = templateDialogRef.current

    if (!dialog) {
      return
    }

    if (pendingTemplate && !dialog.open) {
      dialog.showModal()
      return
    }

    if (!pendingTemplate && dialog.open) {
      dialog.close()
    }
  }, [pendingTemplate])

  useEffect(() => {
    const dialog = overwriteDialogRef.current

    if (!dialog) {
      return
    }

    if (overwriteTemplate && !dialog.open) {
      dialog.showModal()
      return
    }

    if (!overwriteTemplate && dialog.open) {
      dialog.close()
    }
  }, [overwriteTemplate])

  useEffect(() => {
    const dialog = removeChannelDialogRef.current

    if (!dialog) {
      return
    }

    if (channelToRemove && !dialog.open) {
      dialog.showModal()
      return
    }

    if (!channelToRemove && dialog.open) {
      dialog.close()
    }
  }, [channelToRemove])

  useEffect(() => {
    const dialog = deleteTemplateDialogRef.current

    if (!dialog) {
      return
    }

    if (templateToDelete && !dialog.open) {
      dialog.showModal()
      return
    }

    if (!templateToDelete && dialog.open) {
      dialog.close()
    }
  }, [templateToDelete])

  useEffect(() => {
    let active = true

    loadWorkspace()
      .then((workspace) => {
        if (!active) {
          return
        }

        const restored = workspace.currentConfig
          ? withSummary(workspace.currentConfig)
          : createDefaultConfig()

        setConfig(restored)
        setAutosaves(workspace.autosaves)
        setTemplates(workspace.templates)
        setStorageStatus(workspace.currentConfig ? 'Restored last match' : 'Ready for first match')
        setIsLoaded(true)
      })
      .catch(() => {
        if (!active) {
          return
        }

        setStorageStatus('Storage unavailable in this browser session')
        setIsLoaded(true)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    latestConfigRef.current = config
  }, [config])

  useEffect(() => {
    audioEngine.update(latestConfigRef.current)
  }, [audioEngine, audioConfigSignature])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase()
      const isSystemUndoKey = event.metaKey || event.ctrlKey

      if (!isSystemUndoKey || event.altKey) {
        return
      }

      if (key === 'z') {
        event.preventDefault()
        if (event.shiftKey) {
          redoConfig()
          return
        }

        undoConfig()
      }

      if (key === 'y') {
        event.preventDefault()
        redoConfig()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  useEffect(() => {
    if (!isLoaded) {
      return
    }

    const timeout = window.setTimeout(() => {
      const saved = withSummary(config)

      setAutosaves((currentAutosaves) => {
        const nextAutosaves = appendAutosave(currentAutosaves, saved)
        saveAutosaves(nextAutosaves).catch(() => setStorageStatus('Could not autosave'))
        return nextAutosaves
      })

      saveCurrentConfig(saved)
        .then(() => setStorageStatus('Autosaved'))
        .catch(() => setStorageStatus('Could not autosave'))
    }, 900)

    return () => window.clearTimeout(timeout)
  }, [config, isLoaded])

  const canRemoveChannels = config.channels.length > 1
  const soloActive = config.channels.some((channel) => channel.soloed)
  const canUndo = configHistory.past.length > 0
  const canRedo = configHistory.future.length > 0

  function updateConfig(updater: (current: MatchConfig) => MatchConfig) {
    setConfig((current) => {
      const next = updater(current)

      if (getConfigHistorySignature(next) === getConfigHistorySignature(current)) {
        return current
      }

      setConfigHistory((history) => pushConfigHistory(history, current))
      return next
    })
  }

  function replaceConfig(nextConfig: MatchConfig) {
    updateConfig(() => nextConfig)
  }

  function undoConfig() {
    setConfig((current) => {
      const result = undoConfigHistory(configHistory, current)

      setConfigHistory(result.history)
      if (result.config === current) {
        return current
      }

      setStorageStatus('Undid last change')
      return result.config
    })
  }

  function redoConfig() {
    setConfig((current) => {
      const result = redoConfigHistory(configHistory, current)

      setConfigHistory(result.history)
      if (result.config === current) {
        return current
      }

      setStorageStatus('Redid change')
      return result.config
    })
  }

  async function togglePlayback() {
    if (isPlaying) {
      audioEngine.stop()
      setIsPlaying(false)
      return
    }

    await audioEngine.start(config)
    setIsPlaying(true)
  }

  function loadConfig(saved: MatchConfig) {
    replaceConfig(touchConfig(saved))
    setTemplateName(saved.name)
    setStorageStatus(`Loaded ${saved.name}`)
  }

  function saveTemplate() {
    const name = templateName.trim() || `Match ${templates.length + 1}`
    const existingTemplate = templates.find(
      (template) => template.name.trim().toLowerCase() === name.toLowerCase(),
    )
    const template = cloneConfigForSave(config, name)

    if (existingTemplate) {
      setPendingTemplate(template)
      setTemplateToReplace(existingTemplate)
      return
    }

    persistTemplates(saveTemplateToList(templates, template, true), template.name)
  }

  function deleteTemplate(templateId: string) {
    const nextTemplates = templates.filter((template) => template.id !== templateId)
    setTemplates(nextTemplates)
    saveTemplates(nextTemplates).catch(() => setStorageStatus('Could not delete template'))
  }

  function persistTemplates(nextTemplates: SavedTemplate[], savedName: string) {
    setTemplates(nextTemplates)
    setTemplateName(savedName)
    saveTemplates(nextTemplates)
      .then(() => setStorageStatus(`Saved template "${savedName}"`))
      .catch(() => setStorageStatus('Could not save template'))
  }

  function replacePendingTemplate() {
    if (!pendingTemplate) {
      return
    }

    persistTemplates(saveTemplateToList(templates, pendingTemplate, true), pendingTemplate.name)
    setPendingTemplate(null)
    setTemplateToReplace(null)
  }

  function confirmTemplateOverwrite(template: SavedTemplate) {
    setOverwriteTemplate(template)
  }

  function overwriteSelectedTemplate() {
    if (!overwriteTemplate) {
      return
    }

    const nextTemplates = overwriteTemplateById(
      templates,
      overwriteTemplate.id,
      config,
      overwriteTemplate.name,
    )

    persistTemplates(nextTemplates, overwriteTemplate.name)
    setOverwriteTemplate(null)
  }

  function cancelTemplateOverwrite() {
    if (overwriteTemplate) {
      setStorageStatus(`Kept existing template "${overwriteTemplate.name}"`)
    }

    setOverwriteTemplate(null)
  }

  function confirmChannelRemove(channel: ChannelConfig) {
    setChannelToRemove(channel)
  }

  function removeSelectedChannel() {
    if (!channelToRemove) {
      return
    }

    updateConfig((current) => removeChannel(current, channelToRemove.id))
    setStorageStatus(`Removed ${channelToRemove.label}`)
    setChannelToRemove(null)
  }

  function cancelChannelRemove() {
    setChannelToRemove(null)
  }

  function confirmTemplateDelete(template: SavedTemplate) {
    setTemplateToDelete(template)
  }

  function deleteSelectedTemplate() {
    if (!templateToDelete) {
      return
    }

    deleteTemplate(templateToDelete.id)
    setStorageStatus(`Deleted template "${templateToDelete.name}"`)
    setTemplateToDelete(null)
  }

  function cancelTemplateDelete() {
    setTemplateToDelete(null)
  }

  function keepExistingTemplate() {
    if (templateToReplace) {
      setStorageStatus(`Kept existing template "${templateToReplace.name}"`)
    }

    setPendingTemplate(null)
    setTemplateToReplace(null)
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <h1>Noise Match</h1>
          <p>Tinnitus matching workstation</p>
        </div>
        <div className="status-card" aria-live="polite">
          <span className={isPlaying ? 'status-dot active' : 'status-dot'}></span>
          {isPlaying ? 'Sound is playing' : 'Sound is stopped'}
        </div>
      </header>

      <section className="visualizer-panel" aria-label="Audio output and playback">
        <SpectrumVisualizer visualizers={audioEngine.getVisualizerNodes()} isPlaying={isPlaying} />
        <div className="transport">
          <button className="primary-action" type="button" onClick={togglePlayback}>
            {isPlaying ? 'Stop' : 'Play match'}
          </button>
          <div className="history-actions" aria-label="Undo and redo changes">
            <button type="button" disabled={!canUndo} onClick={undoConfig}>
              Undo
            </button>
            <button type="button" disabled={!canRedo} onClick={redoConfig}>
              Redo
            </button>
          </div>
          <LabeledRange
            id="master-volume"
            label="Master"
            min={MASTER_GAIN_RANGE.min}
            max={MASTER_GAIN_RANGE.max}
            step={0.01}
            value={config.masterGain}
            format={(value) => `${Math.round(value * 100)}%`}
            onChange={(value) => updateConfig((current) => touchConfig({ ...current, masterGain: value }))}
          />
          <LabeledRange
            id="softening"
            label="Softening"
            min={SOFTENING_RANGE.min}
            max={SOFTENING_RANGE.max}
            step={0.01}
            value={config.softeningAmount ?? 0}
            format={(value) => `${Math.round(value * 100)}%`}
            onChange={(value) =>
              updateConfig((current) => touchConfig({ ...current, softeningAmount: value }))
            }
          />
          <p className="safety-note">
            Start low. Softening adds a short ambient blend; output still varies by headphones,
            device, and browser.
          </p>
        </div>
      </section>

      <div className="workspace-grid">
        <section className="mixer" aria-label="Sound sources">
          <div className="section-heading">
            <div>
              <h2>Sources</h2>
              <p>{config.summary}</p>
            </div>
            <button type="button" className="secondary-action" onClick={() => updateConfig(addChannel)}>
              Add source
            </button>
          </div>

          <div className="channel-grid">
            {config.channels.map((channel, index) => (
              <ChannelStrip
                key={channel.id}
                channel={channel}
                index={index}
                canRemove={canRemoveChannels}
                soloActive={soloActive}
                onChange={(updater) =>
                  updateConfig((current) => updateChannel(current, channel.id, updater))
                }
                onDuplicate={() =>
                  updateConfig((current) => duplicateChannel(current, channel.id))
                }
                onRemove={() => confirmChannelRemove(channel)}
              />
            ))}
          </div>
        </section>

        <aside className="history-panel" aria-label="Saved matches">
          <div className="section-heading compact">
            <div>
              <h2>Saved</h2>
              <p>{storageStatus}</p>
            </div>
          </div>

          <section className="save-box">
            <label htmlFor="template-name">Template name</label>
            <div className="save-row">
              <input
                id="template-name"
                type="text"
                value={templateName}
                onChange={(event) => setTemplateName(event.target.value)}
              />
              <button type="button" onClick={saveTemplate}>
                Save
              </button>
            </div>
          </section>

          <SaveList title="Templates" empty="No templates saved">
            {templates.map((template) => (
              <SaveItem
                key={template.id}
                config={template}
                onLoad={() => loadConfig(template)}
                onSave={() => confirmTemplateOverwrite(template)}
                onDelete={() => confirmTemplateDelete(template)}
              />
            ))}
          </SaveList>

          <SaveList title="Autosaves" empty="No autosaves yet" subtle>
            {autosaves.map((save) => (
              <SaveItem key={save.id} config={save} onLoad={() => loadConfig(save)} subtle />
            ))}
          </SaveList>
        </aside>
      </div>

      <dialog
        ref={templateDialogRef}
        className="template-dialog"
        onCancel={keepExistingTemplate}
      >
        <form method="dialog" className="template-dialog-card">
          <p className="eyebrow">Template exists</p>
          <h2>Replace saved template?</h2>
          <p>
            A template named <strong>{templateToReplace?.name}</strong> already exists. Replacing
            it will keep the name and save the current mixer settings.
          </p>
          <div className="dialog-actions">
            <button type="button" onClick={keepExistingTemplate}>
              Keep existing
            </button>
            <button type="button" className="primary-action" onClick={replacePendingTemplate}>
              Replace template
            </button>
          </div>
        </form>
      </dialog>

      <dialog
        ref={removeChannelDialogRef}
        className="template-dialog"
        onCancel={cancelChannelRemove}
      >
        <form method="dialog" className="template-dialog-card">
          <p className="eyebrow">Remove source</p>
          <h2>Remove this source?</h2>
          <p>
            This will remove <strong>{channelToRemove?.label}</strong> from the current match.
          </p>
          <div className="dialog-actions">
            <button type="button" onClick={cancelChannelRemove}>
              Cancel
            </button>
            <button type="button" className="primary-action" onClick={removeSelectedChannel}>
              Remove source
            </button>
          </div>
        </form>
      </dialog>

      <dialog
        ref={deleteTemplateDialogRef}
        className="template-dialog"
        onCancel={cancelTemplateDelete}
      >
        <form method="dialog" className="template-dialog-card">
          <p className="eyebrow">Delete template</p>
          <h2>Delete saved template?</h2>
          <p>
            This will permanently delete <strong>{templateToDelete?.name}</strong> from saved
            templates.
          </p>
          <div className="dialog-actions">
            <button type="button" onClick={cancelTemplateDelete}>
              Cancel
            </button>
            <button type="button" className="primary-action" onClick={deleteSelectedTemplate}>
              Delete template
            </button>
          </div>
        </form>
      </dialog>

      <dialog
        ref={overwriteDialogRef}
        className="template-dialog"
        onCancel={cancelTemplateOverwrite}
      >
        <form method="dialog" className="template-dialog-card">
          <p className="eyebrow">Overwrite template</p>
          <h2>Save current match here?</h2>
          <p>
            This will replace <strong>{overwriteTemplate?.name}</strong> with the current mixer
            settings. The template name will stay the same.
          </p>
          <div className="dialog-actions">
            <button type="button" onClick={cancelTemplateOverwrite}>
              Cancel
            </button>
            <button type="button" className="primary-action" onClick={overwriteSelectedTemplate}>
              Save over template
            </button>
          </div>
        </form>
      </dialog>
    </main>
  )
}

type ChannelStripProps = {
  channel: ChannelConfig
  index: number
  canRemove: boolean
  soloActive: boolean
  onChange: (updater: (channel: ChannelConfig) => ChannelConfig) => void
  onDuplicate: () => void
  onRemove: () => void
}

function ChannelStrip({
  channel,
  index,
  canRemove,
  soloActive,
  onChange,
  onDuplicate,
  onRemove,
}: ChannelStripProps) {
  const gainStep = getGainStep(channel.granularity)
  const audibleState = channel.soloed ? 'Solo' : channel.muted || soloActive ? 'Muted' : 'Live'

  return (
    <article className="channel-strip">
      <div className="channel-header">
        <div>
          <span className="channel-index">{String(index + 1).padStart(2, '0')}</span>
          <input
            aria-label={`Name for ${channel.label}`}
            className="channel-name"
            value={channel.label}
            onChange={(event) => onChange((current) => ({ ...current, label: event.target.value }))}
          />
        </div>
        <div className="channel-state-actions">
          <span className={`audible-pill ${audibleState.toLowerCase()}`}>{audibleState}</span>
          <button
            type="button"
            className="channel-delete"
            aria-label={`Remove ${channel.label}`}
            disabled={!canRemove}
            onClick={onRemove}
          >
            ×
          </button>
        </div>
      </div>

      <div className="channel-actions">
        <button
          type="button"
          aria-pressed={channel.muted}
          onClick={() => onChange((current) => ({ ...current, muted: !current.muted }))}
        >
          Mute
        </button>
        <button
          type="button"
          aria-pressed={channel.soloed}
          onClick={() => onChange((current) => ({ ...current, soloed: !current.soloed }))}
        >
          Solo
        </button>
        <button type="button" onClick={onDuplicate}>
          Duplicate
        </button>
      </div>

      <label>
        Source
        <select
          value={channel.sourceKind}
          onChange={(event) =>
            onChange((current) => {
              const sourceKind = event.target.value as SourceKind
              return {
                ...current,
                sourceKind,
                filter: {
                  ...current.filter,
                  enabled: getDefaultFilterEnabled(sourceKind, current.noiseKind),
                },
              }
            })
          }
        >
          <option value="oscillator">Tone oscillator</option>
          <option value="noise">Noise generator</option>
        </select>
      </label>

      {channel.sourceKind === 'oscillator' ? (
        <div className="source-detail-field">
          <label>
            Waveform
            <select
              value={channel.waveform}
              onChange={(event) =>
                onChange((current) => ({ ...current, waveform: event.target.value as Waveform }))
              }
            >
              {waveforms.map((waveform) => (
                <option key={waveform} value={waveform}>
                  {waveform}
                </option>
              ))}
            </select>
          </label>
          <p>{formatTonePartials(channel.waveform, channel.frequencyHz)}</p>
        </div>
      ) : (
        <div className="source-detail-field">
          <label>
            Noise
            <select
              value={channel.noiseKind}
              onChange={(event) =>
                onChange((current) => {
                  const noiseKind = event.target.value as NoiseKind
                  return {
                    ...current,
                    noiseKind,
                    filter: {
                      ...current.filter,
                      enabled: getDefaultFilterEnabled(current.sourceKind, noiseKind),
                    },
                  }
                })
              }
            >
              {noiseKinds.map((noiseKind) => (
                <option key={noiseKind} value={noiseKind}>
                  {noiseKind === 'narrow' ? 'narrow band' : noiseKind}
                </option>
              ))}
            </select>
          </label>
          <p aria-hidden="true">&nbsp;</p>
        </div>
      )}

      <LabeledRange
        id={`${channel.id}-frequency`}
        label={channel.sourceKind === 'noise' && channel.noiseKind !== 'narrow' ? 'Tone focus' : 'Frequency'}
        min={FREQUENCY_RANGE.min}
        max={FREQUENCY_RANGE.max}
        step={channel.granularity === '2x' ? 1 : 5}
        value={channel.frequencyHz}
        format={(value) => `${Math.round(value)}Hz`}
        onChange={(value) =>
          onChange((current) => ({
            ...current,
            frequencyHz: value,
            filter: { ...current.filter, frequencyHz: value },
          }))
        }
      />

      <div className="volume-block">
        <div className="gain-readout">
          <span>Gain</span>
          <GainPercentInput
            value={channel.gain}
            label={`${channel.label} gain percentage`}
            onChange={(gain) => onChange((current) => ({ ...current, gain }))}
          />
          <button
            type="button"
            className="granularity-toggle"
            aria-pressed={channel.granularity === '2x'}
            onClick={() =>
              onChange((current) => ({
                ...current,
                granularity: current.granularity === '1x' ? '2x' : '1x',
              }))
            }
          >
            {channel.granularity === '2x' ? 'Fine 2x' : 'Normal 1x'}
          </button>
        </div>
        <input
          aria-label={`${channel.label} gain fader`}
          className="vertical-fader"
          type="range"
          min={CHANNEL_GAIN_RANGE.min}
          max={CHANNEL_GAIN_RANGE.max}
          step={gainStep}
          value={channel.gain}
          onChange={(event) =>
            onChange((current) => ({ ...current, gain: Number(event.target.value) }))
          }
        />
      </div>

      <LabeledRange
        id={`${channel.id}-pan`}
        label="Pan"
        min={-1}
        max={1}
        step={0.01}
        value={channel.pan}
        format={formatPan}
        onChange={(value) => onChange((current) => ({ ...current, pan: value }))}
      />

      <ModulationControls channel={channel} onChange={onChange} />

      <FilterControls channel={channel} onChange={onChange} />
    </article>
  )
}

function GainPercentInput({
  value,
  label,
  onChange,
}: {
  value: number
  label: string
  onChange: (value: number) => void
}) {
  const [draft, setDraft] = useState(() => String(Math.round(value * 100)))

  useEffect(() => {
    setDraft(String(Math.round(value * 100)))
  }, [value])

  function commit(nextValue: string) {
    const parsed = Number(nextValue)

    if (!Number.isFinite(parsed)) {
      return
    }

    onChange(gainPercentToValue(parsed))
  }

  return (
    <label className="gain-percent-input">
      <span className="sr-only">{label}</span>
      <input
        inputMode="decimal"
        type="text"
        value={draft}
        onBlur={() => setDraft(String(Math.round(value * 100)))}
        onChange={(event) => {
          const nextValue = event.target.value

          setDraft(nextValue)
          if (nextValue.trim() !== '') {
            commit(nextValue)
          }
        }}
      />
      <span>%</span>
    </label>
  )
}

function ModulationControls({
  channel,
  onChange,
}: {
  channel: ChannelConfig
  onChange: (updater: (channel: ChannelConfig) => ChannelConfig) => void
}) {
  return (
    <details className="filter-box">
      <summary>
        <span>Modulation</span>
        <strong>{formatModulationMode(channel.modulation.mode)}</strong>
      </summary>
      <div className="filter-body">
        <label>
          Mode
          <select
            value={channel.modulation.mode}
            onChange={(event) =>
              onChange((current) => {
                const mode = event.target.value as ModulationMode

                return {
                  ...current,
                  modulation: getDefaultModulation(mode),
                }
              })
            }
          >
            {modulationModes.map((mode) => (
              <option key={mode} value={mode}>
                {formatModulationMode(mode)}
              </option>
            ))}
          </select>
        </label>
        <LabeledRange
          id={`${channel.id}-mod-depth`}
          label="Depth"
          min={0}
          max={1}
          step={0.01}
          value={channel.modulation.depth}
          format={(value) => `${Math.round(value * 100)}%`}
          onChange={(value) =>
            onChange((current) => ({
              ...current,
              modulation: { ...current.modulation, depth: value },
            }))
          }
        />
        <LabeledRange
          id={`${channel.id}-mod-rate`}
          label={channel.modulation.mode === 'chirp' ? 'Inner pulse' : 'Rate'}
          min={0.1}
          max={90}
          step={0.1}
          value={channel.modulation.rateHz}
          format={(value) => `${value.toFixed(1)}Hz`}
          onChange={(value) =>
            onChange((current) => ({
              ...current,
              modulation: { ...current.modulation, rateHz: value },
            }))
          }
        />
        {channel.modulation.mode === 'chirp' ? (
          <>
            <LabeledRange
              id={`${channel.id}-chirp-rate`}
              label="Chirp speed"
              min={0.2}
              max={14}
              step={0.1}
              value={channel.modulation.chirpRateHz}
              format={(value) => `${value.toFixed(1)}/sec`}
              onChange={(value) =>
                onChange((current) => ({
                  ...current,
                  modulation: { ...current.modulation, chirpRateHz: value },
                }))
              }
            />
            <LabeledRange
              id={`${channel.id}-chirp-duty`}
              label="Chirp length"
              min={0.05}
              max={0.9}
              step={0.01}
              value={channel.modulation.chirpDuty}
              format={(value) => `${Math.round(value * 100)}%`}
              onChange={(value) =>
                onChange((current) => ({
                  ...current,
                  modulation: { ...current.modulation, chirpDuty: value },
                }))
              }
            />
            <LabeledRange
              id={`${channel.id}-chirp-attack`}
              label="Soft edge"
              min={0.001}
              max={0.18}
              step={0.001}
              value={channel.modulation.attack}
              format={(value) => `${Math.round(value * 1000)}ms`}
              onChange={(value) =>
                onChange((current) => ({
                  ...current,
                  modulation: { ...current.modulation, attack: value },
                }))
              }
            />
          </>
        ) : null}
      </div>
    </details>
  )
}

function FilterControls({
  channel,
  onChange,
}: {
  channel: ChannelConfig
  onChange: (updater: (channel: ChannelConfig) => ChannelConfig) => void
}) {
  return (
    <details className="filter-box">
      <summary>
        <span>Filter / EQ</span>
        <strong>{channel.filter.enabled ? 'On' : 'Off'}</strong>
      </summary>
      <div className="filter-body">
        <label className="checkbox-line">
          <input
            type="checkbox"
            checked={channel.filter.enabled}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                filter: { ...current.filter, enabled: event.target.checked },
              }))
            }
          />
          Enabled
        </label>
        <label>
          Type
          <select
            value={channel.filter.type}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                filter: { ...current.filter, type: event.target.value as FilterType },
              }))
            }
          >
            {filterTypes.map((filterType) => (
              <option key={filterType} value={filterType}>
                {filterType}
              </option>
            ))}
          </select>
        </label>
        <LabeledRange
          id={`${channel.id}-filter-frequency`}
          label="Sweep"
          min={FREQUENCY_RANGE.min}
          max={FREQUENCY_RANGE.max}
          step={channel.granularity === '2x' ? 1 : 10}
          value={channel.filter.frequencyHz}
          format={(value) => `${Math.round(value)}Hz`}
          onChange={(value) =>
            onChange((current) => ({
              ...current,
              filter: { ...current.filter, frequencyHz: value },
            }))
          }
        />
        <LabeledRange
          id={`${channel.id}-filter-q`}
          label="Q"
          min={0.1}
          max={30}
          step={channel.granularity === '2x' ? 0.05 : 0.1}
          value={channel.filter.q}
          format={(value) => value.toFixed(1)}
          onChange={(value) =>
            onChange((current) => ({
              ...current,
              filter: { ...current.filter, q: value },
            }))
          }
        />
        {channel.filter.type === 'peaking' ? (
        <LabeledRange
          id={`${channel.id}-filter-gain`}
          label="Gain"
          min={-18}
          max={18}
          step={0.5}
          value={channel.filter.gainDb}
          format={(value) => `${value > 0 ? '+' : ''}${value.toFixed(1)}dB`}
          onChange={(value) =>
            onChange((current) => ({
              ...current,
              filter: { ...current.filter, gainDb: value },
            }))
          }
        />
        ) : null}
      </div>
    </details>
  )
}

function LabeledRange({
  id,
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  id: string
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (value: number) => string
  onChange: (value: number) => void
}) {
  return (
    <label className="range-control" htmlFor={id}>
      <span>
        {label}
        <strong>{format(value)}</strong>
      </span>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

function SaveList({
  title,
  empty,
  subtle = false,
  children,
}: {
  title: string
  empty: string
  subtle?: boolean
  children: React.ReactNode
}) {
  const hasChildren = React.Children.count(children) > 0

  return (
    <section className={subtle ? 'save-list subtle' : 'save-list'}>
      <h3>{title}</h3>
      <div className="save-items">{hasChildren ? children : <p className="empty-state">{empty}</p>}</div>
    </section>
  )
}

function SaveItem({
  config,
  onLoad,
  onSave,
  onDelete,
  subtle = false,
}: {
  config: MatchConfig
  onLoad: () => void
  onSave?: () => void
  onDelete?: () => void
  subtle?: boolean
}) {
  return (
    <article className={subtle ? 'save-item subtle' : 'save-item'}>
      {onDelete ? (
        <button
          type="button"
          className="corner-delete"
          aria-label={`Delete template ${config.name}`}
          onClick={onDelete}
        >
          ×
        </button>
      ) : null}
      <div>
        <strong>{config.name}</strong>
        <time dateTime={config.updatedAt}>{formatTimestamp(config.updatedAt)}</time>
        <p>{config.summary}</p>
      </div>
      <div className="save-actions">
        <button type="button" onClick={onLoad}>
          Load
        </button>
        {onSave ? (
          <button type="button" onClick={onSave}>
            Save
          </button>
        ) : null}
      </div>
    </article>
  )
}

function SpectrumVisualizer({
  visualizers,
  isPlaying,
}: {
  visualizers: {
    frequency?: AnalyserNode
    left?: AnalyserNode
    right?: AnalyserNode
  }
  isPlaying: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const idleBars = useMemo(
    () => Array.from({ length: 56 }, (_, index) => 18 + Math.sin(index * 0.55) * 10),
    [],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')

    if (!canvas || !context) {
      return
    }

    let frame = 0
    const frequencyData = visualizers.frequency
      ? new Uint8Array(visualizers.frequency.frequencyBinCount)
      : new Uint8Array(0)
    const leftData = visualizers.left
      ? new Uint8Array(visualizers.left.fftSize)
      : new Uint8Array(0)
    const rightData = visualizers.right
      ? new Uint8Array(visualizers.right.fftSize)
      : new Uint8Array(0)

    function render() {
      if (!canvas || !context) {
        return
      }

      const width = canvas.width
      const height = canvas.height

      context.clearRect(0, 0, width, height)
      context.fillStyle = '#f8fbfb'
      context.fillRect(0, 0, width, height)

      const scopeSize = Math.min(132, height - 24)
      const scopeX = width - scopeSize - 16
      const scopeY = 16
      const spectrumWidth = scopeX - 22
      const barCount = 48
      const gap = 3
      const barWidth = (spectrumWidth - gap * (barCount - 1)) / barCount

      if (isPlaying && visualizers.frequency) {
        visualizers.frequency.getByteFrequencyData(frequencyData)
      }
      if (isPlaying && visualizers.left && visualizers.right) {
        visualizers.left.getByteTimeDomainData(leftData)
        visualizers.right.getByteTimeDomainData(rightData)
      }

      for (let index = 0; index < barCount; index += 1) {
        const bucket = Math.floor((index / barCount) * frequencyData.length)
        const liveHeight = frequencyData[bucket]
          ? (frequencyData[bucket] / 255) * (height - 20)
          : 0
        const barHeight = isPlaying ? Math.max(4, liveHeight) : idleBars[index]
        const x = index * (barWidth + gap)
        const y = height - barHeight - 8
        const hue = 186 + index * 0.45

        context.fillStyle = `hsl(${hue} 34% ${isPlaying ? 42 : 72}%)`
        roundedRect(context, x, y, barWidth, barHeight, 4)
      }

      drawStereoField(context, {
        x: scopeX,
        y: scopeY,
        size: scopeSize,
        leftData,
        rightData,
        isPlaying,
      })

      frame = window.requestAnimationFrame(render)
    }

    render()
    return () => window.cancelAnimationFrame(frame)
  }, [idleBars, isPlaying, visualizers.frequency, visualizers.left, visualizers.right])

  return (
    <div className="visualizer" aria-label="Live frequency visualizer">
      <canvas ref={canvasRef} width="1100" height="164" />
      <span>{isPlaying ? 'Spectrum + stereo field' : 'Visualizer idle until playback starts'}</span>
    </div>
  )
}

function drawStereoField(
  context: CanvasRenderingContext2D,
  {
    x,
    y,
    size,
    leftData,
    rightData,
    isPlaying,
  }: {
    x: number
    y: number
    size: number
    leftData: Uint8Array
    rightData: Uint8Array
    isPlaying: boolean
  },
) {
  const centerX = x + size / 2
  const centerY = y + size / 2
  const radius = size * 0.43

  context.save()
  context.strokeStyle = '#c9dcda'
  context.lineWidth = 1
  context.beginPath()
  context.arc(centerX, centerY, radius, 0, Math.PI * 2)
  context.stroke()
  context.beginPath()
  context.moveTo(centerX - radius, centerY)
  context.lineTo(centerX + radius, centerY)
  context.moveTo(centerX, centerY - radius)
  context.lineTo(centerX, centerY + radius)
  context.stroke()

  context.fillStyle = '#627174'
  context.font = '12px system-ui, sans-serif'
  context.fillText('L', centerX - radius - 10, centerY + 4)
  context.fillText('R', centerX + radius + 4, centerY + 4)

  if (!isPlaying || leftData.length === 0 || rightData.length === 0) {
    context.fillStyle = 'rgba(40, 127, 143, 0.16)'
    context.beginPath()
    context.arc(centerX, centerY, 8, 0, Math.PI * 2)
    context.fill()
    context.restore()
    return
  }

  context.strokeStyle = 'rgba(40, 127, 143, 0.78)'
  context.lineWidth = 1.8
  context.beginPath()
  const sampleStep = Math.max(1, Math.floor(leftData.length / 180))

  for (let index = 0; index < leftData.length; index += sampleStep) {
    const point = calculateStereoFieldPoint(
      leftData[index],
      rightData[index] ?? 128,
      centerX,
      centerY,
      radius,
    )

    if (index === 0) {
      context.moveTo(point.x, point.y)
    } else {
      context.lineTo(point.x, point.y)
    }
  }
  context.stroke()
  context.restore()
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath()
  context.roundRect(x, y, width, height, radius)
  context.fill()
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value))
}

function formatPan(value: number) {
  if (Math.abs(value) < 0.01) {
    return 'Center'
  }

  return `${Math.round(Math.abs(value) * 100)}% ${value < 0 ? 'L' : 'R'}`
}

function formatModulationMode(mode: ModulationMode) {
  if (mode === 'off') {
    return 'Off'
  }

  return mode === 'chirp' ? 'Chirp' : 'Tremolo'
}

function formatTonePartials(waveform: Waveform, frequencyHz: number) {
  const partials = getAudibleTonePartials(waveform, frequencyHz)

  if (waveform === 'sine') {
    return 'Fundamental only'
  }

  if (partials === 1) {
    return 'Fundamental only at this frequency'
  }

  return `${partials} audible partials`
}

export default App
