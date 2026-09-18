/**
 * SysML v2 语法参考面板
 *
 * 显示支持的 SysML v2 语法参考，帮助用户快速查找语法。
 */

import * as React from 'react';
import { BookOpen, Search, ChevronDown, ChevronRight, Copy } from 'lucide-react';
import { cn } from '../lib/utils';
import { useToast } from './ui/Toast';

interface SyntaxItem {
  keyword: string;
  description: string;
  example: string;
  category: string;
}

const SYNTAX_ITEMS: SyntaxItem[] = [
  // 结构建模
  {
    keyword: 'package',
    description: '包定义 — 组织模型元素的命名空间',
    example: 'package Vehicles {\n  // 元素定义\n}',
    category: '结构建模',
  },
  {
    keyword: 'part def',
    description: '部件定义 — 定义系统组件的类型',
    example: 'part def Engine {\n  attribute power : Real = 150.0;\n  port exhaust : ExhaustPort;\n}',
    category: '结构建模',
  },
  {
    keyword: 'part',
    description: '部件用法 — 实例化部件类型',
    example: 'part engine : Engine;',
    category: '结构建模',
  },
  {
    keyword: 'port def',
    description: '端口定义 — 定义组件间的交互点',
    example: 'port def PowerPort {\n  attribute voltage : Real;\n  attribute current : Real;\n}',
    category: '结构建模',
  },
  {
    keyword: 'port',
    description: '端口用法 — 声明端口实例',
    example: 'port powerIn : PowerPort;',
    category: '结构建模',
  },
  {
    keyword: 'attribute',
    description: '属性定义 — 声明组件的属性',
    example: 'attribute mass : Real = 10.0;',
    category: '结构建模',
  },
  {
    keyword: 'connect',
    description: '连接语句 — 建立端口间的连接',
    example: 'connect engine.exhaust to transmission.input;',
    category: '结构建模',
  },
  {
    keyword: 'import',
    description: '导入语句 — 引入其他包的元素',
    example: 'import Foundations::*;',
    category: '结构建模',
  },
  // 行为建模
  {
    keyword: 'state machine',
    description: '状态机定义 — 描述组件的状态转换',
    example: 'state machine EngineSM {\n  initial state Off;\n  state Running;\n  final state Failed;\n\n  transition Off to Running [start];\n  transition Running to Off [stop];\n}',
    category: '行为建模',
  },
  {
    keyword: 'activity',
    description: '活动定义 — 描述行为流程',
    example: 'activity ProductionFlow {\n  initial action Scan;\n  action Process;\n  final action Complete;\n\n  flow Scan to Process;\n  flow Process to Complete;\n}',
    category: '行为建模',
  },
  {
    keyword: 'transition',
    description: '状态转换 — 连接两个状态',
    example: 'transition Idle to Running [start];',
    category: '行为建模',
  },
  {
    keyword: 'flow',
    description: '控制流 — 连接两个动作',
    example: 'flow ActionA to ActionB [condition];',
    category: '行为建模',
  },
  // 需求与约束
  {
    keyword: 'requirement def',
    description: '需求定义 — 声明系统需求',
    example: 'requirement def MaxSpeed (REQ-001) {最高速度 ≥ 200 km/h};',
    category: '需求与约束',
  },
  {
    keyword: 'satisfy',
    description: '满足追溯 — 标记元素满足某需求',
    example: 'satisfy Engine by REQ-001;',
    category: '需求与约束',
  },
  {
    keyword: 'verify',
    description: '验证追溯 — 标记元素验证某需求',
    example: 'verify TestResult by REQ-001;',
    category: '需求与约束',
  },
  {
    keyword: 'constraint def',
    description: '约束块定义 — 声明参数化约束',
    example: 'constraint def MassLimit {\n  attribute maxMass : Real;\n}',
    category: '需求与约束',
  },
  // 扩展语法
  {
    keyword: 'enum def',
    description: '枚举定义 — 声明枚举类型',
    example: 'enum def Color {\n  Red;\n  Green;\n  Blue;\n}',
    category: '扩展语法',
  },
  {
    keyword: 'comment',
    description: '注释块 — 为元素添加文档注释',
    example: 'comment 这是一个关键组件 about Engine;',
    category: '扩展语法',
  },
];

const CATEGORIES = ['结构建模', '行为建模', '需求与约束', '扩展语法'];

interface SyntaxReferenceProps {
  open: boolean;
  onClose: () => void;
}

export const SyntaxReference: React.FC<SyntaxReferenceProps> = ({ open, onClose }) => {
  const { showToast } = useToast();
  const [search, setSearch] = React.useState('');
  const [expandedCategories, setExpandedCategories] = React.useState<Set<string>>(
    new Set(CATEGORIES)
  );

  const filtered = React.useMemo(() => {
    if (!search) return SYNTAX_ITEMS;
    const q = search.toLowerCase();
    return SYNTAX_ITEMS.filter(
      (item) =>
        item.keyword.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q)
    );
  }, [search]);

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast({ title: '已复制', variant: 'success' });
    } catch {
      // silent
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-2xl rounded-lg bg-white shadow-xl">
        {/* 标题 */}
        <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3">
          <BookOpen className="h-5 w-5 text-gray-500" />
          <h2 className="text-base font-semibold text-gray-900">SysML v2 语法参考</h2>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100"
          >
            ✕
          </button>
        </div>

        {/* 搜索 */}
        <div className="border-b border-gray-100 px-4 py-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索语法..."
              className="w-full rounded-md border border-gray-300 py-1.5 pl-8 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              autoFocus
            />
          </div>
        </div>

        {/* 内容 */}
        <div className="max-h-[60vh] overflow-auto p-4">
          {CATEGORIES.map((cat) => {
            const items = filtered.filter((i) => i.category === cat);
            if (items.length === 0) return null;
            const isExpanded = expandedCategories.has(cat);

            return (
              <div key={cat} className="mb-4">
                <button
                  onClick={() => toggleCategory(cat)}
                  className="flex w-full items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-gray-900"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  {cat}
                  <span className="text-xs text-gray-400">({items.length})</span>
                </button>

                {isExpanded && (
                  <div className="mt-2 space-y-3 pl-6">
                    {items.map((item) => (
                      <div
                        key={item.keyword}
                        className="rounded-md border border-gray-200 p-3"
                      >
                        <div className="flex items-center justify-between">
                          <code className="rounded bg-blue-50 px-2 py-0.5 text-sm font-semibold text-blue-700">
                            {item.keyword}
                          </code>
                          <button
                            onClick={() => void handleCopy(item.example)}
                            className="rounded p-1 text-gray-400 hover:bg-gray-100"
                            title="复制示例"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <p className="mt-1 text-xs text-gray-600">
                          {item.description}
                        </p>
                        <pre className="mt-2 rounded bg-gray-50 p-2 text-xs text-gray-800">
                          {item.example}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};