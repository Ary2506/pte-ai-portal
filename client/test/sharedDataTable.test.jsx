import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataTable } from "../src/components/common.jsx";

const COLUMNS = [
  { key: "name", header: "Name", render: r => r.name },
  { key: "status", header: "Status", render: r => r.status }
];
const ROWS = [
  { id: "1", name: "Alpha", status: "Active" },
  { id: "2", name: "Beta", status: "Inactive" }
];

describe("shared DataTable component", () => {
  it("shows a loading skeleton and no table while loading", () => {
    const { container } = render(<DataTable columns={COLUMNS} rows={[]} rowKey={r => r.id} loading emptyText="none"/>);
    expect(container.querySelector("table")).not.toBeInTheDocument();
    expect(container.querySelector(".skeleton")).toBeInTheDocument();
  });

  it("shows the empty state when there are no rows and it is not loading", () => {
    render(<DataTable columns={COLUMNS} rows={[]} rowKey={r => r.id} loading={false} emptyText="No results match these filters."/>);
    expect(screen.getByText("No results match these filters.")).toBeInTheDocument();
  });

  it("renders a real table with headers and row data via each column's render function", () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={r => r.id} loading={false}/>);
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("writes a data-label on every cell matching its column header, for the CSS-only mobile card fallback", () => {
    const { container } = render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={r => r.id} loading={false}/>);
    const cells = container.querySelectorAll("td");
    expect(cells.length).toBe(4);
    cells.forEach(cell => {
      expect(["Name", "Status"]).toContain(cell.getAttribute("data-label"));
    });
  });

  it("renders pagination controls and calls onPrevious/onNext, respecting bounds", () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={r => r.id} loading={false}
      pagination={{ page: 2, totalPages: 3, total: 25, itemLabel: "items", onPrevious, onNext }}/>);
    expect(screen.getByText("Page 2 of 3 · 25 items")).toBeInTheDocument();
    const previous = screen.getByText("‹ Previous");
    const next = screen.getByText("Next ›");
    expect(previous).not.toBeDisabled();
    expect(next).not.toBeDisabled();
    previous.click();
    next.click();
    expect(onPrevious).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("disables Previous on the first page and Next on the last page", () => {
    const { rerender } = render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={r => r.id} loading={false}
      pagination={{ page: 1, totalPages: 3, total: 25, itemLabel: "items", onPrevious: () => {}, onNext: () => {} }}/>);
    expect(screen.getByText("‹ Previous")).toBeDisabled();
    expect(screen.getByText("Next ›")).not.toBeDisabled();

    rerender(<DataTable columns={COLUMNS} rows={ROWS} rowKey={r => r.id} loading={false}
      pagination={{ page: 3, totalPages: 3, total: 25, itemLabel: "items", onPrevious: () => {}, onNext: () => {} }}/>);
    expect(screen.getByText("‹ Previous")).not.toBeDisabled();
    expect(screen.getByText("Next ›")).toBeDisabled();
  });

  it("renders no pagination controls when none are given", () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={r => r.id} loading={false}/>);
    expect(screen.queryByText("‹ Previous")).not.toBeInTheDocument();
  });
});
