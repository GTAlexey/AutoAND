export type Severity = 'low' | 'medium' | 'high';
export type MismatchType = 'visual difference' | 'size mismatch' | 'missing area' | 'shifted area';
export type ShiftDirection =
  | 'none'
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'up-left'
  | 'up-right'
  | 'down-left'
  | 'down-right';

export interface CompareSettings {
  threshold: number;
  minArea: number;
}

export interface ImageSourceMeta {
  name: string;
  width: number;
  height: number;
}

export interface ShiftEstimate {
  dx: number;
  dy: number;
  distance: number;
  direction: ShiftDirection;
  confidence: number;
  baselineDelta: number;
  alignedDelta: number;
}

export interface DiffRegion {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
  averageDelta: number;
  maxDelta: number;
  severity: Severity;
  type: MismatchType;
  shift?: ShiftEstimate;
}

export interface ComparisonResult {
  width: number;
  height: number;
  diffPixelCount: number;
  diffPercentage: number;
  originalSizeMismatch: boolean;
  designMeta: ImageSourceMeta;
  implementationMeta: ImageSourceMeta;
  regions: DiffRegion[];
  severityCounts: Record<Severity, number>;
  heatmapUrl: string;
  generatedAt: string;
}

export interface RawRegion extends Omit<DiffRegion, 'id' | 'severity' | 'type' | 'shift'> {}

const NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
] as const;

const SHIFT_SEARCH_RADIUS = 32;
const SHIFT_SAMPLE_LIMIT = 360;
const MIN_SHIFT_IMPROVEMENT = 0.08;
const REGION_CONTRAST_MARGIN = 10;
const BOUNDARY_DETECTION_THRESHOLD = 12;
const BOUNDARY_FULL_MISS_DISTANCE = 16;
const BOUNDARY_MATCH_TOLERANCE = 2;
const BOUNDARY_AREA_WEIGHT = 3;
const PIXEL_FULL_MISMATCH_RATIO = 0.3;

interface BoundaryMask {
  mask: Uint8Array;
  count: number;
}

interface BoundaryDistanceMap {
  distances: Float32Array;
  maxDistance: number;
}

interface BoundaryMissStats {
  averageDistance: number;
  unmatchedCount: number;
}

