"use client";

import { Component, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  fallback?: ReactNode;
};

type State = {
  hasError: boolean;
  error: Error | null;
  errorInfo: { componentStack: string } | null;
};

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: { componentStack: string }) {
    console.error("Error caught by boundary:", error, errorInfo);
    this.setState({
      error,
      errorInfo
    });
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    });
  };

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="findec-error-boundary">
            <div className="findec-error-container">
              <h1 className="findec-error-title">⚠️ Something went wrong</h1>
              <p className="findec-error-message">
                An unexpected error occurred. Please try refreshing the page.
              </p>
              {this.state.error && process.env.NODE_ENV === "development" && (
                <details className="findec-error-details">
                  <summary>Error Details (Development Only)</summary>
                  <pre>{this.state.error.toString()}</pre>
                  {this.state.errorInfo && (
                    <pre>{this.state.errorInfo.componentStack}</pre>
                  )}
                </details>
              )}
              <button
                onClick={this.handleReset}
                className="findec-error-button"
              >
                Try Again
              </button>
            </div>
          </div>
        )
      );
    }

    return this.props.children;
  }
}
