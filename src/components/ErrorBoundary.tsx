import { Component, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
  onReset?: () => void
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
    this.props.onReset?.()
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div role="alert" className="rounded-xl border border-danger/30 bg-danger-subtle p-6 text-center">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-danger" aria-hidden />
          <h2 className="mb-1 text-base font-semibold text-fg">Something went wrong</h2>
          <p className="mb-4 text-sm text-fg-secondary">
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            type="button"
            onClick={this.handleReset}
            className="h-9 rounded-md border border-border-strong bg-surface px-4 text-sm font-medium text-fg hover:bg-surface-muted"
          >
            Try again
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