interface AverageColor {
  r: number;
  g: number;
  b: number;
  a: number;
  count: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function rounded(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function shiftDirection(dx: number, dy: number): ShiftDirection {
  const horizontal = Math.abs(dx) >= 2 ? (dx > 0 ? 'right' : 'left') : '';
  const vertical = Math.abs(dy) >= 2 ? (dy > 0 ? 'down' : 'up') : '';

  if (vertical && horizontal) return `${vertical}-${horizontal}` as ShiftDirection;
  if (horizontal) return horizontal as ShiftDirection;
  if (vertical) return vertical as ShiftDirection;
  return 'none';
}

function dataIndex(width: number, x: number, y: number): number {
  return (y * width + x) * 4;
}

function sampleRegionPixels(region: RawRegion, width: number): number[] {
  const step = Math.max(1, Math.ceil(Math.sqrt(region.area / SHIFT_SAMPLE_LIMIT)));
  const pixels: number[] = [];

  for (let y = region.y; y < region.y + region.height; y += step) {
    for (let x = region.x; x < region.x + region.width; x += step) {
      pixels.push(y * width + x);
    }
  }

  return pixels;
}

function averageForwardShiftDelta(
  designData: Uint8ClampedArray,
  implementationData: Uint8ClampedArray,
  pixels: number[],
  width: number,
  height: number,
  dx: number,
  dy: number
): number {
  let total = 0;
  let count = 0;

  for (const pixel of pixels) {
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const shiftedX = x + dx;
    const shiftedY = y + dy;

    if (shiftedX < 0 || shiftedX >= width || shiftedY < 0 || shiftedY >= height) continue;

    total += colorDeltaBetween(designData, pixel * 4, implementationData, (shiftedY * width + shiftedX) * 4);
    count += 1;
  }

  return count ? total / count : Number.POSITIVE_INFINITY;
}

function averageReverseShiftDelta(
  designData: Uint8ClampedArray,
  implementationData: Uint8ClampedArray,
  pixels: number[],
  width: number,
  height: number,
  dx: number,
  dy: number
): number {
  let total = 0;
  let count = 0;

  for (const pixel of pixels) {
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const shiftedX = x - dx;
    const shiftedY = y - dy;

    if (shiftedX < 0 || shiftedX >= width || shiftedY < 0 || shiftedY >= height) continue;

    total += colorDeltaBetween(implementationData, pixel * 4, designData, (shiftedY * width + shiftedX) * 4);
    count += 1;
  }

  return count ? total / count : Number.POSITIVE_INFINITY;
}

function averageShiftDelta(
  designData: Uint8ClampedArray,
  implementationData: Uint8ClampedArray,
  pixels: number[],
  width: number,
  height: number,
  dx: number,
  dy: number
) {
  const forward = averageForwardShiftDelta(designData, implementationData, pixels, width, height, dx, dy);
  const reverse = averageReverseShiftDelta(designData, implementationData, pixels, width, height, dx, dy);
  const combined = Number.isFinite(forward) && Number.isFinite(reverse) ? (forward + reverse) / 2 : Number.POSITIVE_INFINITY;

  return { forward, reverse, combined };
}

function buildBoundaryMask(image: ImageData, threshold = BOUNDARY_DETECTION_THRESHOLD): BoundaryMask {
  const { width, height, data } = image;
  const mask = new Uint8Array(width * height);
  let count = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = dataIndex(width, x, y);
      let isBoundary = false;

      if (x + 1 < width) {
        isBoundary = colorDeltaBetween(data, index, data, dataIndex(width, x + 1, y)) >= threshold;
      }

      if (!isBoundary && y + 1 < height) {
        isBoundary = colorDeltaBetween(data, index, data, dataIndex(width, x, y + 1)) >= threshold;
      }

      if (!isBoundary && x > 0) {
        isBoundary = colorDeltaBetween(data, index, data, dataIndex(width, x - 1, y)) >= threshold;
      }

      if (!isBoundary && y > 0) {
        isBoundary = colorDeltaBetween(data, index, data, dataIndex(width, x, y - 1)) >= threshold;
      }

      if (isBoundary) {
        mask[y * width + x] = 1;
        count += 1;
      }
    }
  }

  return { mask, count };
}

function buildBoundaryDistanceMap(targetMask: BoundaryMask, width: number, height: number, maxDistance: number): BoundaryDistanceMap {
  const totalPixels = width * height;
  const distances = new Float32Array(totalPixels);
  distances.fill(maxDistance);

  if (!targetMask.count) {
    return { distances, maxDistance };
  }

  for (let pixel = 0; pixel < targetMask.mask.length; pixel += 1) {
    if (targetMask.mask[pixel]) distances[pixel] = 0;
  }

  for (let y = 0; y < height; y += 1) {
    const row = y * width;

    for (let x = 0; x < width; x += 1) {
      const index = row + x;
      let best = distances[index];

      if (x > 0) best = Math.min(best, distances[index - 1] + 1);
      if (y > 0) {
        const up = index - width;
        best = Math.min(best, distances[up] + 1);
        if (x > 0) best = Math.min(best, distances[up - 1] + Math.SQRT2);
        if (x + 1 < width) best = Math.min(best, distances[up + 1] + Math.SQRT2);
      }

      distances[index] = Math.min(best, maxDistance);
    }
  }

  for (let y = height - 1; y >= 0; y -= 1) {
    const row = y * width;

    for (let x = width - 1; x >= 0; x -= 1) {
      const index = row + x;
      let best = distances[index];

      if (x + 1 < width) best = Math.min(best, distances[index + 1] + 1);
      if (y + 1 < height) {
        const down = index + width;
        best = Math.min(best, distances[down] + 1);
        if (x > 0) best = Math.min(best, distances[down - 1] + Math.SQRT2);
        if (x + 1 < width) best = Math.min(best, distances[down + 1] + Math.SQRT2);
      }

      distances[index] = Math.min(best, maxDistance);
    }
  }

  return { distances, maxDistance };
}

