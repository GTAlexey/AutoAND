import { UploadCloud, X } from 'lucide-react';
import type { LoadedImage } from '../lib/canvas';

type Props = {
  label: string;
  hint: string;
  image: LoadedImage | null;
  onFile: (file: File) => void;
  onClear?: () => void;
  showClearButton?: boolean;
};

export function ImageDropzone({ label, hint, image, onFile, onClear, showClearButton = true }: Props) {
  return (
    <label className="dropzone">
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.currentTarget.value = '';
        }}
      />

      {image ? (
        <div className="dropzone-preview">
          <img src={image.url} alt={label} />
          <div className="dropzone-meta">
            <strong>{image.name}</strong>
            <span>
              {image.width} × {image.height}px
            </span>
          </div>
          {showClearButton && onClear && (
            <button
              type="button"
              className="icon-button"
              aria-label="Очистить изображение"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onClear();
              }}
            >
              <X size={16} />
            </button>
          )}
        </div>
      ) : (
        <div className="dropzone-empty">
          <div className="dropzone-icon">
            <UploadCloud size={26} />
          </div>
          <strong>{label}</strong>
          <span>{hint}</span>
          <small>PNG, JPG, WebP · локально</small>
        </div>
      )}
    </label>
  );
}
