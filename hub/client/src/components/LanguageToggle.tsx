import { ActionIcon, Menu, Tooltip } from '@mantine/core';
import { TbCheck, TbLanguage } from 'react-icons/tb';
import { type Locale, useI18nStore } from '~/i18n';

const LOCALE_OPTIONS: { value: Locale; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'th', label: 'ไทย' },
];

/**
 * Header language switcher. Surfaces locale selection at the top level instead
 * of burying it in Settings, so a Thai-speaking user can switch immediately.
 */
export function LanguageToggle() {
  const locale = useI18nStore((s) => s.locale);
  const setLocale = useI18nStore((s) => s.setLocale);

  return (
    <Menu position="bottom-end" withArrow shadow="md">
      <Menu.Target>
        <Tooltip label="Language / ภาษา">
          <ActionIcon variant="default" size="lg" aria-label="Change language">
            <TbLanguage size={18} />
          </ActionIcon>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        {LOCALE_OPTIONS.map((opt) => (
          <Menu.Item
            key={opt.value}
            onClick={() => setLocale(opt.value)}
            rightSection={locale === opt.value ? <TbCheck size={14} /> : null}
            fw={locale === opt.value ? 700 : 400}
          >
            {opt.label}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