function getBoundaryMissStats(sourceMask: BoundaryMask, targetDistanceMap: BoundaryDistanceMap): BoundaryMissStats {
  if (!sourceMask.count) {
    return { averageDistance: 0, unmatchedCount: 0 };
  }

  let totalDistance = 0;
  let unmatchedCount = 0;

  for (let pixel = 0; pixel < sourceMask.mask.length; pixel += 1) {
    if (!sourceMask.mask[pixel]) continue;

    const distance = targetDistanceMap.distances[pixel] ?? targetDistanceMap.maxDistance;
    totalDistance += distance;

    if (distance > BOUNDARY_MATCH_TOLERANCE) {
      unmatchedCount += 1;
    }
  }

  return {
    averageDistance: totalDistance / sourceMask.count,
    unmatchedCount
  };
}

export function calculateBoundaryDiffPercentage(design: ImageData, implementation: ImageData, threshold = BOUNDARY_DETECTION_THRESHOLD): number {
  if (design.width !== implementation.width || design.height !== implementation.height) {
    throw new Error('ImageData must have equal dimensions before boundary comparison');
  }

  const width = design.width;
  const height = design.height;
  const totalPixels = width * height;
  const designBoundary = buildBoundaryMask(design, threshold);
  const implementationBoundary = buildBoundaryMask(implementation, threshold);
  const totalBoundaryPixels = designBoundary.count + implementationBoundary.count;

  if (!totalBoundaryPixels || !totalPixels) return 0;

  const designDistanceMap = buildBoundaryDistanceMap(designBoundary, width, height, BOUNDARY_FULL_MISS_DISTANCE);
  const implementationDistanceMap = buildBoundaryDistanceMap(implementationBoundary, width, height, BOUNDARY_FULL_MISS_DISTANCE);
  const designMissStats = getBoundaryMissStats(designBoundary, implementationDistanceMap);
  const implementationMissStats = getBoundaryMissStats(implementationBoundary, designDistanceMap);
  const weightedMissDistance =
    (designMissStats.averageDistance * designBoundary.count + implementationMissStats.averageDistance * implementationBoundary.count) / totalBoundaryPixels;
  const distanceMissRatio = clamp(weightedMissDistance / BOUNDARY_FULL_MISS_DISTANCE, 0, 1);
  const coverageMissRatio = clamp((designMissStats.unmatchedCount + implementationMissStats.unmatchedCount) / totalBoundaryPixels, 0, 1);
  const boundaryAreaRatio = clamp((totalBoundaryPixels / totalPixels) * BOUNDARY_AREA_WEIGHT, 0, 1);
  const missRatio = Math.max(distanceMissRatio, coverageMissRatio) * boundaryAreaRatio;

  return Math.round(missRatio * 10000) / 100;
}

function calculatePixelDiffPercentage(diffPixelCount: number, totalPixels: number): number {
  if (!totalPixels) return 0;

  const diffRatio = diffPixelCount / totalPixels;
  return rounded(clamp(diffRatio / PIXEL_FULL_MISMATCH_RATIO, 0, 1) * 100, 2);
}

export function estimateRegionShift(
  design: ImageData,
  implementation: ImageData,
  region: RawRegion,
  searchRadius = SHIFT_SEARCH_RADIUS
): ShiftEstimate | undefined {
  const width = design.width;
  const height = design.height;
  const paddedRegion: RawRegion = {
    ...region,
    x: clamp(region.x - 2, 0, width - 1),
    y: clamp(region.y - 2, 0, height - 1),
    width: Math.min(region.width + 4, width - clamp(region.x - 2, 0, width - 1)),
    height: Math.min(region.height + 4, height - clamp(region.y - 2, 0, height - 1))
  };
  const pixels = sampleRegionPixels(paddedRegion, width);

  if (!pixels.length) return undefined;

  const baseline = averageShiftDelta(design.data, implementation.data, pixels, width, height, 0, 0);
  let best = { dx: 0, dy: 0, ...baseline };

  for (let dy = -searchRadius; dy <= searchRadius; dy += 1) {
    for (let dx = -searchRadius; dx <= searchRadius; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const distance = Math.hypot(dx, dy);
      if (distance > searchRadius) continue;

      const delta = averageShiftDelta(design.data, implementation.data, pixels, width, height, dx, dy);
      const meaningfulTieBreak =
        delta.combined < best.combined - 0.4 || (Math.abs(delta.combined - best.combined) < 0.4 && distance < Math.hypot(best.dx, best.dy));

      if (meaningfulTieBreak) {
        best = { dx, dy, ...delta };
      }
    }
  }

  const improvement = baseline.combined > 0 ? (baseline.combined - best.combined) / baseline.combined : 0;
  const forwardImprovement = baseline.forward > 0 ? (baseline.forward - best.forward) / baseline.forward : 0;
  const reverseImprovement = baseline.reverse > 0 ? (baseline.reverse - best.reverse) / baseline.reverse : 0;
  const distance = Math.hypot(best.dx, best.dy);

  if (
    distance < 2 ||
    improvement < MIN_SHIFT_IMPROVEMENT ||
    forwardImprovement < MIN_SHIFT_IMPROVEMENT ||
    reverseImprovement < MIN_SHIFT_IMPROVEMENT
  ) {
    return undefined;
  }

  return {
    dx: best.dx,
    dy: best.dy,
    distance: rounded(distance),
    direction: shiftDirection(best.dx, best.dy),
    confidence: rounded(clamp(improvement, 0, 1), 2),
    baselineDelta: rounded(baseline.combined),
    alignedDelta: rounded(best.combined)
  };
}

