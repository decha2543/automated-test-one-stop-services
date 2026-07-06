import { Button, Group, Modal, type ModalProps, Stack, Text } from '@mantine/core';
import type { ReactNode } from 'react';
import { useT } from '~/i18n/index.js';

interface FormModalProps {
  opened: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Submit button label. */
  submitLabel: ReactNode;
  onSubmit: () => void;
  submitDisabled?: boolean;
  loading?: boolean;
  /** Inline error shown above the footer (e.g. a mutation error message). */
  error?: string | null;
  size?: ModalProps['size'];
  scrollAreaComponent?: ModalProps['scrollAreaComponent'];
  submitColor?: string;
  children: ReactNode;
}

/**
 * Shared shell for create/edit form modals: one place for the header, body
 * spacing, inline error, and the Cancel / Submit footer. Put the form fields
 * in as children — the modal owns the chrome so every form looks and behaves
 * the same (replaces the copy-pasted Modal + footer + error block that each
 * form used to carry).
 */
export function FormModal({
  opened,
  onClose,
  title,
  submitLabel,
  onSubmit,
  submitDisabled,
  loading,
  error,
  size = 'md',
  scrollAreaComponent,
  submitColor,
  children,
}: FormModalProps) {
  const t = useT();
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={title}
      size={size}
      centered
      scrollAreaComponent={scrollAreaComponent}
    >
      <Stack gap="sm">
        {children}
        {error && (
          <Text size="sm" c="red">
            {error}
          </Text>
        )}
        <Group justify="flex-end" gap="xs">
          <Button variant="subtle" color="gray" size="xs" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            size="xs"
            color={submitColor}
            onClick={onSubmit}
            disabled={submitDisabled}
            loading={loading}
          >
            {submitLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
