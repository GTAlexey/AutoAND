import { AlertTriangle, CheckCircle2, Download, Flame, Target, Trash2 } from 'lucide-react';
import { type CSSProperties, type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { ImageDropzone } from './ImageDropzone';
import type { ComparisonResult, DiffRegion, MismatchType, Severity } from '../lib/compare';
import { getSizeMismatchErrorMessage, imageUrlToImage, type LoadedImage } from '../lib/canvas';
import { formatNumber, formatPercent, formatSignedPixels, mismatchTypeLabel, severityLabel, shiftDirectionLabel, shiftSummary } from '../lib/format';

type Props = {
  design: LoadedImage | null;
  implementation: LoadedImage | null;
  result: ComparisonResult | null;
  isComparing: boolean;
  error: string | null;
  overlayOpacity: number;
  onOverlayOpacityChange: (opacity: number) => void;
  onDesignFile: (file: File) => void;
  onImplementationFile: (file: File) => void;
  onClearDesign: () => void;
  onClearImplementation: () => void;
};

type ScoreStatus = 'empty' | 'low' | 'medium' | 'high';

const SEVERITIES: Severity[] = ['high', 'medium', 'low'];
const MISMATCH_TYPES: Array<{ type: MismatchType; label: string }> = [
  { type: 'size mismatch', label: 'Габариты' },
  { type: 'shifted area', label: 'Смещение' },
  { type: 'visual difference', label: 'Цвет' },
  { type: 'missing area', label: 'Отсутствие' }
];
const DEFAULT_SEVERITY_FILTER: Record<Severity, boolean> = { high: true, medium: true, low: true };
const DEFAULT_MISMATCH_TYPE_FILTER: Record<MismatchType, boolean> = {
  'visual difference': true,
  'size mismatch': true,
  'missing area': true,
  'shifted area': true
};
const SEVERITY_SORT_WEIGHT: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
const EXPORT_REGION_STYLES: Record<Severity, { stroke: string; fill: string }> = {
  high: { stroke: '#ef4444', fill: 'rgba(239, 68, 68, 0.09)' },
  medium: { stroke: '#f59e0b', fill: 'rgba(245, 158, 11, 0.09)' },
  low: { stroke: '#22c55e', fill: 'rgba(34, 197, 94, 0.09)' }
};
const EXPORT_SHIFT_COLOR = '#2563eb';
const EXPORT_SHIFT_HALO_COLOR = '#ffffff';

function regionClass(region: DiffRegion) {
  return `region-box region-${region.severity}`;
}

function regionStyle(region: DiffRegion, result: ComparisonResult): CSSProperties {
  return {
    left: `${(region.x / result.width) * 100}%`,
    top: `${(region.y / result.height) * 100}%`,
    width: `${(region.width / result.width) * 100}%`,
    height: `${(region.height / result.height) * 100}%`
  };
}

function clampPercent(value: number) {
  return Math.max(5, Math.min(95, value));
}

function clampOpacity(value: number) {
  return Math.max(0, Math.min(1, value));
}

function scoreStatus(score: number): Exclude<ScoreStatus, 'empty'> {
  if (score < 50) return 'low';
  if (score < 80) return 'medium';
  return 'high';
}

function scoreMessage(status: ScoreStatus) {
  if (status === 'low') return '😑 Ты можешь лучше!';
  if (status === 'medium') return '😏 Ну почти...';
  if (status === 'high') return '🤩 Ай молодец!';
  return 'Загрузи макет и вёрстку';
}

function shiftArrowStyle(region: DiffRegion, result: ComparisonResult): CSSProperties {
  const shift = region.shift;
  if (!shift) return {};

  const centerX = ((region.x + region.width / 2) / result.width) * 100;
  const centerY = ((region.y + region.height / 2) / result.height) * 100;
  const length = Math.max(34, Math.min(118, shift.distance * 3.1));
  const angle = Math.atan2(shift.dy, shift.dx) * (180 / Math.PI);

  return {
    left: `${clampPercent(centerX)}%`,
    top: `${clampPercent(centerY)}%`,
    width: `${length}px`,
    transform: `translate(-50%, -50%) rotate(${angle}deg)`
  };
}

function ShiftArrow({ region, result }: { region: DiffRegion; result: ComparisonResult }) {
  if (!region.shift) return null;

  return (
    <div className="shift-arrow" style={shiftArrowStyle(region, result)} aria-hidden="true">
      <span />
    </div>
  );
}

function ScaleCanvas({
  children,
  width,
  height,
  onClick,
  className
}: {
  children: ReactNode;
  width: number;
  height: number;
  onClick?: (event: MouseEvent<HTMLDivElement>) => void;
  className?: string;
}) {
  return (
    <div
      className={`canvas-stage ${className ?? ''}`}
      style={{ aspectRatio: `${width} / ${height}`, '--canvas-ratio': width / height } as CSSProperties}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

export function ReportView({
  design,
  implementation,
  result,
  isComparing,
  error,
  overlayOpacity,
  onOverlayOpacityChange,
  onDesignFile,
  onImplementationFile,
  onClearDesign,
  onClearImplementation
}: Props) {
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [showRegionFrames, setShowRegionFrames] = useState(false);
  const [showShiftArrows, setShowShiftArrows] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<Record<Severity, boolean>>(() => ({ ...DEFAULT_SEVERITY_FILTER }));
  const [mismatchTypeFilter, setMismatchTypeFilter] = useState<Record<MismatchType, boolean>>(() => ({ ...DEFAULT_MISMATCH_TYPE_FILTER }));
  const [excludedRegionIds, setExcludedRegionIds] = useState<Set<number>>(() => new Set());
  const issueRowRefs = useRef<Map<number, HTMLElement>>(new Map());
  const sortedRegions = useMemo(
    () => [...(result?.regions ?? [])].sort((left, right) => SEVERITY_SORT_WEIGHT[left.severity] - SEVERITY_SORT_WEIGHT[right.severity] || left.id - right.id),
    [result?.regions]
  );
  const [selectedRegionId, setSelectedRegionId] = useState<number | null>(null);

  useEffect(() => {
    setExcludedRegionIds(new Set());
    setSelectedRegionId(null);
  }, [result?.generatedAt]);

  const filteredRegions = useMemo(
    () => sortedRegions.filter((region) => severityFilter[region.severity] && mismatchTypeFilter[region.type]),
    [mismatchTypeFilter, severityFilter, sortedRegions]
  );

  const visibleRegions = useMemo(
    () => filteredRegions.filter((region) => !excludedRegionIds.has(region.id)),
    [excludedRegionIds, filteredRegions]
  );

  useEffect(() => {
    if (selectedRegionId !== null && !visibleRegions.some((region) => region.id === selectedRegionId)) {
      setSelectedRegionId(null);
    }
  }, [selectedRegionId, visibleRegions]);

  const selectedRegion = useMemo(
    () => (selectedRegionId === null ? null : visibleRegions.find((region) => region.id === selectedRegionId) ?? null),
    [selectedRegionId, visibleRegions]
  );

  useEffect(() => {
    if (selectedRegionId === null) return;

    const row = issueRowRefs.current.get(selectedRegionId);
    row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedRegionId]);

  const previewRegions = visibleRegions.slice(0, 35);
  const regionsForRender = selectedRegion ? [selectedRegion] : previewRegions;
  const interactiveRegions = showRegionFrames
    ? regionsForRender
    : selectedRegion
      ? [selectedRegion, ...visibleRegions.filter((region) => region.id !== selectedRegion.id)]
      : visibleRegions;
  const excludedRegionCount = result ? excludedRegionIds.size : 0;
  const conformity = result ? Math.max(0, 100 - result.diffPercentage) : 0;
  const implementationPreviewUrl = implementation?.url ?? '';
  const conformityBarValue = Math.max(0, Math.min(100, conformity));
  const roundedConformity = result ? Math.round(conformityBarValue) : null;
  const scoreTone = roundedConformity !== null ? scoreStatus(roundedConformity) : 'empty';
  const scoreToneMessage = scoreMessage(scoreTone);
  const hasCompleteUpload = Boolean(design && implementation);
  const hasStaticSizeMismatch = Boolean(design && implementation && (design.width !== implementation.width || design.height !== implementation.height));
  const sizeMismatchMessage = hasStaticSizeMismatch && design && implementation ? getSizeMismatchErrorMessage(design, implementation) : null;
  const uploadStatusMessage = error ?? sizeMismatchMessage;
  const resultSizeMismatchMessage = result?.originalSizeMismatch
    ? `Размеры отличаются! Макет ${result.designMeta.width}×${result.designMeta.height}, Результат ${result.implementationMeta.width}×${result.implementationMeta.height}`
    : null;
  const exportRegions = selectedRegion ? [selectedRegion] : showRegionFrames ? regionsForRender : [];

  function toggleSeverity(severity: Severity) {
    setSeverityFilter((current) => ({ ...current, [severity]: !current[severity] }));
    setSelectedRegionId(null);
  }

  function toggleMismatchType(type: MismatchType) {
    setMismatchTypeFilter((current) => ({ ...current, [type]: !current[type] }));
    setSelectedRegionId(null);
  }

  function toggleRegionExclusion(regionId: number, isExcluded: boolean) {
    setExcludedRegionIds((current) => {
      const next = new Set(current);
      if (isExcluded) {
        next.add(regionId);
      } else {
        next.delete(regionId);
      }
      return next;
    });

    if (isExcluded && selectedRegionId === regionId) {
      setSelectedRegionId(null);
    }
  }

  function clearSelectedRegion() {
    setSelectedRegionId(null);
  }

  function handleStageClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target instanceof HTMLElement && event.target.closest('.region-box')) return;

    clearSelectedRegion();
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target;
      const isEditableTarget = target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

      if (event.key === 'Escape') {
        clearSelectedRegion();
        return;
      }

      if (isEditableTarget || event.altKey || event.ctrlKey || event.metaKey) return;

      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        onOverlayOpacityChange(event.key === '0' ? 1 : Number(event.key) / 10);
        return;
      }

      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        onOverlayOpacityChange(clampOpacity(Math.round((overlayOpacity + 0.05) * 100) / 100));
      }

      if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        onOverlayOpacityChange(clampOpacity(Math.round((overlayOpacity - 0.05) * 100) / 100));
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onOverlayOpacityChange, overlayOpacity]);

  function drawExportRegions(context: CanvasRenderingContext2D, regions: DiffRegion[]) {
    for (const region of regions) {
      const style = EXPORT_REGION_STYLES[region.severity];
      context.save();
      context.lineWidth = 2;
      context.strokeStyle = style.stroke;
      context.fillStyle = style.fill;
      context.fillRect(region.x, region.y, region.width, region.height);
      context.strokeRect(region.x + 1, region.y + 1, Math.max(0, region.width - 2), Math.max(0, region.height - 2));
      context.restore();
    }
  }

  function drawExportShiftArrows(context: CanvasRenderingContext2D, regions: DiffRegion[]) {
    for (const region of regions) {
      if (!region.shift) continue;

      const centerX = region.x + region.width / 2;
      const centerY = region.y + region.height / 2;
      const length = Math.max(34, Math.min(118, region.shift.distance * 3.1));
      const angle = Math.atan2(region.shift.dy, region.shift.dx);
      const startX = centerX - Math.cos(angle) * (length / 2);
      const startY = centerY - Math.sin(angle) * (length / 2);
      const endX = centerX + Math.cos(angle) * (length / 2);
      const endY = centerY + Math.sin(angle) * (length / 2);
      const headLength = 12;
      const headAngle = Math.PI / 7;

      context.save();
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.strokeStyle = EXPORT_SHIFT_HALO_COLOR;
      context.fillStyle = EXPORT_SHIFT_HALO_COLOR;
      context.lineWidth = 7;
      context.beginPath();
      context.moveTo(startX, startY);
      context.lineTo(endX, endY);
      context.stroke();
      context.beginPath();
      context.moveTo(endX, endY);
      context.lineTo(endX - Math.cos(angle - headAngle) * headLength, endY - Math.sin(angle - headAngle) * headLength);
      context.lineTo(endX - Math.cos(angle + headAngle) * headLength, endY - Math.sin(angle + headAngle) * headLength);
      context.closePath();
      context.fill();
      context.strokeStyle = EXPORT_SHIFT_COLOR;
      context.fillStyle = EXPORT_SHIFT_COLOR;
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(startX, startY);
      context.lineTo(endX, endY);
      context.stroke();
      context.beginPath();
      context.moveTo(endX, endY);
      context.lineTo(endX - Math.cos(angle - headAngle) * headLength, endY - Math.sin(angle - headAngle) * headLength);
      context.lineTo(endX - Math.cos(angle + headAngle) * headLength, endY - Math.sin(angle + headAngle) * headLength);
      context.closePath();
      context.fill();
      context.restore();
    }
  }

  async function handleExportPng() {
    if (!result || !design || !implementation) return;

    const canvas = document.createElement('canvas');
    canvas.width = result.width;
    canvas.height = result.height;
    const context = canvas.getContext('2d');
    if (!context) return;

    context.imageSmoothingEnabled = false;

    const baseImage = await imageUrlToImage(showHeatmap ? implementation.url : design.url);
    context.drawImage(baseImage, 0, 0, result.width, result.height);

    if (showHeatmap) {
      const heatmapImage = await imageUrlToImage(result.heatmapUrl);
      context.globalAlpha = overlayOpacity;
      context.drawImage(heatmapImage, 0, 0, result.width, result.height);
      context.globalAlpha = 1;
    } else {
      const implementationImage = await imageUrlToImage(implementation.url);
      context.globalAlpha = overlayOpacity;
      context.drawImage(implementationImage, 0, 0, result.width, result.height);
      context.globalAlpha = 1;
    }

    drawExportRegions(context, exportRegions);

    if (showShiftArrows) {
      drawExportShiftArrows(context, exportRegions);
    }

    const link = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.href = canvas.toDataURL('image/png');
    link.download = `autoand-export-${timestamp}.png`;
    document.body.append(link);
    link.click();
    link.remove();
  }

  function renderRegionOverlays() {
    if (!result) return null;

    return (
      <>
        {interactiveRegions.map((region) => (
          <button
            key={region.id}
            type="button"
            className={`${regionClass(region)} ${selectedRegionId === region.id ? 'selected' : ''} ${showRegionFrames || selectedRegionId === region.id ? '' : 'hit-area-only'}`}
            style={regionStyle(region, result)}
            title={`#${region.id} ${severityLabel(region.severity)} · ${shiftSummary(region.shift)}`}
            aria-label={`Выбрать область #${region.id}: ${severityLabel(region.severity)}, ${mismatchTypeLabel(region.type)}, ${shiftSummary(region.shift)}`}
            aria-pressed={selectedRegionId === region.id}
            onClick={(event) => {
              event.stopPropagation();
              setSelectedRegionId((current) => (current === region.id ? null : region.id));
            }}
          />
        ))}
        {showShiftArrows && regionsForRender.map((region) => (
          <ShiftArrow key={`shift-${region.id}`} region={region} result={result} />
        ))}
      </>
    );
  }

  function renderUploadWorkspace() {
    return (
      <div className="viewer-upload-state">
        <div className="viewer-upload-copy">
          <h3>{uploadStatusMessage ? 'Сравнение остановлено' : hasCompleteUpload ? 'Сравнение выполняется' : 'Загрузите два скриншота'}</h3>
          <p>
            {uploadStatusMessage
              ? 'Проверьте загруженные скриншоты или параметры сравнения.'
              : hasCompleteUpload
                ? 'Сравниваю изображения и группирую отличия'
                : 'Макет и вёрстка загружаются прямо в окно результата. Файлы остаются в браузере.'}
          </p>
        </div>

        <div className="dropzone-grid viewer-dropzone-grid">
          <ImageDropzone
            label="Макет"
            hint="Эталон"
            image={design}
            onFile={onDesignFile}
            showClearButton={false}
          />
          <ImageDropzone
            label="Вёрстка"
            hint="Результат"
            image={implementation}
            onFile={onImplementationFile}
            showClearButton={false}
          />
        </div>

        {uploadStatusMessage && <div className="error-banner">{uploadStatusMessage}</div>}
      </div>
    );
  }

  function renderComparisonWorkspace() {
    if (!result || !design || !implementation) return renderUploadWorkspace();

    return (
      <ScaleCanvas width={result.width} height={result.height} onClick={handleStageClick}>
        {showHeatmap ? (
          <>
            <img className="base-image" src={implementationPreviewUrl} alt="Вёрстка" />
            <img className="overlay-image heatmap-overlay" style={{ opacity: overlayOpacity }} src={result.heatmapUrl} alt="Тепловая карта отличий" />
          </>
        ) : (
          <>
            <img className="base-image" src={design.url} alt="Макет" />
            <img className="overlay-image" style={{ opacity: overlayOpacity }} src={implementationPreviewUrl} alt="Вёрстка" />
          </>
        )}
        {renderRegionOverlays()}
      </ScaleCanvas>
    );
  }

  function renderActiveRegionSummary() {
    if (!result) {
      return (
        <div className="active-region-summary muted" onClick={(event) => event.stopPropagation()}>
          <span className="active-region-kicker">Ожидает анализа</span>
          <span>{design ? `Макет ${design.width}×${design.height}px` : 'Макет не загружен'}</span>
          <span>{implementation ? `Вёрстка ${implementation.width}×${implementation.height}px` : 'Вёрстка не загружена'}</span>
          <span>{uploadStatusMessage ?? (isComparing ? 'Сравнение выполняется…' : 'Загрузите два скриншота.')}</span>
        </div>
      );
    }

    if (!selectedRegion) {
      return (
        <div className="active-region-summary muted" onClick={(event) => event.stopPropagation()}>
          <span className="active-region-kicker">Сводка</span>
          <span>{formatNumber(visibleRegions.length)} видимых из {formatNumber(filteredRegions.length)}</span>
          <span>{formatNumber(result.regions.length)} всего</span>
          <span>Отличия: {formatPercent(result.diffPercentage)}</span>
          {resultSizeMismatchMessage && <span className="size-mismatch-inline">{resultSizeMismatchMessage}</span>}
          {excludedRegionCount > 0 && <span>{formatNumber(excludedRegionCount)} исключено</span>}
        </div>
      );
    }

    return (
      <div className="active-region-summary" onClick={(event) => event.stopPropagation()}>
        <span className={`severity-dot ${selectedRegion.severity}`} />
        <strong>Область #{selectedRegion.id}</strong>
        <span>{severityLabel(selectedRegion.severity)} · {mismatchTypeLabel(selectedRegion.type)}</span>
        <span>{shiftSummary(selectedRegion.shift)}</span>
        <span>x:{selectedRegion.x}, y:{selectedRegion.y}</span>
        {selectedRegion.shift && <span>dx {formatSignedPixels(selectedRegion.shift.dx)} · dy {formatSignedPixels(selectedRegion.shift.dy)}</span>}
        <span>{selectedRegion.width}×{selectedRegion.height}px</span>
        {selectedRegion.shift && <span>после выравнивания {selectedRegion.shift.alignedDelta}</span>}
      </div>
    );
  }

  function renderComparisonControls() {
    return (
      <div className="viewer-toolbar viewer-bottom-bar">
        <div className="tabs viewer-tabs" role="group" aria-label="Режим сравнения">
          <button
            type="button"
            className={`heatmap-toggle ${showHeatmap ? 'active' : ''}`}
            aria-pressed={showHeatmap}
            onClick={() => setShowHeatmap((current) => !current)}
          >
            <Flame size={16} aria-hidden="true" />
            <span>Тепловая карта</span>
          </button>
          <button
            type="button"
            className={`viewer-visual-button ${showShiftArrows ? 'active' : ''}`}
            aria-pressed={showShiftArrows}
            onClick={() => setShowShiftArrows((current) => !current)}
          >
            Стрелки
          </button>
          <button
            type="button"
            className={`viewer-visual-button ${showRegionFrames ? 'active' : ''}`}
            aria-pressed={showRegionFrames}
            onClick={() => setShowRegionFrames((current) => !current)}
          >
            Рамки
          </button>
          <div className="overlay-control active">
            <label aria-label="Прозрачность наложения">
              <span>Прозрачность</span>
              <strong>{Math.round(overlayOpacity * 100)}%</strong>
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round(overlayOpacity * 100)}
                onInput={(event) => onOverlayOpacityChange(Number(event.currentTarget.value) / 100)}
                onChange={(event) => onOverlayOpacityChange(Number(event.currentTarget.value) / 100)}
              />
            </label>
          </div>
        </div>
        <div className="viewer-actions">
          <div className="screenshot-delete-actions">
            <button type="button" className="secondary-action export-screenshot-action" disabled={!result || !design || !implementation} onClick={() => void handleExportPng()}>
              <Download size={16} aria-hidden="true" /> Выгрузить
            </button>
            <button type="button" className="secondary-action delete-screenshot-action" disabled={!design} onClick={onClearDesign}>
              <Trash2 size={16} aria-hidden="true" /> Макет
            </button>
            <button type="button" className="secondary-action delete-screenshot-action" disabled={!implementation} onClick={onClearImplementation}>
              <Trash2 size={16} aria-hidden="true" /> Вёрстка
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className="report-grid">
      <div className="report-left-column">
        <div className="report-summary-row">
          <div className={`summary-card hero-summary score-${scoreTone}`} style={{ '--score-percent': `${conformityBarValue}%` } as CSSProperties}>
            <div className="score-summary">
              <h2>Итог проверки</h2>
              <p className="score-message">{scoreToneMessage}</p>
              <div className="score-bar" role="img" aria-label={result ? `Соответствие ${formatPercent(conformity)}. ${scoreToneMessage}` : 'Соответствие появится после загрузки'}>
                <span />
              </div>
            </div>
            <div className="score-value">
              <span>{roundedConformity ?? '—'}</span>
              {roundedConformity !== null && <small>%</small>}
            </div>
          </div>

          <div className="summary-strip">
            {SEVERITIES.map((severity) => {
              const Icon = severity === 'high' ? Flame : severity === 'medium' ? AlertTriangle : CheckCircle2;
              const label = severity === 'medium' ? 'Среден' : severityLabel(severity);

              return (
                <button
                  key={severity}
                  type="button"
                  className={`metric-card severity-metric ${severity} ${severityFilter[severity] ? 'active' : ''}`}
                  aria-pressed={severityFilter[severity]}
                  onClick={() => toggleSeverity(severity)}
                >
                  <Icon size={18} />
                  <span>{label}</span>
                  <strong>{result?.severityCounts[severity] ?? 0}</strong>
                  <small>{severityFilter[severity] ? 'включено' : 'скрыто'}</small>
                </button>
              );
            })}
            <div className="metric-card all-diffs-metric" aria-label={`Все отличия: ${formatNumber(result?.diffPixelCount ?? 0)} пикселей`}>
              <Target size={18} />
              <span>Все отличия</span>
              <strong>{formatNumber(result?.diffPixelCount ?? 0)}</strong>
              <small>пикселей</small>
            </div>
          </div>
        </div>

        <div className="viewer-card viewer-card-primary">
          {renderActiveRegionSummary()}
          {renderComparisonWorkspace()}
          {renderComparisonControls()}
        </div>
      </div>

      <aside className="issues-card" onClick={() => setSelectedRegionId(null)}>
        <div className="issues-header">
          <div>
            <h3>Список несостыковок</h3>
          </div>
        </div>

        <div className="mismatch-type-filters" onClick={(event) => event.stopPropagation()}>
          {MISMATCH_TYPES.map(({ type, label }) => (
            <label key={type} className={`mismatch-type-filter ${mismatchTypeFilter[type] ? 'active' : ''}`}>
              <input type="checkbox" checked={mismatchTypeFilter[type]} onChange={() => toggleMismatchType(type)} />
              <span aria-hidden="true" />
              {label}
            </label>
          ))}
        </div>

        {excludedRegionCount > 0 && (
          <div className="issues-filter-meta" onClick={(event) => event.stopPropagation()}>
            <span>{formatNumber(excludedRegionCount)} исключено</span>
          </div>
        )}

        <div className="issue-list">
          {filteredRegions.slice(0, 80).map((region) => {
            const isExcluded = excludedRegionIds.has(region.id);
            const isSelected = selectedRegionId === region.id && !isExcluded;
            const SeverityIcon = region.severity === 'high' ? Flame : region.severity === 'medium' ? AlertTriangle : CheckCircle2;

            return (
              <article
                key={region.id}
                ref={(node) => {
                  if (node) {
                    issueRowRefs.current.set(region.id, node);
                  } else {
                    issueRowRefs.current.delete(region.id);
                  }
                }}
                className={`issue-row ${isSelected ? 'selected' : ''} ${isExcluded ? 'excluded' : ''}`}
              >
                <button
                  type="button"
                  className="issue-row-main"
                  aria-pressed={isSelected}
                  aria-disabled={isExcluded}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!isExcluded) {
                      setSelectedRegionId((current) => (current === region.id ? null : region.id));
                    }
                  }}
                >
                  <SeverityIcon className={`issue-severity-icon ${region.severity}`} size={16} aria-hidden="true" />
                  <div className="issue-row-copy">
                    <strong>{mismatchTypeLabel(region.type)}</strong>
                    <span>
                      {region.shift ? `Сдвиг ${shiftDirectionLabel(region.shift.direction)} · dx ${formatSignedPixels(region.shift.dx)}, dy ${formatSignedPixels(region.shift.dy)}` : 'Без уверенного направления сдвига'}
                    </span>
                    <span>
                      x:{region.x}, y:{region.y}, {region.width}×{region.height}px
                    </span>
                  </div>
                </button>
                <label
                  className={`issue-exclude ${isExcluded ? 'is-excluded' : ''}`}
                  title={isExcluded ? 'Вернуть ошибку' : 'Исключить ошибку'}
                  onClick={(event) => event.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={isExcluded}
                    aria-label={isExcluded ? `Вернуть ошибку #${region.id}` : `Исключить ошибку #${region.id}`}
                    onChange={(event) => toggleRegionExclusion(region.id, event.target.checked)}
                  />
                  <span className="issue-exclude-box" aria-hidden="true" />
                </label>
              </article>
            );
          })}

          {!result && (
            <div className="empty-state muted-empty">
              <Target size={28} />
              <strong>Пока пусто.</strong>
              <span>Несостыковки появятся здесь после загрузки макета и вёрстки.</span>
            </div>
          )}

          {result && !result.regions.length && (
            <div className="empty-state">
              <CheckCircle2 size={28} />
              <strong>Макет и реализация совпадают в пределах текущего порога.</strong>
              <span>Попробуйте уменьшить порог отличия, если нужен более строгий контроль.</span>
            </div>
          )}

          {Boolean(result && result.regions.length && !filteredRegions.length) && (
            <div className="empty-state muted-empty">
              <AlertTriangle size={28} />
              <strong>По выбранным фильтрам ничего нет.</strong>
              <span>Включите другой тип или уровень критичности, чтобы снова увидеть области на скриншоте.</span>
            </div>
          )}
        </div>
      </aside>
    </section>
  );
}