function colorDeltaBetween(dataA: Uint8ClampedArray, indexA: number, dataB: Uint8ClampedArray, indexB: number): number {
  const r = dataA[indexA] - dataB[indexB];
  const g = dataA[indexA + 1] - dataB[indexB + 1];
  const b = dataA[indexA + 2] - dataB[indexB + 2];
  const a = (dataA[indexA + 3] - dataB[indexB + 3]) * 0.35;
  return Math.sqrt(r * r + g * g + b * b + a * a);
}

function colorDeltaFromAverage(data: Uint8ClampedArray, index: number, average: AverageColor): number {
  const r = data[index] - average.r;
  const g = data[index + 1] - average.g;
  const b = data[index + 2] - average.b;
  const a = (data[index + 3] - average.a) * 0.35;
  return Math.sqrt(r * r + g * g + b * b + a * a);
}

export function colorDeltaAt(dataA: Uint8ClampedArray, dataB: Uint8ClampedArray, index: number): number {
  return colorDeltaBetween(dataA, index, dataB, index);
}

export function classifySeverity(area: number, averageDelta: number, totalPixels: number): Severity {
  const areaRatio = area / Math.max(totalPixels, 1);
  const score = areaRatio * 1000 + averageDelta / 22;

  if (area > 24000 || areaRatio > 0.025 || averageDelta > 132 || score > 16) {
    return 'high';
  }

  if (area > 3500 || areaRatio > 0.006 || averageDelta > 76 || score > 5) {
    return 'medium';
  }

  return 'low';
}

export function classifyType(region: RawRegion, width: number, height: number): MismatchType {
  const regionRatio = region.area / Math.max(width * height, 1);
  const boxFill = region.area / Math.max(region.width * region.height, 1);

  if (regionRatio > 0.035 && boxFill > 0.58) {
    return 'missing area';
  }

  if (region.width > width * 0.22 || region.height > height * 0.14) {
    return 'shifted area';
  }

  if (boxFill > 0.72 && region.averageDelta > 90) {
    return 'missing area';
  }

  return 'visual difference';
}

export function findConnectedRegions(
  diffMask: Uint8Array,
  deltaMap: Float32Array,
  width: number,
  height: number,
  minArea: number
): RawRegion[] {
  const visited = new Uint8Array(width * height);
  const regions: RawRegion[] = [];
  const queue = new Int32Array(width * height);

  for (let start = 0; start < diffMask.length; start += 1) {
    if (!diffMask[start] || visited[start]) continue;

    let head = 0;
    let tail = 0;
    queue[tail] = start;
    tail += 1;
    visited[start] = 1;

    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let area = 0;
    let deltaSum = 0;
    let maxDelta = 0;

    while (head < tail) {
      const current = queue[head];
      head += 1;

      const x = current % width;
      const y = Math.floor(current / width);
      const delta = deltaMap[current];

      area += 1;
      deltaSum += delta;
      if (delta > maxDelta) maxDelta = delta;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      for (const [dx, dy] of NEIGHBORS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

        const ni = ny * width + nx;
        if (!diffMask[ni] || visited[ni]) continue;

        visited[ni] = 1;
        queue[tail] = ni;
        tail += 1;
      }
    }

    if (area >= minArea) {
      regions.push({
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        area,
        averageDelta: deltaSum / area,
        maxDelta
      });
    }
  }

  return regions.sort((a, b) => b.area - a.area);
}

