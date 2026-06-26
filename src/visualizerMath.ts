export type StereoFieldPoint = {
  x: number
  y: number
}

export function calculateStereoFieldPoint(
  leftSample: number,
  rightSample: number,
  centerX: number,
  centerY: number,
  radius: number,
): StereoFieldPoint {
  const left = (leftSample - 128) / 128
  const right = (rightSample - 128) / 128
  const side = (right - left) / 2
  const mid = (left + right) / 2

  return {
    x: centerX + side * radius,
    y: centerY - mid * radius,
  }
}
