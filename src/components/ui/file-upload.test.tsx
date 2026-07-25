import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React, { useState } from 'react';

import en from '@/i18n/locales/en.json';
import da from '@/i18n/locales/da.json';
import '@/i18n';

// --- mock api-client (upload-URL handshake) ---
const mockCallApi = vi.fn();
vi.mock('@/lib/api-client', () => ({
  callApi: (...args: unknown[]) => mockCallApi(...args),
}));

import { FileUpload } from './file-upload';

/** Resolve a locale string the way the component's `t()` call does. */
function line(template: string, values: Record<string, string | number> = {}) {
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
    template,
  );
}

// The bytes matter: the downscaler sniffs the magic number and refuses to
// re-encode a file whose content disagrees with its declared type, so a test
// file full of ASCII would never reach the decoder at all.
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngFile(name = 'pic.png', bytes = 4096): File {
  const data = new Uint8Array(bytes);
  data.set(PNG_MAGIC, 0);
  return new File([data], name, { type: 'image/png' });
}

/** A PNG that reports `sizeMB` without allocating it. */
function sizedPng(name: string, sizeMB: number): File {
  const file = pngFile(name);
  Object.defineProperty(file, 'size', { value: sizeMB * 1024 * 1024 });
  return file;
}

/** A File that reports `sizeMB` without allocating it. */
function sizedFile(name: string, type: string, sizeMB: number): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: sizeMB * 1024 * 1024 });
  return file;
}

// Records the body handed to the PUT, so tests can assert exactly which bytes
// were uploaded (the original File vs. a downscaled re-encode).
let lastSentBody: unknown = null;

