import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";
import { api } from "../src/api.js";

vi.mock("../src/api.js", () => ({
  api: {
    auth: { signin: vi.fn(), me: vi.fn(), logout: vi.fn(() => Promise.resolve()) },
    admin: {
      getStats: vi.fn(), getAuditLog: vi.fn(), createUser: vi.fn(), listUsers: vi.fn(), getUser: vi.fn(),
      updateUser: vi.fn(), setStatus: vi.fn(), setSubscription: vi.fn(), renew: vi.fn(), resetPassword: vi.fn(), revokeSessions: vi.fn()
    },
    dashboard: vi.fn(), plan: vi.fn(), questions: vi.fn(), history: vi.fn(), submit: vi.fn(), retryEvaluation: vi.fn(),
    testSessions: { start: vi.fn(), get: vi.fn(), complete: vi.fn(), list: vi.fn() }
  }
}));

function studentAuthUser() { return { role: "student", name: "Student", username: "pte001" }; }
function renderAt(path, user) {
  localStorage.setItem("pte_token", "test-token");
  localStorage.setItem("pte_user", JSON.stringify(user));
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

// Mirrors exactly what was inserted into MongoDB (title/imageUrl/answer), copied verbatim from
// the client-supplied pte_describe_images.json — Describe Image is MongoDB-backed like every
// other Speaking type except Read Aloud, so (like the existing Reading/Writing tests) this test
// mocks the API response rather than importing a repo-local JSON file.
const DESCRIBE_IMAGE_QUESTIONS = [
  { _id: "di6", section: "speaking", type: "describe-image", title: "Describe Image 6", prompt: "Look at the image below. In 25 seconds, please speak into the microphone and describe in detail what the image is showing.", imageUrl: "/question-images/describe-image/describe_image_01.jpg", answer: "The following graph gives information about the average rainfall in inches in New York, Dallas, Phoenix, and Honolulu. As we can see from the graph, New York has the largest amount, 47.25 inches, next to Dallas, 33.70 inches. When we look at the other two cities, they are significantly smaller than the first two, with Phoenix amounting to 7.66 and Honolulu, 22.02. In conclusion, the average rainfalls in the cities are largely affected by geographic locations.", evaluationType: "subjective" },
  { _id: "di7", section: "speaking", type: "describe-image", title: "Describe Image 7", prompt: "Look at the image below. In 25 seconds, please speak into the microphone and describe in detail what the image is showing.", imageUrl: "/question-images/describe-image/describe_image_02.jpg", answer: "The following picture gives information about instant coffee. You can see from this graph that hot water is poured from a kettle into the cup. What's more, a packet of instant coffee is added into the cup. Then, the third step is that creamer from a sachet is poured into the cup. After that, sugar is added and a spoon stirs the coffee until everything dissolves evenly. Finally, the coffee is ready and is enjoyed by drinking. To sum up, this graph tells about how coffee is processed.", evaluationType: "subjective" },
  { _id: "di8", section: "speaking", type: "describe-image", title: "Describe Image 8", prompt: "Look at the image below. In 25 seconds, please speak into the microphone and describe in detail what the image is showing.", imageUrl: "/question-images/describe-image/describe_image_03.jpg", answer: "The following picture gives information about shopping in a stationery store. In the left half of the picture we can see a white woman in pink sweater with her daughter in the arms. The mother and the daughter look at each other with smiles in their faces. And the daughter holds a new bag in the hand. In the right half of the picture the daughter carries the bag on the back. Also, she holds six colorful pencils in the hands in front of the chest. To sum up, this picture tells about how the two shop for stationery.", evaluationType: "subjective" },
  { _id: "di9", section: "speaking", type: "describe-image", title: "Describe Image 9", prompt: "Look at the image below. In 25 seconds, please speak into the microphone and describe in detail what the image is showing.", imageUrl: "/question-images/describe-image/describe_image_04.jpg", answer: "The following picture gives information about the number of US households keeping pets. According to the graph, I notice cats are forty-two point seven million. The value of dogs is higher, about sixty-three point four million. From the bar chart, we can see the highest one is for total, eighty-four point nine million. The lowest number is for horses and saltwater fish, which is one point six million. In the bar chart there are also other items, including freshwater fish and birds. In conclusion, this bar chart tells about US households keeping pets.", evaluationType: "subjective" },
  { _id: "di10", section: "speaking", type: "describe-image", title: "Describe Image 10", prompt: "Look at the image below. In 25 seconds, please speak into the microphone and describe in detail what the image is showing.", imageUrl: "/question-images/describe-image/describe_image_05.jpg", answer: "The following picture gives information about the numbers of cat owners in different countries. According to the graph, I notice the percentage of Italy is forty percent. The value of the United States is higher, about forty-three percent. From the bar chart, we can see the highest one is in Russia, fifty-nine percent. The lowest number is South Korea, which is nine percent. In the bar chart there are also other countries, including Turkey and Germany. In conclusion, this bar chart tells about cat owners in countries.", evaluationType: "subjective" },
  { _id: "di11", section: "speaking", type: "describe-image", title: "Describe Image 11", prompt: "Look at the image below. In 25 seconds, please speak into the microphone and describe in detail what the image is showing.", imageUrl: "/question-images/describe-image/describe_image_06.jpg", answer: "This pie chart gives information about travel time to work in Ontario. From the picture we can see thirty to forty-four minutes, the value is twenty-one percent. In less than fifteen minutes the proportion is higher, which is twenty-four percent. The highest number is fifteen to twenty-nine minutes, around thirty-two percent. And the lowest percentage is in forty-five to fifty-nine minutes, just 10 percent. To sum up, the graph tells about travel time to work in Ontario.", evaluationType: "subjective" },
  { _id: "di12", section: "speaking", type: "describe-image", title: "Describe Image 12", prompt: "Look at the image below. In 25 seconds, please speak into the microphone and describe in detail what the image is showing.", imageUrl: "/question-images/describe-image/describe_image_07.jpg", answer: "This bar chart tells about how many tourists visit Canada each year. From the picture we can see, in 2022 the number is twelve point eight million. In 2023 the value is higher, eighteen point three million. And the greatest quantity is in 2019, which is twenty-two point one million. But the smallest one is in 2020, only three million, followed by that in 2021, just three point one million. To sum up, the picture tells only about the numbers of visitors to Canada.", evaluationType: "subjective" },
  { _id: "di13", section: "speaking", type: "describe-image", title: "Describe Image 13", prompt: "Look at the image below. In 25 seconds, please speak into the microphone and describe in detail what the image is showing.", imageUrl: "/question-images/describe-image/describe_image_08.jpg", answer: "This chart gives information about average weekly household spending on goods and services. From the picture we can see transportation, the value is nearly two hundred. In food and non-alcoholic beverages the number is higher, which is two hundred and forty. The highest point is in current housing costs, around two hundred and seventy. And the lowest one is in tobacco products, just twenty. Other items include personal care and alcoholic beverages. To sum up, the graph tells about weekly household spending.", evaluationType: "subjective" }
];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.history.mockResolvedValue({ submissions: [] });
  global.navigator.mediaDevices = {
    getUserMedia: vi.fn(() => Promise.resolve({ getTracks: () => [{ stop: vi.fn() }] }))
  };
});

