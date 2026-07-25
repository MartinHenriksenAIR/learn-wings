import { Component, type ErrorInfo, type ReactNode } from "react";
import i18n from "@/i18n";
import { Button } from "@/components/ui/button";

// Match Login/NotFound's soft slate canvas + centered card chrome.
const PAGE_GRADIENT_CLASSES = "bg-[linear-gradient(180deg,#f4f5f8_0%,#e9ecf4_100%)]";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Top-level React error boundary. React 18 unmounts the entire root on an
 * uncaught render/lifecycle error, so without a boundary one bad render blanks
 * the whole app with no message and no recovery path. This catches the error,
 * logs it for diagnostics, and renders a branded "something went wrong" card
 * with a reload button.
 *
 * A class component is required (only class components can be error boundaries).
 * It reads copy from the i18next instance directly (i18n.t) rather than the
 * useTranslation hook: the error may originate in a provider above this
 * boundary, so React context can't be relied on — but i18next is initialized
 * module-level (src/i18n) and its instance works regardless of React context.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error in React tree:", error, errorInfo);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className={`grid min-h-screen place-items-center ${PAGE_GRADIENT_CLASSES} px-4`}>
        <div className="flex w-full max-w-[420px] flex-col items-center gap-4 rounded-[20px] border border-border bg-card px-10 py-11 text-center shadow-[0_24px_60px_rgba(16,41,143,0.10)]">
          <h1 className="text-[17px] font-bold text-foreground">{i18n.t("errorBoundary.title")}</h1>
          <p className="text-balance text-sm leading-[1.55] text-muted-foreground">
            {i18n.t("errorBoundary.description")}
          </p>
          <Button size="sm" onClick={() => window.location.reload()}>
            {i18n.t("errorBoundary.reload")}
          </Button>
        </div>
      </div>
    );
  }
}