// Fake XHR that reports an immediately-successful PUT to Azure.
class FakeXHR {
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  status = 200;
  open() {}
  setRequestHeader() {}
  send(body?: unknown) {
    lastSentBody = body;
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

function selectFile(container: HTMLElement, file: File) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  return input;
}

function uploadFile(container: HTMLElement) {
  selectFile(container, pngFile());
}

// jsdom does not implement these; capture whatever is really there so afterEach
// can restore it and the mocks can't leak into sibling files if test isolation
// is ever turned off.
const realCreateObjectURL = URL.createObjectURL;
const realRevokeObjectURL = URL.revokeObjectURL;

// Every user-facing string this component and its two siblings render. Danish
// users saw a half-translated dialog before #278's follow-up: a correctly-Danish
// hint from the page sitting directly above English copy from the component.
const FILE_UPLOAD_KEYS = Object.keys(en.fileUpload) as Array<keyof typeof en.fileUpload>;

describe('fileUpload i18n keys', () => {
  it.each(FILE_UPLOAD_KEYS)('defines "fileUpload.%s" in both en and da', (key) => {
    expect(typeof en.fileUpload[key]).toBe('string');
    expect(en.fileUpload[key].length).toBeGreaterThan(0);
    expect(typeof da.fileUpload[key]).toBe('string');
    expect(da.fileUpload[key].length).toBeGreaterThan(0);
  });

  it('keeps every interpolation placeholder in the Danish text', () => {
    for (const key of FILE_UPLOAD_KEYS) {
      const placeholders = en.fileUpload[key].match(/\{\{\w+\}\}/g) ?? [];
      for (const placeholder of placeholders) {
        expect(da.fileUpload[key]).toContain(placeholder);
      }
    }
  });
});

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
    selectFile(container, new File(['pdf-bytes'], 'spec.pdf', { type: 'application/pdf' }));

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

// The re-encode itself is exercised in src/lib/image-downscale.test.ts, which
// stubs getContext/toBlob on the prototype. What these pin is the CONTRACT the
// component depends on: however the downscale declines or fails, the original
// bytes still reach Azure and the user is told nothing went wrong.
describe('FileUpload — image downscale before upload (#278)', () => {
  const realCreateImageBitmap = globalThis.createImageBitmap;

  beforeEach(() => {
    vi.clearAllMocks();
    lastSentBody = null;
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
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    URL.createObjectURL = realCreateObjectURL;
    URL.revokeObjectURL = realRevokeObjectURL;
    globalThis.createImageBitmap = realCreateImageBitmap;
  });

  /** Selects `file` on the component's hidden input and waits for the PUT. */
  async function uploadAndCaptureBody(container: HTMLElement, file: File) {
    selectFile(container, file);
    await waitFor(() => expect(lastSentBody).not.toBeNull());
    return lastSentBody;
  }

  it('uploads a non-image file untouched (never processed)', async () => {
    mockCallApi.mockResolvedValue({
      uploadUrl: 'https://acct.blob.core.windows.net/lms-assets/docs/spec.pdf?sig=abc',
      blobPath: 'docs/spec.pdf',
      contentType: 'application/pdf',
    });

    const { container } = render(
      <FileUpload folder="docs" accept="document" value={null} onChange={vi.fn()} />
    );
    const pdf = new File(['pdf-bytes'], 'spec.pdf', { type: 'application/pdf' });

    expect(await uploadAndCaptureBody(container, pdf)).toBe(pdf);
  });

  it('uploads the original, and reports success, when the browser cannot decode images', async () => {
    // jsdom's default: no createImageBitmap at all.
    expect(typeof globalThis.createImageBitmap).not.toBe('function');
    const onChangeSpy = vi.fn();

    const { container } = render(<Harness onChangeSpy={onChangeSpy} />);
    const png = pngFile();

    expect(await uploadAndCaptureBody(container, png)).toBe(png);
    // Failing open means exactly this: the user never learns it happened.
    await waitFor(() => expect(onChangeSpy).toHaveBeenCalledWith('thumbnails/pic.png', 'thumbnails/pic.png'));
    expect(screen.queryByText(en.fileUpload.errorUploadFailed)).not.toBeInTheDocument();
  });

  it('uploads the original, and reports success, when the image fails to decode', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.reject(new Error('corrupt image')))
    );
    const onChangeSpy = vi.fn();

    const { container } = render(<Harness onChangeSpy={onChangeSpy} />);
    const png = pngFile();

    expect(await uploadAndCaptureBody(container, png)).toBe(png);
    await waitFor(() => expect(onChangeSpy).toHaveBeenCalledWith('thumbnails/pic.png', 'thumbnails/pic.png'));
    expect(screen.queryByText(en.fileUpload.errorUploadFailed)).not.toBeInTheDocument();
  });

  it('uploads the original untouched when the image is already under the cap', async () => {
    const close = vi.fn();
    const createImageBitmap = vi.fn((_source: ImageBitmapSource, options?: ImageBitmapOptions) => {
      // An engine that supports `imageOrientation` reads it during WebIDL
      // dictionary conversion; one that does not, never touches it.
      void options?.imageOrientation;
      return Promise.resolve({ width: 800, height: 600, close } as unknown as ImageBitmap);
    });
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    // If this ever reached the canvas it would throw in jsdom, not silently pass.
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');

    const { container } = render(<Harness onChangeSpy={vi.fn()} />);
    const png = pngFile();

    expect(await uploadAndCaptureBody(container, png)).toBe(png);
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    // Decoded with EXIF orientation applied, so a rotated photo is not made worse.
    expect(createImageBitmap.mock.calls[0][1]?.imageOrientation).toBe('from-image');
    expect(getContext).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it('fails open and uploads the original when the canvas 2D context is unavailable', async () => {
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn((_source: ImageBitmapSource, options?: ImageBitmapOptions) => {
        void options?.imageOrientation;
        return Promise.resolve({ width: 4000, height: 3000, close } as unknown as ImageBitmap);
      })
    );
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(() => null);

    const { container } = render(<Harness onChangeSpy={vi.fn()} />);
    const png = pngFile();

    expect(await uploadAndCaptureBody(container, png)).toBe(png);
    expect(getContext).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it('never decodes a file whose bytes disagree with its name (PNG called .jpg)', async () => {
    const createImageBitmap = vi.fn();
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    mockCallApi.mockResolvedValue({
      uploadUrl: 'https://acct.blob.core.windows.net/lms-assets/branding/logo.jpg?sig=abc',
      blobPath: 'branding/logo.jpg',
      contentType: 'image/jpeg',
    });

    const { container } = render(
      <FileUpload assetType="org-logo" accept="image" value={null} onChange={vi.fn()} />
    );
    // A transparent PNG that someone renamed by hand: `File.type` says JPEG
    // because the browser reads the extension, not the bytes.
    const data = new Uint8Array(4096);
    data.set(PNG_MAGIC, 0);
    const mislabelled = new File([data], 'logo.jpg', { type: 'image/jpeg' });

    expect(await uploadAndCaptureBody(container, mislabelled)).toBe(mislabelled);
    expect(createImageBitmap).not.toHaveBeenCalled();
  });
});

// The cap used to be applied to the file the user PICKED, before downscaling —
// so a 20 MB photo with a 10 MB cap was refused outright rather than shrunk to a
// few hundred KB and accepted, undercutting the whole point of #278. It is now
// applied to the bytes that will actually be PUT, with a separate, larger
// ceiling guarding the decoder itself.
describe('FileUpload — size cap vs. downscale ordering (#276)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastSentBody = null;
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
    cleanup();
    vi.unstubAllGlobals();
    URL.createObjectURL = realCreateObjectURL;
    URL.revokeObjectURL = realRevokeObjectURL;
  });

  it('does not refuse an over-cap image on selection — the payload check answers instead', async () => {
    // jsdom has no createImageBitmap, so the downscale fails open and the
    // ORIGINAL bytes reach the payload check — which then applies the cap. What
    // this pins is the ordering: the file was not refused on selection, and the
    // message the user gets is the payload-cap one, not the decode-ceiling one.
    const { container } = render(
      <FileUpload accept="image" maxSizeMB={10} value={null} onChange={vi.fn()} />
    );
    selectFile(container, sizedPng('big.png', 15));

    expect(
      await screen.findByText(line(en.fileUpload.errorTooLarge, { size: '10 MB' }))
    ).toBeInTheDocument();
    // No SAS URL minted and no bytes sent — the bail costs the user nothing.
    expect(mockCallApi).not.toHaveBeenCalled();
    expect(lastSentBody).toBeNull();
  });

  it('rejects an image too large to decode without ever calling the upload API', async () => {
    const { container } = render(
      <FileUpload accept="image" maxSizeMB={10} value={null} onChange={vi.fn()} />
    );
    selectFile(container, sizedPng('enormous.png', 500));

    expect(
      await screen.findByText(line(en.fileUpload.errorTooLargeToDecode, { size: '20 MB' }))
    ).toBeInTheDocument();
    expect(mockCallApi).not.toHaveBeenCalled();
  });

  it('uploads an image that is within the cap', async () => {
    const { container } = render(
      <FileUpload accept="image" maxSizeMB={10} value={null} onChange={vi.fn()} />
    );
    const png = sizedPng('small.png', 4);
    selectFile(container, png);

    await waitFor(() => expect(lastSentBody).toBe(png));
  });

  it('applies the cap directly to a document — nothing is ever downscaled there', async () => {
    mockCallApi.mockResolvedValue({
      uploadUrl: 'https://acct.blob.core.windows.net/lms-assets/docs/spec.pdf?sig=abc',
      blobPath: 'docs/spec.pdf',
      contentType: 'application/pdf',
    });

    const { container } = render(
      <FileUpload accept="document" value={null} onChange={vi.fn()} />
    );
    selectFile(container, sizedFile('huge.pdf', 'application/pdf', 150));

    expect(
      await screen.findByText(line(en.fileUpload.errorTooLarge, { size: '100 MB' }))
    ).toBeInTheDocument();
    expect(mockCallApi).not.toHaveBeenCalled();
  });

  it('clamps a call site that asks for more than the server cap', async () => {
    // 50 MB was the old default; the server would 413 anything over 10 MB.
    const { container } = render(
      <FileUpload accept="image" maxSizeMB={50} value={null} onChange={vi.fn()} />
    );
    selectFile(container, sizedPng('big.png', 15));

    expect(
      await screen.findByText(line(en.fileUpload.errorTooLarge, { size: '10 MB' }))
    ).toBeInTheDocument();
  });

  it('clears the input after a rejected selection, so the same file can be re-picked', async () => {
    const { container } = render(
      <FileUpload accept="image" maxSizeMB={10} value={null} onChange={vi.fn()} />
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;

    // Watch WRITES rather than reading `input.value` afterwards: fireEvent sets
    // `files` and never `value`, so a plain `expect(input.value).toBe('')` reads
    // '' whether or not the component ever cleared anything.
    const writes: string[] = [];
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => (writes.length ? writes[writes.length - 1] : 'C:\\fakepath\\enormous.png'),
      set: (next: string) => void writes.push(next),
    });

    fireEvent.change(input, { target: { files: [sizedPng('enormous.png', 500)] } });

    await screen.findByText(line(en.fileUpload.errorTooLargeToDecode, { size: '20 MB' }));
    // A `change` event only fires when the value changes; leaving the rejected
    // file in place makes re-picking it silently do nothing.
    expect(writes).toContain('');
  });
});

