import { Button, Modal, Stack, Text, TextInput } from '@mantine/core';
import { useState } from 'react';
import { TbUser } from 'react-icons/tb';
import { useHubUser, useSaveHubUser } from '~/hooks/useHubUser.js';
import { useT } from '~/i18n/index.js';

/**
 * First-run identity prompt.
 *
 * Every test-case edit stamps an "Edited By" name, so the Hub needs one before
 * the first edit can be attributed. Asking once on first open — rather than
 * mid-edit — keeps that out of the way afterwards. Deliberately not dismissible:
 * there is no useful state where the answer is "no name".
 */
export function UserNameGate() {
  const t = useT();
  const { user, isLoading } = useHubUser();
  const save = useSaveHubUser();
  const [name, setName] = useState('');
  const trimmed = name.trim();

  // Stay closed while the query is in flight — flashing a blocking modal at
  // someone who already has a name would be worse than a moment of nothing.
  const opened = !isLoading && !user;

  return (
    <Modal
      opened={opened}
      onClose={() => {
        /* not dismissible — a name is required */
      }}
      title={t('user.welcomeTitle')}
      centered
      withCloseButton={false}
      closeOnClickOutside={false}
      closeOnEscape={false}
      size="sm"
    >
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          {t('user.welcomeDesc')}
        </Text>
        <TextInput
          label={t('user.name')}
          placeholder={t('user.namePlaceholder')}
          leftSection={<TbUser size={14} />}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && trimmed) save.mutate(trimmed);
          }}
          error={save.error ? save.error.message : null}
          data-autofocus
        />
        <Button
          onClick={() => save.mutate(trimmed)}
          disabled={!trimmed}
          loading={save.isPending}
          fullWidth
        >
          {t('user.saveName')}
        </Button>
      </Stack>
    </Modal>
  );
}
