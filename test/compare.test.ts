import { describe, expect, it } from 'vitest';
import { calculateBoundaryDiffPercentage, classifySeverity, compareImageData, createHeatmapImageData, estimateRegionShift, findConnectedRegions } from '../src/lib/compare';

function imageData(width: number, height: number, fill: [number, number, number, number]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
    data[i + 3] = fill[3];
  }
  return { width, height, data, colorSpace: 'srgb' } as ImageData;
}

function setPixel(image: ImageData, x: number, y: number, color: [number, number, number, number]) {
  const index = (y * image.width + x) * 4;
  image.data[index] = color[0];
  image.data[index + 1] = color[1];
  image.data[index + 2] = color[2];
  image.data[index + 3] = color[3];
}

function fillRect(image: ImageData, x: number, y: number, width: number, height: number, color: [number, number, number, number]) {
  for (let row = y; row < y + height; row += 1) {
    for (let col = x; col < x + width; col += 1) {
      setPixel(image, col, row, color);
    }
  }
}

describe('compare engine', () => {
  it('считает процент отличий по смещению границ, а не по площади', () => {
    const design = imageData(120, 80, [255, 255, 255, 255]);
    const implementationSmallShift = imageData(120, 80, [255, 255, 255, 255]);
    const implementationLargeShift = imageData(120, 80, [255, 255, 255, 255]);

    fillRect(design, 20, 20, 40, 20, [20, 90, 180, 255]);
    fillRect(implementationSmallShift, 21, 20, 40, 20, [20, 90, 180, 255]);
    fillRect(implementationLargeShift, 30, 20, 40, 20, [20, 90, 180, 255]);

    const smallShiftPercentage = calculateBoundaryDiffPercentage(design, implementationSmallShift, 20);
    const largeShiftPercentage = calculateBoundaryDiffPercentage(design, implementationLargeShift, 20);
    const smallShiftResult = compareImageData(design, implementationSmallShift, { threshold: 20, minArea: 1 }, {
      designMeta: { name: 'design', width: 120, height: 80 },
      implementationMeta: { name: 'small-shift', width: 120, height: 80 },
      originalSizeMismatch: false,
      heatmapUrl: 'data:image/png;base64,test'
    });

    expect(smallShiftPercentage).toBeGreaterThan(0);
    expect(smallShiftPercentage).toBeLessThan(10);
    expect(100 - smallShiftPercentage).toBeGreaterThan(90);
    expect(smallShiftResult.diffPercentage).toBeLessThan(10);
    expect(100 - smallShiftResult.diffPercentage).toBeGreaterThan(90);
    expect(largeShiftPercentage).toBeGreaterThan(smallShiftPercentage * 4);
  });

  it('не даёт высокий процент попадания для разных плотных layout', () => {
    const design = imageData(160, 160, [255, 255, 255, 255]);
    const implementation = imageData(160, 160, [255, 255, 255, 255]);

    for (let x = 6; x < 150; x += 20) {
      fillRect(design, x, 8, 8, 144, [20, 90, 180, 255]);
    }

    for (let y = 6; y < 150; y += 20) {
      fillRect(implementation, 8, y, 144, 8, [20, 90, 180, 255]);
    }

    const result = compareImageData(design, implementation, { threshold: 20, minArea: 1 }, {
      designMeta: { name: 'vertical-layout', width: 160, height: 160 },
      implementationMeta: { name: 'horizontal-layout', width: 160, height: 160 },
      originalSizeMismatch: false,
      heatmapUrl: 'data:image/png;base64,test'
    });

    expect(result.diffPercentage).toBeGreaterThan(50);
    expect(100 - result.diffPercentage).toBeLessThan(50);
  });

  it('учитывает смену цвета даже при совпавших границах', () => {
    const design = imageData(100, 80, [255, 255, 255, 255]);
    const implementation = imageData(100, 80, [255, 255, 255, 255]);

    fillRect(design, 20, 20, 40, 20, [20, 90, 180, 255]);
    fillRect(implementation, 20, 20, 40, 20, [180, 40, 40, 255]);

    const result = compareImageData(design, implementation, { threshold: 20, minArea: 1 }, {
      designMeta: { name: 'blue-card', width: 100, height: 80 },
      implementationMeta: { name: 'red-card', width: 100, height: 80 },
      originalSizeMismatch: false,
      heatmapUrl: 'data:image/png;base64,test'
    });

    expect(calculateBoundaryDiffPercentage(design, implementation)).toBe(0);
    expect(result.diffPercentage).toBeCloseTo(33.33, 1);
    expect(Number.isFinite(result.diffPercentage)).toBe(true);
  });

  it('применяет пользовательский threshold к итоговому проценту границ', () => {
    const design = imageData(80, 60, [255, 255, 255, 255]);
    const implementation = imageData(80, 60, [255, 255, 255, 255]);

    fillRect(design, 16, 14, 30, 18, [245, 245, 245, 255]);
    fillRect(implementation, 20, 14, 30, 18, [245, 245, 245, 255]);

    const strictResult = compareImageData(design, implementation, { threshold: 5, minArea: 1 }, {
      designMeta: { name: 'strict-design', width: 80, height: 60 },
      implementationMeta: { name: 'strict-implementation', width: 80, height: 60 },
      originalSizeMismatch: false,
      heatmapUrl: 'data:image/png;base64,test'
    });
    const lenientResult = compareImageData(design, implementation, { threshold: 20, minArea: 1 }, {
      designMeta: { name: 'lenient-design', width: 80, height: 60 },
      implementationMeta: { name: 'lenient-implementation', width: 80, height: 60 },
      originalSizeMismatch: false,
      heatmapUrl: 'data:image/png;base64,test'
    });

    expect(strictResult.diffPercentage).toBeGreaterThan(0);
    expect(lenientResult.diffPercentage).toBe(0);
  });

  it('считает пустой экран против непустого как серьёзное отличие', () => {
    const design = imageData(100, 80, [255, 255, 255, 255]);
    const implementation = imageData(100, 80, [255, 255, 255, 255]);

    fillRect(implementation, 10, 10, 80, 55, [20, 90, 180, 255]);

    const result = compareImageData(design, implementation, { threshold: 20, minArea: 1 }, {
      designMeta: { name: 'blank', width: 100, height: 80 },
      implementationMeta: { name: 'card', width: 100, height: 80 },
      originalSizeMismatch: false,
      heatmapUrl: 'data:image/png;base64,test'
    });

    expect(result.diffPercentage).toBeGreaterThan(50);
    expect(Number.isFinite(result.diffPercentage)).toBe(true);
  });

  it('не превращает крошечный шум в полный провал', () => {
    const design = imageData(100, 100, [255, 255, 255, 255]);
    const implementation = imageData(100, 100, [255, 255, 255, 255]);

    fillRect(implementation, 50, 50, 1, 1, [20, 20, 20, 255]);

    const result = compareImageData(design, implementation, { threshold: 20, minArea: 1 }, {
      designMeta: { name: 'clean', width: 100, height: 100 },
      implementationMeta: { name: 'tiny-noise', width: 100, height: 100 },
      originalSizeMismatch: false,
      heatmapUrl: 'data:image/png;base64,test'
    });

    expect(result.diffPercentage).toBeLessThan(1);
    expect(100 - result.diffPercentage).toBeGreaterThan(99);
  });

  it('оставляет процент попадания нулевым при совпавших границах', () => {
    const design = imageData(40, 30, [255, 255, 255, 255]);
    const implementation = imageData(40, 30, [255, 255, 255, 255]);

    fillRect(design, 8, 6, 16, 10, [20, 90, 180, 255]);
    fillRect(implementation, 8, 6, 16, 10, [20, 90, 180, 255]);

    const result = compareImageData(design, implementation, { threshold: 20, minArea: 1 }, {
      designMeta: { name: 'design', width: 40, height: 30 },
      implementationMeta: { name: 'implementation', width: 40, height: 30 },
      originalSizeMismatch: false,
      heatmapUrl: 'data:image/png;base64,test'
    });

    expect(result.diffPercentage).toBe(0);
    expect(100 - result.diffPercentage).toBe(100);
  });

  it('находит область отличий и считает пиксели', () => {
    const design = imageData(8, 8, [255, 255, 255, 255]);
    const implementation = imageData(8, 8, [255, 255, 255, 255]);

    setPixel(implementation, 2, 2, [0, 0, 0, 255]);
    setPixel(implementation, 2, 3, [0, 0, 0, 255]);
    setPixel(implementation, 3, 2, [0, 0, 0, 255]);
    setPixel(implementation, 3, 3, [0, 0, 0, 255]);

    const result = compareImageData(design, implementation, { threshold: 20, minArea: 1 }, {
      designMeta: { name: 'design', width: 8, height: 8 },
      implementationMeta: { name: 'implementation', width: 8, height: 8 },
      originalSizeMismatch: false,
      heatmapUrl: 'data:image/png;base64,test'
    });

    expect(result.diffPixelCount).toBe(4);
    expect(result.regions).toHaveLength(1);
    expect(result.regions[0]).toMatchObject({ x: 2, y: 2, width: 2, height: 2, area: 4 });
  });

  it('фильтрует шум через minArea', () => {
    const mask = new Uint8Array(16);
    const deltas = new Float32Array(16);
    mask[0] = 1;
    deltas[0] = 100;
    mask[10] = 1;
    mask[11] = 1;
    deltas[10] = 120;
    deltas[11] = 120;

    const regions = findConnectedRegions(mask, deltas, 4, 4, 2);
    expect(regions).toHaveLength(1);
    expect(regions[0].area).toBe(2);
  });

  it('классифицирует серьёзность по площади и дельте', () => {
    expect(classifySeverity(10, 20, 1_000_000)).toBe('low');
    expect(classifySeverity(6_000, 80, 1_000_000)).toBe('medium');
    expect(classifySeverity(40_000, 140, 1_000_000)).toBe('high');
  });

  it('оценивает направление смещения области', () => {
    const design = imageData(48, 40, [255, 255, 255, 255]);
    const implementation = imageData(48, 40, [255, 255, 255, 255]);

    fillRect(design, 12, 10, 14, 10, [24, 88, 180, 255]);
    fillRect(implementation, 17, 13, 14, 10, [24, 88, 180, 255]);

    const shift = estimateRegionShift(
      design,
      implementation,
      { x: 12, y: 10, width: 19, height: 13, area: 320, averageDelta: 110, maxDelta: 220 },
      8
    );

    expect(shift).toMatchObject({ dx: 5, dy: 3, direction: 'down-right' });
    expect(shift?.confidence).toBeGreaterThan(0.4);
  });

  it('строит тепловую карту как прозрачный красный слой поверх макета', () => {
    const design = imageData(3, 1, [100, 110, 120, 255]);
    const implementation = imageData(3, 1, [100, 110, 120, 255]);
    setPixel(implementation, 1, 0, [80, 100, 110, 200]);
    setPixel(implementation, 2, 0, [10, 20, 30, 180]);

    const heatmap = createHeatmapImageData(design, implementation, 20);

    expect(Array.from(heatmap.data.slice(0, 4))).toEqual([0, 0, 0, 0]);
    expect(heatmap.data[4]).toBeGreaterThan(80);
    expect(heatmap.data[5]).toBeLessThan(100);
    expect(heatmap.data[6]).toBeLessThan(110);
    expect(heatmap.data[7]).toBe(200);
    expect(heatmap.data[8]).toBeGreaterThan(heatmap.data[4]);
    expect(heatmap.data[9]).toBeLessThan(heatmap.data[5]);
    expect(heatmap.data[10]).toBeLessThan(heatmap.data[6]);
    expect(heatmap.data[11]).toBe(180);
  });

  it('не красит старую позицию смещённого объекта в тепловой карте', () => {
    const design = imageData(16, 8, [255, 255, 255, 255]);
    const implementation = imageData(16, 8, [255, 255, 255, 255]);
    fillRect(design, 2, 2, 4, 3, [20, 90, 180, 255]);
    fillRect(implementation, 9, 2, 4, 3, [20, 90, 180, 220]);

    const heatmap = createHeatmapImageData(design, implementation, 20);
    const oldPositionIndex = (3 * heatmap.width + 3) * 4;
    const newPositionIndex = (3 * heatmap.width + 10) * 4;

    expect(Array.from(heatmap.data.slice(oldPositionIndex, oldPositionIndex + 4))).toEqual([0, 0, 0, 0]);
    expect(heatmap.data[newPositionIndex]).toBeGreaterThan(200);
    expect(heatmap.data[newPositionIndex + 1]).toBeLessThan(90);
    expect(heatmap.data[newPositionIndex + 2]).toBeLessThan(180);
    expect(heatmap.data[newPositionIndex + 3]).toBe(220);
  });

  it('оставляет старую позицию прозрачной на контрастном фоне', () => {
    const design = imageData(18, 10, [235, 235, 235, 255]);
    const implementation = imageData(18, 10, [235, 235, 235, 255]);

    for (let y = 0; y < 10; y += 1) {
      for (let x = 0; x < 18; x += 1) {
        const value = 210 + ((x + y) % 2) * 30;
        setPixel(design, x, y, [value, value, value, 255]);
        setPixel(implementation, x, y, [value, value, value, 255]);
      }
    }

    fillRect(design, 3, 3, 4, 3, [20, 90, 180, 255]);
    fillRect(implementation, 11, 3, 4, 3, [20, 90, 180, 255]);

    const heatmap = createHeatmapImageData(design, implementation, 20);
    const oldPositionIndex = (4 * heatmap.width + 4) * 4;
    const newPositionIndex = (4 * heatmap.width + 12) * 4;

    expect(Array.from(heatmap.data.slice(oldPositionIndex, oldPositionIndex + 4))).toEqual([0, 0, 0, 0]);
    expect(heatmap.data[newPositionIndex]).toBeGreaterThan(200);
    expect(heatmap.data[newPositionIndex + 1]).toBeLessThan(90);
    expect(heatmap.data[newPositionIndex + 2]).toBeLessThan(180);
    expect(heatmap.data[newPositionIndex + 3]).toBe(255);
  });
});
