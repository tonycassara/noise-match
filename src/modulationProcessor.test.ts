import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

type ProcessorInstance = {
  process: (
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ) => boolean
}
type ProcessorConstructor = new () => ProcessorInstance

describe('modulation processor', () => {
  it('applies tremolo gain changes to incoming audio', () => {
    let ProcessorClass: ProcessorConstructor | undefined
    const source = readFileSync(
      new URL('../public/modulation-processor.js', import.meta.url),
      'utf8',
    )
    const sandbox = {
      AudioWorkletProcessor: class {},
      sampleRate: 48000,
      registerProcessor: (_name: string, processor: ProcessorConstructor) => {
        ProcessorClass = processor
      },
    }

    vm.runInNewContext(source, sandbox)
    assert.ok(ProcessorClass)

    const processor = new ProcessorClass()
    const input = [new Float32Array(128).fill(1)]
    const output = [new Float32Array(128)]

    processor.process([[input[0]]], [[output[0]]], {
      mode: new Float32Array([1]),
      rateHz: new Float32Array([12]),
      depth: new Float32Array([1]),
      chirpRateHz: new Float32Array([5]),
      chirpDuty: new Float32Array([0.34]),
      attack: new Float32Array([0.025]),
    })

    assert.notEqual(output[0][0], output[0][127])
    assert.ok(output[0].some((sample) => sample < 0.99))
  })
})
