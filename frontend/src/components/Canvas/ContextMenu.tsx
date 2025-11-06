import React, { useEffect, useRef } from 'react';
import {
  Copy,
  Clipboard,
  Trash2,
  ArrowUpToLine,
  ArrowDownToLine,
  Files,
} from 'lucide-react';

export interface ContextMenuItem {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  separator?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Adjust position if menu would go off screen
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewport = {
        width: window.innerWidth,
        height: window.innerHeight,
      };

      let adjustedX = x;
      let adjustedY = y;

      if (rect.right > viewport.width) {
        adjustedX = viewport.width - rect.width - 10;
      }

      if (rect.bottom > viewport.height) {
        adjustedY = viewport.height - rect.height - 10;
      }

      if (adjustedX !== x || adjustedY !== y) {
        menuRef.current.style.left = `${adjustedX}px`;
        menuRef.current.style.top = `${adjustedY}px`;
      }
    }
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[200px]"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, index) => (
        <React.Fragment key={index}>
          {item.separator && (
            <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
          )}
          <button
            className={`w-full flex items-center gap-3 px-4 py-2 text-sm text-left ${
              item.disabled
                ? 'text-gray-400 cursor-not-allowed'
                : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
            onClick={() => {
              if (!item.disabled) {
                item.onClick();
                onClose();
              }
            }}
            disabled={item.disabled}
          >
            <span className="w-4 h-4 flex items-center justify-center">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        </React.Fragment>
      ))}
    </div>
  );
};

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
