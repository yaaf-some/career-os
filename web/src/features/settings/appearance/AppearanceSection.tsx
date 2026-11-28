import { InsetGroup, SegmentedControl, useToast } from '@/components/ui';
import { useTheme, type ThemePreference } from '@/lib/theme';

const THEME_OPTIONS: readonly { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

export function AppearanceSection() {
  const { preference, setPreference } = useTheme();
  const { showToast } = useToast();

  return (
    <InsetGroup label="Appearance">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
        <div>
          <div className="text-sm font-medium text-[var(--wp-ink)]">Theme</div>
          <div className="text-xs text-[var(--wp-muted)]">
            Warm Paper light or Warm Charcoal dark
          </div>
        </div>
        <SegmentedControl
          ariaLabel="Appearance theme"
          value={preference}
          onValueChange={(next) => {
            setPreference(next);
            showToast({ message: `Theme set to ${next}` });
          }}
          options={THEME_OPTIONS}
        />
      </div>
    </InsetGroup>
  );
}