function averageColorOutsideRegion(image: ImageData, region: RawRegion, margin: number): AverageColor {
  const xStart = clamp(region.x - margin, 0, image.width);
  const yStart = clamp(region.y - margin, 0, image.height);
  const xEnd = clamp(region.x + region.width + margin, 0, image.width);
  const yEnd = clamp(region.y + region.height + margin, 0, image.height);
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  let count = 0;

  for (let y = yStart; y < yEnd; y += 1) {
    for (let x = xStart; x < xEnd; x += 1) {
      if (x >= region.x && x < region.x + region.width && y >= region.y && y < region.y + region.height) continue;

      const index = dataIndex(image.width, x, y);
      r += image.data[index];
      g += image.data[index + 1];
      b += image.data[index + 2];
      a += image.data[index + 3];
      count += 1;
    }
  }

  if (!count) {
    return { r: 255, g: 255, b: 255, a: 255, count: 0 };
  }

  return { r: r / count, g: g / count, b: b / count, a: a / count, count };
}

function getImplementationRegionMask(design: ImageData, implementation: ImageData, threshold: number) {
  const width = design.width;
  const height = design.height;
  const totalPixels = width * height;
  const diffMask = new Uint8Array(totalPixels);
  const deltaMap = new Float32Array(totalPixels);

  for (let pixel = 0; pixel < totalPixels; pixel += 1) {
    const index = pixel * 4;
    const delta = colorDeltaAt(design.data, implementation.data, index);
    deltaMap[pixel] = delta;
    if (delta >= threshold) diffMask[pixel] = 1;
  }

  const rawRegions = findConnectedRegions(diffMask, deltaMap, width, height, 1);
  const implementationMask = new Uint8Array(totalPixels);

  for (const region of rawRegions) {
    const shift = estimateRegionShift(design, implementation, region);
    const markIfImplementationSide = (pixel: number, designBackground: AverageColor, implementationBackground: AverageColor) => {
      if (!diffMask[pixel]) return;

      const index = pixel * 4;
      const designContrast = colorDeltaFromAverage(design.data, index, designBackground);
      const implementationContrast = colorDeltaFromAverage(implementation.data, index, implementationBackground);

      if (implementationContrast + REGION_CONTRAST_MARGIN >= designContrast) {
        implementationMask[pixel] = 1;
      }
    };

    const designBackground = averageColorOutsideRegion(design, region, 3);
    const implementationBackground = averageColorOutsideRegion(implementation, region, 3);

    for (let y = region.y; y < region.y + region.height; y += 1) {
      for (let x = region.x; x < region.x + region.width; x += 1) {
        markIfImplementationSide(y * width + x, designBackground, implementationBackground);
      }
    }

    if (!shift) continue;

    const fromX = clamp(region.x + shift.dx, 0, width);
    const fromY = clamp(region.y + shift.dy, 0, height);
    const toX = clamp(region.x + region.width + shift.dx, 0, width);
    const toY = clamp(region.y + region.height + shift.dy, 0, height);

    if (toX <= fromX || toY <= fromY) continue;

    const shiftedRegion: RawRegion = {
      ...region,
      x: fromX,
      y: fromY,
      width: toX - fromX,
      height: toY - fromY
    };
    const shiftedDesignBackground = averageColorOutsideRegion(design, shiftedRegion, 3);
    const shiftedImplementationBackground = averageColorOutsideRegion(implementation, shiftedRegion, 3);

    for (let y = region.y; y < region.y + region.height; y += 1) {
      for (let x = region.x; x < region.x + region.width; x += 1) {
        const sourcePixel = y * width + x;
        if (!diffMask[sourcePixel]) continue;

        const shiftedX = x + shift.dx;
        const shiftedY = y + shift.dy;
        if (shiftedX < 0 || shiftedX >= width || shiftedY < 0 || shiftedY >= height) continue;

        markIfImplementationSide(shiftedY * width + shiftedX, shiftedDesignBackground, shiftedImplementationBackground);
      }
    }
  }

  return implementationMask;
}

