import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { calculateStereoFieldPoint } from './visualizerMath.ts'

describe('visualizer math', () => {
  it('places centered mono energy on the vertical center line', () => {
    const point = calculateStereoFieldPoint(255, 255, 100, 80, 50)

    assert.equal(point.x, 100)
    assert.ok(point.y < 80)
  })

  it('moves left-heavy energy to the left side of the scope', () => {
    const point = calculateStereoFieldPoint(255, 128, 100, 80, 50)

    assert.ok(point.x < 100)
  })

  it('moves right-heavy energy to the right side of the scope', () => {
    const point = calculateStereoFieldPoint(128, 255, 100, 80, 50)

    assert.ok(point.x > 100)
  })
})
