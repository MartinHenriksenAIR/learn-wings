import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

import en from "@/i18n/locales/en.json";
import da from "@/i18n/locales/da.json";
import { ErrorBoundary } from "./ErrorBoundary";
import "@/i18n";

function Boom(): React.ReactElement {
  throw new Error("kaboom");
}

// The boundary reads copy from i18next by key; assert against the locale JSON
// (not hardcoded English) and check en/da parity so a missing Danish key for
// title/description/reload can't ship silently.
const ERROR_BOUNDARY_KEYS = ["title", "description", "reload"] as const;

describe("errorBoundary i18n keys", () => {
  it.each(ERROR_BOUNDARY_KEYS)('defines "errorBoundary.%s" in both en and da', (key) => {
    expect(typeof en.errorBoundary[key]).toBe("string");
    expect(en.errorBoundary[key].length).toBeGreaterThan(0);
    expect(typeof da.errorBoundary[key]).toBe("string");
    expect(da.errorBoundary[key].length).toBeGreaterThan(0);
  });
});

describe("ErrorBoundary", () => {
  beforeEach(() => {
    // The boundary console.errors the caught error; React also logs the
    // uncaught error itself. Silence both so the test output stays clean.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the fallback with a reload button when a child throws", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );

    expect(screen.getByText(en.errorBoundary.title)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: en.errorBoundary.reload })
    ).toBeInTheDocument();
    expect(console.error).toHaveBeenCalled();
  });

  it("renders children untouched when they do not throw", () => {
    render(
      <ErrorBoundary>
        <p>All good</p>
      </ErrorBoundary>
    );

    expect(screen.getByText("All good")).toBeInTheDocument();
    expect(screen.queryByText(en.errorBoundary.title)).toBeNull();
  });
});
