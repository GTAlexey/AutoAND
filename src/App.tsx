import { Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ReportView } from './components/ReportView';
import { SettingsPanel } from './components/SettingsPanel';
import type { CompareSettings, ComparisonResult } from './lib/compare';
import { loadFileAsImage, runCanvasComparison, type LoadedImage } from './lib/canvas';

const DEFAULT_SETTINGS: CompareSettings = {
  threshold: 1,
  minArea: 1
};

function revokeIfBlob(image: LoadedImage | null) {
  if (image?.url.startsWith('blob:')) URL.revokeObjectURL(image.url);
}

const STORAGE_KEY = 'qualitaetsautomatisierung-session-v1';

type PersistedAppState = {
  designImage: LoadedImage | null;
  implementationImage: LoadedImage | null;
  settings: CompareSettings;
  overlayOpacity: number;
};

function readPersistedState(): PersistedAppState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedAppState>;
    return {
      designImage: parsed.designImage ?? null,
      implementationImage: parsed.implementationImage ?? null,
      settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
      overlayOpacity: typeof parsed.overlayOpacity === 'number' ? parsed.overlayOpacity : 0.5
    };
  } catch (caught) {
    console.warn('Не удалось восстановить сохранённую сессию', caught);
    return null;
  }
}

function writePersistedState(state: PersistedAppState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (caught) {
    console.warn('Не удалось сохранить текущую сессию', caught);
  }
}

export default function App() {
  const [persistedOnLoad] = useState(() => readPersistedState());
  const [designImage, setDesignImage] = useState<LoadedImage | null>(() => persistedOnLoad?.designImage ?? null);
  const [implementationImage, setImplementationImage] = useState<LoadedImage | null>(() => persistedOnLoad?.implementationImage ?? null);
  const [settings, setSettings] = useState<CompareSettings>(() => persistedOnLoad?.settings ?? DEFAULT_SETTINGS);
  const [overlayOpacity, setOverlayOpacity] = useState(() => persistedOnLoad?.overlayOpacity ?? 0.5);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRestored, setIsRestored] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  function clearResultOnly() {
    setResult(null);
    setError(null);
    setIsComparing(false);
  }

  async function handleFile(kind: 'design' | 'implementation', file: File) {
    setError(null);
    try {
      const loaded = await loadFileAsImage(file);
      if (kind === 'design') {
        revokeIfBlob(designImage);
        setDesignImage(loaded);
      } else {
        revokeIfBlob(implementationImage);
        setImplementationImage(loaded);
      }
      setResult(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить файл');
    }
  }

  function clearDesignImage() {
    revokeIfBlob(designImage);
    setDesignImage(null);
    clearResultOnly();
  }

  function clearImplementationImage() {
    revokeIfBlob(implementationImage);
    setImplementationImage(null);
    clearResultOnly();
  }

  useEffect(() => {
    setIsRestored(true);
  }, []);

  useEffect(() => {
    if (!isRestored) return;

    writePersistedState({
      designImage,
      implementationImage,
      settings,
      overlayOpacity
    });
  }, [designImage, implementationImage, isRestored, overlayOpacity, result, settings]);

  useEffect(() => {
    if (!isRestored || !designImage || !implementationImage) return;

    const currentDesign = designImage;
    const currentImplementation = implementationImage;
    let isCancelled = false;

    async function runAutomaticComparison() {
      setError(null);
      setIsComparing(true);
      try {
        await new Promise((resolve) => window.setTimeout(resolve, 40));
        const nextResult = await runCanvasComparison(currentDesign, currentImplementation, settings);
        if (!isCancelled) {
          setResult(nextResult);
        }
      } catch (caught) {
        if (!isCancelled) {
          setError(caught instanceof Error ? caught.message : 'Неизвестная ошибка сравнения');
          setResult(null);
        }
      } finally {
        if (!isCancelled) {
          setIsComparing(false);
        }
      }
    }

    void runAutomaticComparison();

    return () => {
      isCancelled = true;
    };
  }, [designImage, implementationImage, isRestored, settings]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">
          <span className="robot-eye">
            <span className="robot-eye-lens" />
          </span>
        </div>
        <div className="topbar-main">
          <div className="topbar-title-copy">
            <h1>Qualitätsautomatisierung</h1>
            <p>Макет и вёрстка загружаются прямо в окно результата. Файлы остаются в браузере.</p>
          </div>
          <div className="topbar-badges">
            <button type="button" className="header-settings-button" aria-label="Открыть параметры" onClick={() => setIsSettingsOpen(true)}>
              <Settings size={18} />
            </button>
          </div>
        </div>
      </header>

      <ReportView
        design={designImage}
        implementation={implementationImage}
        result={result}
        isComparing={isComparing}
        error={error}
        overlayOpacity={overlayOpacity}
        onOverlayOpacityChange={setOverlayOpacity}
        onDesignFile={(file) => handleFile('design', file)}
        onImplementationFile={(file) => handleFile('implementation', file)}
        onClearDesign={clearDesignImage}
        onClearImplementation={clearImplementationImage}
      />

      <SettingsPanel
        settings={settings}
        isOpen={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        onSettingsChange={setSettings}
      />

    </main>
  );
}
