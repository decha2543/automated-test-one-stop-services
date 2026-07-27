import { modals } from '@mantine/modals';
import type { ReactNode } from 'react';
import { translate } from '~/i18n/index.js';

interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  isShowClose?: boolean;
  isShowCancel?: boolean;
  isCloseOnClickOutside?: boolean;
  isCloseOnEscape?: boolean;
}

/** Promise-based confirmation modal using Mantine. Returns true if user confirmed. */
export function confirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  cancelLabel,
  isShowClose = true,
  isShowCancel = true,
  isCloseOnClickOutside = true,
  isCloseOnEscape = true,
}: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    modals.openConfirmModal({
      title,
      children: message,
      labels: {
        confirm: confirmLabel ?? translate('common.confirm'),
        cancel: cancelLabel ?? translate('common.cancel'),
      },
      confirmProps: { color: danger ? 'red' : 'blue' },
      cancelProps: isShowClose ? {} : { style: { display: 'none' } },
      closeButtonProps: isShowCancel ? {} : { style: { display: 'none' } },
      closeOnClickOutside: isCloseOnClickOutside,
      closeOnEscape: isCloseOnEscape,
      centered: true,
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
      onClose: () => resolve(false),
    });
  });
}
