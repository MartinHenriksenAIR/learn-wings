import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

import { ErrorBoundary } from "./ErrorBoundary";
import "@/i18n";

function Boom(): React.ReactElement {
  throw new Error("kaboom");
}

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

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload page" })).toBeInTheDocument();
    expect(console.error).toHaveBeenCalled();
  });

  it("renders children untouched when they do not throw", () => {
    render(
      <ErrorBoundary>
        <p>All good</p>
      </ErrorBoundary>
    );

    expect(screen.getByText("All good")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).toBeNull();
  });
});
