import { describe, it, expect } from "vitest";
import { validateDescribeImageQuestions } from "../src/validateDescribeImageContent.js";

// Exercises the exact same pure validation function runDescribeImageValidation() uses against
// the real database (see server/src/validateDescribeImageContent.js) — a passing test here is
// real evidence the live check behaves the same way, without needing the test suite to touch the
// real (non-test) database.
function localQuestion(overrides = {}) {
  return {
    _id: "q1", title: "Describe Image 6", imageUrl: "/question-images/describe-image/describe_image_01.jpg",
    answer: "A real model answer.", ...overrides
  };
}
const imageAlwaysExists = () => true;
const imageNeverExists = () => false;

describe("validateDescribeImageQuestions", () => {
  it("passes a well-formed local question with a unique image and a real answer", () => {
    const report = validateDescribeImageQuestions([localQuestion()], imageAlwaysExists);
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
  });

  it("fails when a local image file does not exist on disk", () => {
    const report = validateDescribeImageQuestions([localQuestion()], imageNeverExists);
    expect(report.ok).toBe(false);
    expect(report.errors[0]).toMatch(/local image file not found/);
  });

  it("fails when a local Describe Image question has no answer", () => {
    const report = validateDescribeImageQuestions([localQuestion({ answer: "" })], imageAlwaysExists);
    expect(report.ok).toBe(false);
    expect(report.errors[0]).toMatch(/missing its model answer/);
  });

  it("fails when a question has no imageUrl at all", () => {
    const report = validateDescribeImageQuestions([localQuestion({ imageUrl: "" })], imageAlwaysExists);
    expect(report.ok).toBe(false);
    expect(report.errors[0]).toMatch(/missing imageUrl/);
  });

  it("fails when two different questions share the same imageUrl (mapping must be unique)", () => {
    const report = validateDescribeImageQuestions([
      localQuestion({ _id: "q1", title: "Describe Image 6" }),
      localQuestion({ _id: "q2", title: "Describe Image 7" }) // same imageUrl as q1 by default
    ], imageAlwaysExists);
    expect(report.ok).toBe(false);
    expect(report.errors[0]).toMatch(/Duplicate imageUrl/);
  });

  it("only warns (never errors) on a non-local, externally-hosted question with no stored answer — pre-existing content, never invented", () => {
    const report = validateDescribeImageQuestions([
      localQuestion({ _id: "legacy1", title: "Describe Image 1 — Rainfall Bar Chart", imageUrl: "https://cdn.example.com/chart.png", answer: undefined })
    ], imageAlwaysExists);
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.warnings[0]).toMatch(/no model answer configured/);
  });

  it("validates a full realistic bank (5 legacy externally-hosted + 8 local) with zero errors", () => {
    const legacy = Array.from({ length: 5 }, (_, i) => localQuestion({
      _id: `legacy${i}`, title: `Describe Image ${i + 1}`, imageUrl: `https://cdn.example.com/img${i}.png`, answer: undefined
    }));
    const local = Array.from({ length: 8 }, (_, i) => localQuestion({
      _id: `local${i}`, title: `Describe Image ${i + 6}`,
      imageUrl: `/question-images/describe-image/describe_image_0${i + 1}.jpg`,
      answer: `Model answer number ${i + 1}.`
    }));
    const report = validateDescribeImageQuestions([...legacy, ...local], imageAlwaysExists);
    expect(report.ok).toBe(true);
    expect(report.checked).toBe(13);
    expect(report.warnings.length).toBe(5);
  });
});
