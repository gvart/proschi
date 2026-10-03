import {
  Copy,
  Clipboard,
  Trash2,
  ArrowUpToLine,
  ArrowDownToLine,
  Files,
} from 'lucide-react';
import type { ContextMenuItem } from './ContextMenu';

// Helper function to create common menu items
export const createNodeContextMenuItems = (
  selectedCount: number,
  hasClipboard: boolean,
  onCopy: () => void,
  onPaste: () => void,
  onDuplicate: () => void,
  onDelete: () => void,
  onBringToFront: () => void,
  onSendToBack: () => void
): ContextMenuItem[] => {
  return [
    {
      label: 'Copy',
      icon: <Copy className="w-4 h-4" />,
      onClick: onCopy,
      disabled: selectedCount === 0,
    },
    {
      label: 'Paste',
      icon: <Clipboard className="w-4 h-4" />,
      onClick: onPaste,
      disabled: !hasClipboard,
    },
    {
      label: 'Duplicate',
      icon: <Files className="w-4 h-4" />,
      onClick: onDuplicate,
      disabled: selectedCount === 0,
    },
    {
      label: 'Delete',
      icon: <Trash2 className="w-4 h-4" />,
      onClick: onDelete,
      disabled: selectedCount === 0,
      separator: true,
    },
    {
      label: 'Bring to Front',
      icon: <ArrowUpToLine className="w-4 h-4" />,
      onClick: onBringToFront,
      disabled: selectedCount === 0,
      separator: true,
    },
    {
      label: 'Send to Back',
      icon: <ArrowDownToLine className="w-4 h-4" />,
      onClick: onSendToBack,
      disabled: selectedCount === 0,
    },
  ];
};
