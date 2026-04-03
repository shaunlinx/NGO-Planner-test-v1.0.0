import React, { ReactNode, ErrorInfo } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

interface ErrorBoundaryProps {
  children?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

// Error Boundary to prevent white screen crashes
// Fix: Use React.Component explicitly to resolve TS member access errors for props and state
class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  // Fix: Explicit state property declaration and initialization for TypeScript recognition
  state: ErrorBoundaryState = {
    hasError: false,
    error: null
  };

  static getDerivedStateFromError(error: any): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: ErrorInfo) {
    console.error("React Error Boundary Caught:", error, errorInfo);
  }

  render() {
    // Fix: props and state are now correctly typed and accessible via this.state and this.props
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-red-50 p-6 text-center">
          <div className="bg-white p-8 rounded-xl shadow-xl border border-red-100 max-w-2xl w-full">
            <h2 className="text-2xl font-bold text-red-600 mb-4">应用遇到错误</h2>
            <p className="text-gray-600 mb-4">很抱歉，程序在渲染时崩溃了。这通常是由于依赖库加载冲突或配置错误导致的。</p>
            <div className="bg-gray-100 p-4 rounded text-left overflow-auto max-h-64 mb-6 border border-gray-200">
               <code className="text-xs font-mono text-red-800 break-words">
                 {/* Fix: Access error property on state instance */}
                 {this.state.error?.message || this.state.error?.toString() || '未知错误'}
               </code>
            </div>
            <button 
              onClick={() => {
                localStorage.clear();
                window.location.reload();
              }}
              className="px-6 py-2 bg-ngo-teal text-white rounded-lg hover:bg-ngo-teal-dark transition-colors font-bold shadow-md"
            >
              重置缓存并刷新
            </button>
          </div>
        </div>
      );
    }
    // Fix: Property 'props' is accessible from React.Component
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
