import { Switch } from '@mantine/core';

interface EnableSwitchProps {
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (next: boolean) => void;
}

/** Toggle switch that calls the enable/disable API through the parent handler. */
export function EnableSwitch({ checked, disabled, onChange }: EnableSwitchProps) {
  return (
    <Switch
      size="sm"
      label={checked ? 'Enabled' : 'Disabled'}
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.currentTarget.checked)}
      aria-label={checked ? 'Disable tool' : 'Enable tool'}
    />
  );
}
