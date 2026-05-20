import type { ShiftDirection, ShiftEstimate, Severity } from './compare';

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('ru-RU').format(value);
}

export function formatPercent(value: number): string {
  return `${value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}%`;
}

export function severityLabel(severity: Severity): string {
  if (severity === 'high') return 'Критично';
  if (severity === 'medium') return 'Средне';
  return 'Низко';
}

export function mismatchTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    'visual difference': 'Визуальное отличие',
    'size mismatch': 'Несовпадение размера',
    'missing area': 'Отсутствующий/лишний блок',
    'shifted area': 'Сдвиг области'
  };

  return labels[type] ?? type;
}

export function shiftDirectionLabel(direction: ShiftDirection): string {
  const labels: Record<ShiftDirection, string> = {
    none: 'без явного смещения',
    left: 'влево',
    right: 'вправо',
    up: 'вверх',
    down: 'вниз',
    'up-left': 'вверх и влево',
    'up-right': 'вверх и вправо',
    'down-left': 'вниз и влево',
    'down-right': 'вниз и вправо'
  };

  return labels[direction];
}

export function formatSignedPixels(value: number): string {
  if (value === 0) return '0 px';
  return `${value > 0 ? '+' : '−'}${Math.abs(value)} px`;
}

export function shiftSummary(shift?: ShiftEstimate): string {
  if (!shift) return 'Явный сдвиг не найден — похоже на цвет, размер или локальную форму.';

  return `Реализация смещена ${shiftDirectionLabel(shift.direction)} примерно на ${shift.distance} px.`;
}
