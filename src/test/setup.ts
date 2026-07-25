import "@testing-library/jest-dom";

// jsdom has no ResizeObserver; components (e.g. SlidingTabs) use it for re-measuring.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = window.ResizeObserver ?? (ResizeObserverStub as unknown as typeof ResizeObserver);

// jsdom 20 ships no Blob.prototype.arrayBuffer, so any code that reads a file's
// bytes (the image downscaler sniffs the first 32 for a magic number) is
// unreachable in tests without this. jsdom DOES implement FileReader, so the
// polyfill is the real thing rather than a stub with invented behaviour.
if (typeof Blob.prototype.arrayBuffer !== "function") {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
