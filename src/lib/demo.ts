import { canvasToLoadedImage, createCanvas, type LoadedImage } from './canvas';

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size = 16, weight = 500, color = '#172033') {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.fillText(text, x, y);
}

function drawCard(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, title: string, value: string, accent: string) {
  ctx.save();
  ctx.shadowColor = 'rgba(20, 31, 52, 0.08)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;
  roundedRect(ctx, x, y, width, height, 24);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = '#e8edf5';
  ctx.lineWidth = 1;
  ctx.stroke();

  roundedRect(ctx, x + 22, y + 22, 42, 42, 14);
  ctx.fillStyle = accent;
  ctx.fill();
  drawText(ctx, title, x + 22, y + 88, 14, 600, '#667085');
  drawText(ctx, value, x + 22, y + 125, 30, 750, '#101828');
  drawText(ctx, '+12,4% к плану', x + 22, y + 154, 14, 600, '#16a34a');
  ctx.restore();
}

function drawBase(ctx: CanvasRenderingContext2D, variant: 'design' | 'implementation') {
  const isImpl = variant === 'implementation';

  ctx.fillStyle = '#f5f7fb';
  ctx.fillRect(0, 0, 1440, 940);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 272, 940);
  ctx.strokeStyle = '#e6ebf2';
  ctx.beginPath();
  ctx.moveTo(272, 0);
  ctx.lineTo(272, 940);
  ctx.stroke();

  drawText(ctx, 'Qualitäts-', 38, 58, 21, 800, '#101828');
  drawText(ctx, 'automatisierung', 38, 84, 19, 800, '#101828');
  drawText(ctx, 'Контроль дизайна', 38, 110, 13, 600, '#667085');

  const nav = ['Обзор', 'Сравнения', 'Макеты', 'Отчёты'];
  nav.forEach((item, index) => {
    const y = 142 + index * 54;
    if (index === 1) {
      roundedRect(ctx, 24, y - 30, 224, 42, 14);
      ctx.fillStyle = '#eef4ff';
      ctx.fill();
      drawText(ctx, item, 64, y - 3, 15, 700, '#2563eb');
    } else {
      drawText(ctx, item, 64, y - 3, 15, 600, '#566174');
    }
  });

  drawText(ctx, 'Qualitätsautomatisierung', 320, 68, isImpl ? 30 : 34, 800, '#101828');
  drawText(ctx, 'Проверка соответствия реализации макету по скриншотам', 320, 104, 16, 500, '#667085');

  const buttonX = isImpl ? 1146 : 1168;
  const buttonY = isImpl ? 43 : 38;
  roundedRect(ctx, buttonX, buttonY, isImpl ? 188 : 172, isImpl ? 46 : 48, 16);
  ctx.fillStyle = isImpl ? '#1d4ed8' : '#2563eb';
  ctx.fill();
  drawText(ctx, 'Создать отчёт', buttonX + 24, buttonY + 30, 15, 750, '#ffffff');

  drawCard(ctx, 320, 150, 300, 176, 'Совпадение', '92%', '#dbeafe');
  drawCard(ctx, isImpl ? 652 : 644, 150, isImpl ? 292 : 300, 176, 'Замечания', isImpl ? '21' : '18', '#fee2e2');
  drawCard(ctx, 968, isImpl ? 164 : 150, 300, isImpl ? 164 : 176, 'Критичные', '4', '#ffedd5');

  roundedRect(ctx, 320, 364, isImpl ? 584 : 608, 318, 28);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#e8edf5';
  ctx.stroke();
  drawText(ctx, 'Карта различий', 354, 415, 22, 800, '#101828');
  drawText(ctx, 'Зоны, где реализация заметно отличается от макета', 354, 444, 14, 500, '#667085');

  const bars = [132, 208, 154, 248, 182, 286, 234];
  bars.forEach((bar, index) => {
    const x = 374 + index * 68;
    const actualBar = isImpl && index > 2 ? bar - 24 : bar;
    roundedRect(ctx, x, 624 - actualBar, 34, actualBar, 10);
    ctx.fillStyle = index === 5 && isImpl ? '#ef4444' : '#5b8def';
    ctx.fill();
  });

  roundedRect(ctx, isImpl ? 946 : 968, 364, 300, 318, 28);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#e8edf5';
  ctx.stroke();
  drawText(ctx, 'Статус проверки', isImpl ? 982 : 1004, 416, 22, 800, '#101828');

  const statusItems = isImpl ? ['Вёрстка: 6 ошибок', 'Цвета: 4 ошибки', 'Текст: 3 ошибки'] : ['Вёрстка: ок', 'Цвета: ок', 'Текст: ок'];
  statusItems.forEach((item, index) => {
    const y = 476 + index * 58;
    roundedRect(ctx, isImpl ? 982 : 1004, y - 28, 220, 38, 12);
    ctx.fillStyle = isImpl && index < 2 ? '#fff1f2' : '#f0fdf4';
    ctx.fill();
    drawText(ctx, item, isImpl ? 1000 : 1022, y - 3, 14, 700, isImpl && index < 2 ? '#be123c' : '#15803d');
  });

  roundedRect(ctx, 320, 724, 948, 118, 26);
  ctx.fillStyle = isImpl ? '#fbfdff' : '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#e8edf5';
  ctx.stroke();
  drawText(ctx, 'Последние замечания', 354, 772, 22, 800, '#101828');
  drawText(ctx, isImpl ? 'Кнопка сдвинута, цвет действия отличается, третья карточка ниже макета' : 'Кнопка действия, карточки и графики соответствуют дизайн-системе', 354, 808, 16, 550, '#667085');

  if (isImpl) {
    roundedRect(ctx, 1092, 760, 110, 34, 12);
    ctx.fillStyle = '#fef3c7';
    ctx.fill();
    drawText(ctx, 'Лишний тег', 1110, 783, 13, 750, '#92400e');
  }
}

export function generateDemoImages(): { design: LoadedImage; implementation: LoadedImage } {
  const designCanvas = createCanvas(1440, 940);
  const implementationCanvas = createCanvas(1440, 940);
  const designCtx = designCanvas.getContext('2d');
  const implementationCtx = implementationCanvas.getContext('2d');

  if (!designCtx || !implementationCtx) {
    throw new Error('Canvas 2D недоступен');
  }

  drawBase(designCtx, 'design');
  drawBase(implementationCtx, 'implementation');

  return {
    design: canvasToLoadedImage(designCanvas, 'демо-макет.png'),
    implementation: canvasToLoadedImage(implementationCanvas, 'демо-реализация.png')
  };
}
