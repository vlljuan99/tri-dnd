import { useId, useState } from 'react';
import ArchiveIcon from './ArchiveIcon.jsx';
import { ARCHIVE_ICONS, archiveIconLabel } from '../lib/archiveIcons.js';

export default function ArchiveIconPicker({ value = '', automaticIcon, onChange, disabled = false, label = 'Icono' }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const currentIcon = value || automaticIcon;

  return (
    <div className="min-w-0">
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${label}: ${value ? archiveIconLabel(currentIcon) : `${archiveIconLabel(currentIcon)} automático`}. Cambiar icono`}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-10 items-center gap-2 rounded-sm border border-bone/20 bg-night-950 px-2.5 text-left text-bone/70 hover:border-gold/50 hover:text-gold disabled:opacity-40"
      >
        <ArchiveIcon icon={currentIcon} className="h-5 w-5 shrink-0" />
        <span className="text-xs">{value ? archiveIconLabel(currentIcon) : 'Automático'}</span>
        <span aria-hidden="true" className="text-[0.6rem] opacity-50">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div
          id={panelId}
          role="group"
          aria-label={`Elegir ${label.toLowerCase()}`}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              setOpen(false);
            }
          }}
          className="mt-2 rounded-sm border border-gold/20 bg-night-950 p-2"
        >
          <button
            type="button"
            aria-pressed={!value}
            title={`Automático (${archiveIconLabel(automaticIcon)})`}
            onClick={() => {
              onChange('');
              setOpen(false);
            }}
            className={`mb-2 flex w-full items-center gap-2 rounded-sm border px-2 py-1.5 text-xs ${
              !value ? 'border-gold/55 bg-gold/10 text-gold' : 'border-bone/10 text-bone/55 hover:border-bone/30'
            }`}
          >
            <ArchiveIcon icon={automaticIcon} className="h-4 w-4" />
            Automático según el nombre
          </button>
          <div className="grid grid-cols-8 gap-1">
            {ARCHIVE_ICONS.map((option) => (
              <button
                key={option.id}
                type="button"
                title={option.label}
                aria-label={option.label}
                aria-pressed={value === option.id}
                onClick={() => {
                  onChange(option.id);
                  setOpen(false);
                }}
                className={`flex aspect-square min-h-8 items-center justify-center rounded-sm border ${
                  value === option.id
                    ? 'border-gold bg-gold/15 text-gold'
                    : 'border-bone/10 text-bone/55 hover:border-gold/45 hover:text-gold'
                }`}
              >
                <ArchiveIcon icon={option.id} className="h-4 w-4" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
