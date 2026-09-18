/**
 * 模型编辑器教程
 *
 * 引导用户了解编辑器的核心功能。
 */

import * as React from 'react';
import { TutorialOverlay } from '../TutorialOverlay';

const STORAGE_KEY = 'tutorial_model_editor_completed';

const TUTORIAL_STEPS = [
  {
    target: '[data-testid="model-name-display"]',
    title: '模型名称',
    content: '双击可以重命名模型。名称会显示在项目列表和面包屑导航中。',
    position: 'bottom' as const,
  },
  {
    target: '.monaco-editor',
    title: 'SysML v2 编辑器',
    content: '在这里编写 SysML v2 语法。支持语法高亮、自动补全（输入 part def 等关键字试试）和实时验证。',
    position: 'left' as const,
  },
  {
    target: '.react-flow',
    title: '图形画布',
    content: '编辑器中的代码会实时渲染为图形视图。支持拖拽移动节点、双击重命名、Delete 键删除。',
    position: 'left' as const,
  },
  {
    target: '[data-testid="view-tab-structure"]',
    title: '视图模式切换',
    content: '切换不同视图模式：结构视图（Part/Port）、行为视图（状态机/活动图）、需求视图、参数视图。',
    position: 'bottom' as const,
  },
  {
    target: '[data-testid="toggle-comments"]',
    title: '评论功能',
    content: '点击打开评论面板，可以在模型上添加评论进行团队讨论。支持标记已解决。',
    position: 'bottom' as const,
  },
  {
    target: '[data-testid="export-diagram-png"]',
    title: '导出功能',
    content: '支持导出为 PNG/SVG 图表、JSON 数据、.sysml 原始文件。方便分享和归档。',
    position: 'bottom' as const,
  },
];

interface ModelEditorTutorialProps {
  forceShow?: boolean;
}

export const ModelEditorTutorial: React.FC<ModelEditorTutorialProps> = ({ forceShow }) => {
  const [show, setShow] = React.useState(false);

  React.useEffect(() => {
    if (forceShow) {
      setShow(true);
      return;
    }
    const completed = localStorage.getItem(STORAGE_KEY);
    if (!completed) {
      // 延迟 1 秒等待编辑器加载
      const timer = setTimeout(() => setShow(true), 1000);
      return () => clearTimeout(timer);
    }
  }, [forceShow]);

  const handleComplete = () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setShow(false);
  };

  const handleSkip = () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setShow(false);
  };

  if (!show) return null;

  return (
    <TutorialOverlay
      steps={TUTORIAL_STEPS}
      onComplete={handleComplete}
      onSkip={handleSkip}
    />
  );
};