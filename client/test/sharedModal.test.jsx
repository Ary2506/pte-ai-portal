import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Modal } from "../src/components/common.jsx";

describe("shared Modal component", () => {
  it("renders a title, children, and an accessible dialog role", () => {
    render(<Modal onClose={() => {}} title="Example modal" ariaLabel="Example modal">
      <p>Body content</p>
    </Modal>);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-label", "Example modal");
    expect(screen.getByText("Example modal")).toBeInTheDocument();
    expect(screen.getByText("Body content")).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<Modal onClose={onClose} title="Example modal">Body</Modal>);
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the Escape key is pressed", () => {
    const onClose = vi.fn();
    render(<Modal onClose={onClose} title="Example modal">Body</Modal>);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the overlay background is clicked, but not when the panel itself is clicked", () => {
    const onClose = vi.fn();
    render(<Modal onClose={onClose} title="Example modal">
      <p>Body content</p>
    </Modal>);
    fireEvent.click(screen.getByText("Body content"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("dialog").parentElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders an optional footer as a modal-actions region", () => {
    render(<Modal onClose={() => {}} title="Example modal" footer={<button>Confirm</button>}>Body</Modal>);
    expect(screen.getByText("Confirm")).toBeInTheDocument();
    expect(screen.getByText("Confirm").closest(".modal-actions")).toBeInTheDocument();
  });

  it("applies an extra panel class name where given (e.g. detail-panel)", () => {
    render(<Modal onClose={() => {}} title="Example modal" panelClassName="detail-panel">Body</Modal>);
    expect(screen.getByRole("dialog")).toHaveClass("modal-panel", "detail-panel");
  });
});
