import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const indexFolderFiles = vi.fn();
const fileA = { name: "a.js" };
const fileB = { name: "b.js" };

vi.mock("../../services/codeSearchAPI", () => ({
  FOLDER_MAX_FILE_BYTES: 262144,
  FOLDER_MAX_FILES: 2000,
  filterFolderFiles: () => ({ accepted: [fileA, fileB], skipped: 0 }),
  planFolderIndex: () => ({
    mode: "pieces",
    rootName: "mono",
    groups: new Map([
      ["pkg-a", [fileA]],
      ["pkg-b", [fileB]],
    ]),
  }),
  indexFolderFiles: (...args) => indexFolderFiles(...args),
}));
vi.mock("../../services/spinnerService", () => ({
  spinner: { show: vi.fn(), hide: vi.fn() },
}));
vi.mock("../../utils/appToast", () => ({
  notifyError: vi.fn(),
  notifyWarning: vi.fn(),
}));

import CodebaseUploader from "../CodebaseUploader";

// Board E5: the "index each package separately?" question was a native
// window.confirm, which demo_api_ui/CLAUDE.md bans. It is a ConfirmModal now.
describe("CodebaseUploader — split-into-packages prompt", () => {
  let confirmSpy;

  beforeEach(() => {
    indexFolderFiles.mockReset().mockResolvedValue({ files_indexed: 1 });
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  const pickFolder = (container) => {
    const input = container.querySelector('input[type="file"][webkitdirectory]');
    fireEvent.change(input, { target: { files: [fileA, fileB] } });
  };

  it("asks in a modal, not window.confirm, and splits when confirmed", async () => {
    const onFolderIndexed = vi.fn();
    const { container } = render(<CodebaseUploader onFolderIndexed={onFolderIndexed} />);
    pickFolder(container);

    fireEvent.click(await screen.findByRole("button", { name: "Split into pieces" }));

    await waitFor(() => expect(indexFolderFiles).toHaveBeenCalledTimes(2));
    expect(indexFolderFiles.mock.calls.map((c) => c[1])).toEqual(["pkg-a", "pkg-b"]);
    expect(onFolderIndexed).toHaveBeenCalledTimes(2);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("indexes everything as one codebase when the modal is declined", async () => {
    const { container } = render(<CodebaseUploader />);
    pickFolder(container);

    fireEvent.click(await screen.findByRole("button", { name: "Index as one codebase" }));

    await waitFor(() => expect(indexFolderFiles).toHaveBeenCalledTimes(1));
    expect(indexFolderFiles.mock.calls[0][1]).toBe("mono");
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
