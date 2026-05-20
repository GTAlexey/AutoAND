import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { CompareSettings } from '../lib/compare';

type Props = {
  settings: CompareSettings;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onSettingsChange: (settings: CompareSettings) => void;
};

export function SettingsPanel({
  settings,
  isOpen,
  onOpenChange,
  onSettingsChange
}: Props) {
  const [draftSettings, setDraftSettings] = useState<CompareSettings>(settings);

  useEffect(() => {
    if (isOpen) {
      setDraftSettings(settings);
    }
  }, [isOpen, settings]);

  const hasDraftChanges = useMemo(
    () => draftSettings.threshold !== settings.threshold || draftSettings.minArea !== settings.minArea,
    [draftSettings, settings]
  );

  function closeWithoutApplying() {
    setDraftSettings(settings);
    onOpenChange(false);
  }

  function applySettings() {
    if (hasDraftChanges) {
      onSettingsChange(draftSettings);
    }
    onOpenChange(false);
  }

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={closeWithoutApplying}>
      <div
        className="sensitivity-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sensitivity-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">Параметры</p>
            <h2 id="sensitivity-title">Чувствительность</h2>
          </div>
          <button type="button" className="modal-close" aria-label="Закрыть настройки чувствительности" onClick={closeWithoutApplying}>
            <X size={20} />
          </button>
        </div>

        <div className="settings-status-row modal-status-row">
          <span>Порог {draftSettings.threshold}</span>
          <span>Зона {draftSettings.minArea}px</span>
        </div>

        <div className="range-grid">
          <label>
            <span>Порог отличия</span>
            <strong>{draftSettings.threshold}</strong>
            <input
              type="range"
              min="1"
              max="120"
              value={draftSettings.threshold}
              onChange={(event) => setDraftSettings((current) => ({ ...current, threshold: Number(event.target.value) }))}
            />
            <small>1 px — максимально строгая попиксельная сверка.</small>
          </label>

          <label>
            <span>Игнорировать мелкие отличия</span>
            <strong>{draftSettings.minArea}px</strong>
            <input
              type="range"
              min="1"
              max="1200"
              value={draftSettings.minArea}
              onChange={(event) => setDraftSettings((current) => ({ ...current, minArea: Number(event.target.value) }))}
            />
            <small>1 px — учитывать даже одиночные отличающиеся пиксели.</small>
          </label>

        </div>

        <div className="modal-actions">
          <button type="button" className="secondary-action" disabled={!hasDraftChanges} onClick={closeWithoutApplying}>
            Отменить
          </button>
          <button type="button" className="primary-action" disabled={!hasDraftChanges} onClick={applySettings}>
            Применить
          </button>
        </div>
      </div>
    </div>
  );
}
