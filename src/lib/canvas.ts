import { compareImageData, createHeatmapImageData, type CompareSettings, type ComparisonResult, type ImageSourceMeta } from './compare';

export interface LoadedImage {
  name: string;
  url: string;
  width: number;
  height: number;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Не удалось прочитать изображение'));
      }
    };
    reader.onerror = () => reject(new Error('Не удалось прочитать изображение'));
    reader.readAsDataURL(file);
  });
}

export async function loadFileAsImage(file: File): Promise<LoadedImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Файл должен быть изображением');
  }

  const url = await readFileAsDataUrl(file);
  const image = await imageUrlToImage(url);
  return { name: file.name, url, width: image.naturalWidth, height: image.naturalHeight };
}

export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export async function imageUrlToImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Не удалось загрузить изображение'));
    image.src = url;
  });
}

export async function imageToCanvas(source: LoadedImage): Promise<HTMLCanvasElement> {
  const image = await imageUrlToImage(source.url);
  const canvas = createCanvas(source.width, source.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas 2D недоступен');

  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0);
  return canvas;
}

export function canvasToLoadedImage(canvas: HTMLCanvasElement, name: string): LoadedImage {
  return {
    name,
    width: canvas.width,
    height: canvas.height,
    url: canvas.toDataURL('image/png')
  };
}

export function getSizeMismatchErrorMessage(
  design: Pick<LoadedImage, 'width' | 'height'>,
  implementation: Pick<LoadedImage, 'width' | 'height'>
) {
  return `Размеры скриншотов отличаются: макет ${design.width}×${design.height}px, реализация ${implementation.width}×${implementation.height}px. Загрузите скриншоты одинакового размера. Масштабирование не применяется.`;
}

function getImageData(canvas: HTMLCanvasElement): ImageData {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas 2D недоступен');
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function imageDataToDataUrl(imageData: ImageData): string {
  const canvas = createCanvas(imageData.width, imageData.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D недоступен');

  const canvasImageData = context.createImageData(imageData.width, imageData.height);
  canvasImageData.data.set(imageData.data);
  context.putImageData(canvasImageData, 0, 0);
  return canvas.toDataURL('image/png');
}

export async function runCanvasComparison(
  design: LoadedImage,
  implementation: LoadedImage,
  settings: CompareSettings
): Promise<ComparisonResult> {
  const designCanvas = await imageToCanvas(design);
  const implementationCanvas = await imageToCanvas(implementation);

  const designData = getImageData(designCanvas);
  const implementationData = getImageData(implementationCanvas);

  if (designCanvas.width !== implementationCanvas.width || designCanvas.height !== implementationCanvas.height) {
    throw new Error(getSizeMismatchErrorMessage(designCanvas, implementationCanvas));
  }

  const heatmapData = createHeatmapImageData(designData, implementationData, settings.threshold);

  const designMeta: ImageSourceMeta = { name: design.name, width: design.width, height: design.height };
  const implementationMeta: ImageSourceMeta = {
    name: implementation.name,
    width: implementation.width,
    height: implementation.height
  };

  const result = compareImageData(designData, implementationData, settings, {
    designMeta,
    implementationMeta,
    originalSizeMismatch: design.width !== implementation.width || design.height !== implementation.height,
    heatmapUrl: imageDataToDataUrl(heatmapData)
  });

  if (!result.heatmapUrl) {
    throw new Error('Не удалось сформировать heatmap');
  }

  return result as ComparisonResult;
}