export function compareImageData(
  design: ImageData,
  implementation: ImageData,
  settings: CompareSettings,
  meta: {
    designMeta: ImageSourceMeta;
    implementationMeta: ImageSourceMeta;
    originalSizeMismatch: boolean;
    heatmapUrl?: string;
  }
): Omit<ComparisonResult, 'heatmapUrl'> & { heatmapUrl?: string } {
  if (design.width !== implementation.width || design.height !== implementation.height) {
    throw new Error('ImageData must have equal dimensions before comparison');
  }

  const width = design.width;
  const height = design.height;
  const totalPixels = width * height;
  const diffMask = new Uint8Array(totalPixels);
  const deltaMap = new Float32Array(totalPixels);
  let diffPixelCount = 0;

  for (let pixel = 0; pixel < totalPixels; pixel += 1) {
    const dataIndex = pixel * 4;
    const delta = colorDeltaAt(design.data, implementation.data, dataIndex);
    deltaMap[pixel] = delta;

    if (delta >= settings.threshold) {
      diffMask[pixel] = 1;
      diffPixelCount += 1;
    }
  }

  const rawRegions = findConnectedRegions(diffMask, deltaMap, width, height, settings.minArea);
  const regions = rawRegions.map((region, index) => {
    const shift = estimateRegionShift(design, implementation, region);
    const type = shift ? 'shifted area' : classifyType(region, width, height);

    return {
      id: index + 1,
      ...region,
      averageDelta: Math.round(region.averageDelta * 10) / 10,
      maxDelta: Math.round(region.maxDelta * 10) / 10,
      severity: classifySeverity(region.area, region.averageDelta, totalPixels),
      type,
      shift
    };
  });

  const severityCounts: Record<Severity, number> = { low: 0, medium: 0, high: 0 };
  for (const region of regions) {
    severityCounts[region.severity] += 1;
  }

  const boundaryDiffPercentage = calculateBoundaryDiffPercentage(design, implementation, settings.threshold);
  const pixelDiffPercentage = calculatePixelDiffPercentage(diffPixelCount, totalPixels);

  return {
    width,
    height,
    diffPixelCount,
    diffPercentage: Math.max(boundaryDiffPercentage, pixelDiffPercentage),
    originalSizeMismatch: meta.originalSizeMismatch,
    designMeta: meta.designMeta,
    implementationMeta: meta.implementationMeta,
    regions,
    severityCounts,
    heatmapUrl: meta.heatmapUrl,
    generatedAt: new Date().toISOString()
  };
}

export function createHeatmapImageData(
  design: ImageData,
  implementation: ImageData,
  threshold: number
): ImageData {
  if (design.width !== implementation.width || design.height !== implementation.height) {
    throw new Error('ImageData must have equal dimensions before heatmap generation');
  }

  const totalPixels = design.width * design.height;
  const implementationRegionMask = getImplementationRegionMask(design, implementation, threshold);
  const heatmap = typeof ImageData === 'undefined'
    ? ({ width: design.width, height: design.height, data: new Uint8ClampedArray(totalPixels * 4), colorSpace: 'srgb' } as ImageData)
    : new ImageData(design.width, design.height);

  for (let pixel = 0; pixel < totalPixels; pixel += 1) {
    const index = pixel * 4;
    const delta = colorDeltaAt(design.data, implementation.data, index);
    const implementationRed = implementation.data[index];
    const implementationGreen = implementation.data[index + 1];
    const implementationBlue = implementation.data[index + 2];
    const implementationAlpha = implementation.data[index + 3];

    if (delta < threshold || !implementationRegionMask[pixel]) {
      heatmap.data[index] = 0;
      heatmap.data[index + 1] = 0;
      heatmap.data[index + 2] = 0;
      heatmap.data[index + 3] = 0;
      continue;
    }

    const normalized = clamp((delta - threshold) / 210, 0, 1);
    const intensity = Math.sqrt(normalized);
    const tintStrength = 0.35 + intensity * 0.65;
    const channelFade = 1 - tintStrength * 0.92;

    heatmap.data[index] = Math.round(implementationRed + (255 - implementationRed) * tintStrength);
    heatmap.data[index + 1] = Math.round(implementationGreen * channelFade);
    heatmap.data[index + 2] = Math.round(implementationBlue * channelFade);
    heatmap.data[index + 3] = implementationAlpha;
  }

  return heatmap;
}
