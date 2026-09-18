/**
 * Error Boundary（M4.5 增量）。
 *
 * 捕获子组件树中的渲染错误，显示友好的错误 UI
 * 而不是白屏。支持重试和返回首页。
 */

import * as React from 'react';
import { AlertCircle, RotateCcw, Home } from 'lucide-react';
import { Button } from './ui/Button';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex min-h-[400px] flex-col items-center justify-center p-8 text-center">
          <AlertCircle className="mb-4 h-12 w-12 text-red-400" />
          <h2 className="text-lg font-semibold text-gray-900">
            页面出现错误
          </h2>
          <p className="mt-2 max-w-md text-sm text-gray-500">
            {this.state.error?.message ?? '发生了未知错误'}
          </p>
          <div className="mt-4 flex gap-2">
            <Button
              variant="secondary"
              onClick={this.handleReset}
            >
              <RotateCcw className="h-3.5 w-3.5" /> 重试
            </Button>
            <Button
              variant="secondary"
              onClick={() => (window.location.href = '/')}
            >
              <Home className="h-3.5 w-3.5" /> 返回首页
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