// Since #275 a persisted null DELETES the superseded blob, so "the upload failed"
// and "the user cleared the field" can no longer collapse into the same signal:
// the first must leave the parent's value alone, only the second may report null.
describe('FileUpload — a failed upload must not clear the stored value', () => {
  const SIGNED_VALUE = 'https://acct.blob.core.windows.net/lms-assets/thumbnails/live.png?sig=live';

  beforeEach(() => {
    vi.clearAllMocks();
    lastSentBody = null;
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('reports nothing to the parent when the upload fails, keeping the live value', async () => {
    mockCallApi.mockRejectedValue(new Error('mint failed'));
    const onChange = vi.fn();

    const { container } = render(
      <FileUpload accept="image" value={SIGNED_VALUE} onChange={onChange} />
    );
    selectFile(container, pngFile());

    expect(await screen.findByText(en.fileUpload.errorUploadFailed)).toBeInTheDocument();
    // Nothing was stored, so the value the parent holds still names a live blob.
    // Reporting (null, null) here is what let a dropped connection turn into a
    // `deleteBlob` of the image the retry was meant to replace.
    expect(onChange).not.toHaveBeenCalled();
    // And the existing image stays on screen rather than reverting to the dropzone.
    expect(screen.getByRole('img')).toHaveAttribute('src', SIGNED_VALUE);
    expect(lastSentBody).toBeNull();
  });

  it('still reports (null, null) when the user removes the file', () => {
    const onChange = vi.fn();
    render(<FileUpload accept="image" value={SIGNED_VALUE} onChange={onChange} />);

    // The only button in the image tile is the remove (X) control.
    fireEvent.click(screen.getByRole('button'));

    expect(onChange).toHaveBeenCalledWith(null, null);
  });
});

describe('FileUpload — dropzone copy and type gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastSentBody = null;
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest);
    mockCallApi.mockResolvedValue({
      uploadUrl: 'https://acct.blob.core.windows.net/lms-assets/thumbnails/pic.png?sig=abc',
      blobPath: 'thumbnails/pic.png',
      contentType: 'image/png',
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('advertises the effective cap, not the raw prop', () => {
    render(<FileUpload accept="image" maxSizeMB={50} value={null} onChange={vi.fn()} />);
    expect(
      screen.getByText(new RegExp(line(en.fileUpload.maxSize, { size: '10 MB' })))
    ).toBeInTheDocument();
  });

  it('describes the resize as the dimension cap it actually is', () => {
    // The old copy promised "larger images are resized automatically", which the
    // very next line then contradicted: a small-but-heavy PNG under the edge cap
    // is not resized at all, and is refused by the cap printed beside it.
    render(<FileUpload accept="image" assetType="avatar" maxSizeMB={2} value={null} onChange={vi.fn()} />);

    expect(
      screen.getByText(new RegExp(line(en.fileUpload.imageResizeHint, { maxEdge: 512 })))
    ).toBeInTheDocument();
    expect(screen.queryByText(/resized automatically/)).not.toBeInTheDocument();
  });

  it('states the thumbnail edge cap at a call site with no assetType', () => {
    render(<FileUpload accept="image" value={null} onChange={vi.fn()} />);
    expect(
      screen.getByText(new RegExp(line(en.fileUpload.imageResizeHint, { maxEdge: 1280 })))
    ).toBeInTheDocument();
  });

  it('makes no resize promise where nothing is ever resized', () => {
    render(<FileUpload accept="document" value={null} onChange={vi.fn()} />);
    expect(screen.getByText(new RegExp(line(en.fileUpload.maxSize, { size: '100 MB' })))).toBeInTheDocument();
    expect(screen.queryByText(/px/)).not.toBeInTheDocument();
  });

  it('offers only formats the server will mint a URL for', () => {
    const { container } = render(<FileUpload accept="video" value={null} onChange={vi.fn()} />);
    const accept = container.querySelector('input[type="file"]')!.getAttribute('accept')!;

    expect(accept).not.toContain('video/*');
    expect(accept).toContain('.mp4');
  });

  it('refuses an off-list file by name, instead of letting the server answer "File type not allowed"', async () => {
    const { container } = render(<FileUpload accept="image" value={null} onChange={vi.fn()} />);
    selectFile(container, new File(['x'], 'diagram.svg', { type: 'image/svg+xml' }));

    expect(await screen.findByText(en.fileUpload.errorTypeImage)).toBeInTheDocument();
    expect(mockCallApi).not.toHaveBeenCalled();
    expect(lastSentBody).toBeNull();
  });
});