describe("Describe Image — all 8 client-supplied questions, image/answer mapping preserved", () => {
  it("lists all 8 questions from the API response (count is data-driven, not hardcoded)", async () => {
    api.questions.mockResolvedValue({ questions: DESCRIBE_IMAGE_QUESTIONS });
    renderAt("/speaking?type=describe-image", studentAuthUser());
    for (const q of DESCRIBE_IMAGE_QUESTIONS) await screen.findByText(q.title);
    expect(screen.getAllByRole("button", { name: /Describe Image \d+/ }).length).toBe(8);
  });

  it.each(DESCRIBE_IMAGE_QUESTIONS.map((q, i) => [i, q]))(
    "question %i: the correct image loads and its Show Answer reveals the exact, matching answer text",
    async (_i, target) => {
      api.questions.mockResolvedValue({ questions: DESCRIBE_IMAGE_QUESTIONS });
      renderAt("/speaking?type=describe-image", studentAuthUser());
      fireEvent.click(await screen.findByText(target.title));

      const img = await screen.findByRole("img", { name: target.title });
      expect(img).toHaveAttribute("src", target.imageUrl);

      expect(screen.getByText("Show Answer")).toBeInTheDocument();
      expect(screen.queryByText(target.answer)).not.toBeInTheDocument(); // hidden until clicked

      fireEvent.click(screen.getByText("Show Answer"));
      expect(await screen.findByText("Hide Answer")).toBeInTheDocument();
      expect(screen.getByText(target.answer)).toBeInTheDocument(); // exact text, unmodified

      fireEvent.click(screen.getByText("Hide Answer"));
      expect(screen.queryByText(target.answer)).not.toBeInTheDocument();
    }
  );
});

describe("Show Answer stays specific to Describe Image", () => {
  it("does not appear for Repeat Sentence, an unrelated Speaking type", async () => {
    api.questions.mockResolvedValue({
      questions: [{ _id: "rs1", section: "speaking", type: "repeat-sentence", title: "Repeat Sentence", prompt: "Repeat this.", evaluationType: "subjective" }]
    });
    renderAt("/speaking?type=repeat-sentence", studentAuthUser());
    await screen.findByText("Repeat Sentence", { selector: "h2" });
    expect(screen.queryByText("Show Answer")).not.toBeInTheDocument();
  });

  it("does not appear for a describe-image question that happens to have no stored answer", async () => {
    api.questions.mockResolvedValue({
      questions: [{ _id: "di-legacy", section: "speaking", type: "describe-image", title: "Legacy Image", prompt: "Describe it.", imageUrl: "https://example.com/old.png", evaluationType: "subjective" }]
    });
    renderAt("/speaking?type=describe-image", studentAuthUser());
    await screen.findByText("Legacy Image", { selector: "h2" });
    expect(screen.queryByText("Show Answer")).not.toBeInTheDocument();
  });
});
