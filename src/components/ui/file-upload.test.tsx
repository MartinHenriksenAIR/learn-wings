import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React, { useState } from 'react';

// --- mock api-client (upload-URL handshake) ---
const mockCallApi = vi.fn();
vi.mock('@/lib/api-client', () => ({
  callApi: (...args: unknown[]) => mockCallApi(...args),
}));

import { FileUpload } from './file-upload';

// Fake XHR that reports an immediately-successful PUT to Azure.
class FakeXHR {
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  status = 200;
  open() {}
  setRequestHeader() {}
  send() {
    queueMicrotask(() => this.onload?.());
  }
}

// Harness mirroring real consumers (CoursesManager): value state fed by onChange.
function Harness({ onChangeSpy }: { onChangeSpy: (url: string | null, path: string | null) => void }) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <FileUpload
      folder="thumbnails"
      accept="image"
      value={value}
      onChange={(url, path) => {
        onChangeSpy(url, path);
        setValue(url);
      }}
    />
  );
}

function uploadFile(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(['png-bytes'], 'pic.png', { type: 'image/png' });
  fireEvent.change(input, { target: { files: [file] } });
}

// jsdom does not implement these; capture whatever is really there so afterEach
// can restore it and the mocks can't leak into sibling files if test isolation
// is ever turned off.
const realCreateObjectURL = URL.createObjectURL;
const realRevokeObjectURL = URL.revokeObjectURL;

describe('FileUpload — image preview after upload (#158)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest);
    URL.createObjectURL = vi.fn(() => 'blob:preview-url');
    URL.revokeObjectURL = vi.fn();
    mockCallApi.mockResolvedValue({
      uploadUrl: 'https://acct.blob.core.windows.net/lms-assets/thumbnails/pic.png?sig=abc',
      blobPath: 'thumbnails/pic.png',
      contentType: 'image/png',
    });
  });

  afterEach(() => {
    // Unmount now, while the URL mocks are still installed, so components'
    // revoke-on-unmount cleanup runs against the mock rather than the restored
    // (jsdom-absent) original.
    cleanup();
    vi.unstubAllGlobals();
    URL.createObjectURL = realCreateObjectURL;
    URL.revokeObjectURL = realRevokeObjectURL;
  });

  it('shows a local object-URL preview, not the raw blob path', async () => {
    const onChangeSpy = vi.fn();
    const { container } = render(<Harness onChangeSpy={onChangeSpy} />);

    uploadFile(container);

    const img = await screen.findByRole('img');
    expect(img).toHaveAttribute('src', 'blob:preview-url');
  });

  it('still reports the raw blob path to onChange (persisted value unchanged)', async () => {
    const onChangeSpy = vi.fn();
    const { container } = render(<Harness onChangeSpy={onChangeSpy} />);

    uploadFile(container);

    await waitFor(() =>
      expect(onChangeSpy).toHaveBeenCalledWith('thumbnails/pic.png', 'thumbnails/pic.png')
    );
  });

  it('falls back to the value prop when there is no local preview (e.g. pre-signed URL from parent)', () => {
    render(
      <FileUpload
        accept="image"
        value="https://acct.blob.core.windows.net/lms-assets/thumbnails/existing.png?sig=live"
        onChange={vi.fn()}
      />
    );

    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      'https://acct.blob.core.windows.net/lms-assets/thumbnails/existing.png?sig=live'
    );
  });

  it('revokes the object URL when the file is removed', async () => {
    const onChangeSpy = vi.fn();
    const { container } = render(<Harness onChangeSpy={onChangeSpy} />);

    uploadFile(container);
    await screen.findByRole('img');

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-url'));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('does not create an object-URL preview for non-image uploads', async () => {
    mockCallApi.mockResolvedValue({
      uploadUrl: 'https://acct.blob.core.windows.net/lms-assets/docs/spec.pdf?sig=abc',
      blobPath: 'docs/spec.pdf',
      contentType: 'application/pdf',
    });

    function DocHarness() {
      const [value, setValue] = useState<string | null>(null);
      return (
        <FileUpload
          folder="docs"
          accept="document"
          value={value}
          onChange={(url) => setValue(url)}
        />
      );
    }

    const { container } = render(<DocHarness />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['pdf-bytes'], 'spec.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText('spec.pdf')).toBeInTheDocument());
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('revokes the stale preview once the parent value diverges (e.g. post-save re-sign)', async () => {
    const signedUrl = 'https://acct.blob.core.windows.net/lms-assets/thumbnails/pic.png?sig=signed';

    function ResignHarness() {
      const [value, setValue] = useState<string | null>(null);
      return (
        <>
          <FileUpload
            folder="thumbnails"
            accept="image"
            value={value}
            onChange={(url) => setValue(url)}
          />
          <button onClick={() => setValue(signedUrl)}>resign</button>
        </>
      );
    }

    const { container } = render(<ResignHarness />);
    uploadFile(container);

    expect(await screen.findByRole('img')).toHaveAttribute('src', 'blob:preview-url');

    // Simulate the parent swapping the raw blob path for a re-signed URL.
    fireEvent.click(screen.getByRole('button', { name: 'resign' }));

    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-url'));
    expect(screen.getByRole('img')).toHaveAttribute('src', signedUrl);
  });
});
