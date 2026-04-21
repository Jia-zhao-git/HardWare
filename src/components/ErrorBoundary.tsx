import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * 错误边界组件
 * 捕获子组件树中的 JavaScript 错误，并显示备用 UI
 */
export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('未捕获的错误:', error, errorInfo)
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  public render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div
            style={{
              padding: '24px',
              background: 'var(--bg-card)',
              border: '1px solid var(--accent-error)',
              borderRadius: '8px',
              textAlign: 'center',
            }}
          >
            <h3 style={{ color: 'var(--accent-error)', marginBottom: '12px' }}>
              ⚠️ 出现错误
            </h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', fontSize: '13px' }}>
              {this.state.error?.message || '未知错误'}
            </p>
            <button
              onClick={this.handleReset}
              style={{
                padding: '8px 16px',
                background: 'var(--accent-primary)',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              重试
            </button>
          </div>
        )
      )
    }

    return this.props.children
  }
}
