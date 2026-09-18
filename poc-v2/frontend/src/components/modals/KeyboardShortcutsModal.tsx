/**
 * 快捷键帮助 Modal（M4.5 增量）。
 *
 * 显示 ModelEditor 的所有可用键盘快捷键。
 */

import * as React from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

interface Shortcut {
  keys: string;
  description: string;
}

const SHORTCUTS: Shortcut[] = [
  { keys: 'Ctrl + S', description: '保存模型' },
  { keys: 'Ctrl + Space', description: '触发代码补全' },
  { keys: 'Ctrl + F', description: '搜索（Monaco 内置）' },
  { keys: 'Ctrl + H', description: '搜索并替换' },
  { keys: 'Ctrl + G', description: '跳转到行' },
  { keys: 'Ctrl + D', description: '选择下一个匹配项（多光标）' },
  { keys: 'Ctrl + /', description: '切换行注释' },
  { keys: 'Ctrl + Shift + K', description: '删除当前行' },
  { keys: 'Alt + Z', description: '切换自动换行' },
  { keys: 'Alt + M', description: '切换 minimap' },
  { keys: 'Ctrl + Shift + L', description: '切换行号显示' },
  { keys: 'Shift + Alt + F', description: '格式化文档' },
  { keys: '?', description: '打开快捷键帮助' },
];

interface KeyboardShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
  open,
  onClose,
}) => {
  return (
    <Modal
      open={open}
      onOpenChange={onClose}
      title="键盘快捷键"
      description="ModelEditor 可用的快捷键列表。"
      footer={
        <Button variant="secondary" onClick={onClose}>
          关闭
        </Button>
      }
    >
      <div className="space-y-2">
        {SHORTCUTS.map((s) => (
          <div
            key={s.keys}
            className="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2"
          >
            <span className="text-sm text-gray-700">{s.description}</span>
            <kbd className="rounded border border-gray-300 bg-gray-50 px-2 py-0.5 font-mono text-xs text-gray-600">
              {s.keys}
            </kbd>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-gray-400">
        Monaco Editor 还支持更多内置快捷键（Ctrl+Z 撤销、Ctrl+F 搜索等）。
      </p>
    </Modal>
  );
};
