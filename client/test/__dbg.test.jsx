import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";
import { api } from "../src/api.js";
vi.mock("../src/api.js", () => ({
  api: { auth:{signin:vi.fn(),me:vi.fn(),logout:vi.fn(()=>Promise.resolve())},
    admin:{getStats:vi.fn(),getAuditLog:vi.fn(),listUsers:vi.fn()},
    dashboard:vi.fn(),plan:vi.fn(),questions:vi.fn(),questionIndex:vi.fn(()=>Promise.resolve({questions:[]})),
    history:vi.fn(),submit:vi.fn(),retryEvaluation:vi.fn(),
    testSessions:{start:vi.fn(),get:vi.fn(),complete:vi.fn(),list:vi.fn()} }, forceLogout: vi.fn()
}));
beforeEach(()=>{ vi.clearAllMocks(); localStorage.clear();
  api.dashboard.mockResolvedValue({stats:{overall:0,practiceCount:0,streak:0,targetScore:79},bySection:[],recent:[]});
});
it("debug save", async () => {
  api.testSessions.start.mockResolvedValue({
    testSession:{_id:"ts1",status:"IN_PROGRESS",totalQuestions:2,expiresAt:new Date(Date.now()+1200000).toISOString()},
    questions:[0,1].map(i=>({_id:`q${i}`,section:"reading",type:"mcq-single",title:`Reading Q${i+1}`,prompt:"Choose.",options:["A","B"],evaluationType:"objective"}))
  });
  localStorage.setItem("pte_token","t");
  localStorage.setItem("pte_user",JSON.stringify({role:"student",name:"S",username:"pte001"}));
  render(<MemoryRouter initialEntries={["/mock"]}><App/></MemoryRouter>);
  fireEvent.click(await screen.findByText("Start Mock Test"));
  await screen.findByText("Reading Q1");
  console.log("SAVE BUTTON PRESENT:", !!screen.queryByRole("button",{name:"Save"}));
  fireEvent.click(screen.getAllByText("A")[0]);
  console.log("checked after click:", screen.getAllByText("A")[0].closest("label").querySelector("input").checked);
  fireEvent.click(screen.getByRole("button",{name:"Save"}));
  await waitFor(()=>{}, {timeout:50}).catch(()=>{});
  console.log("storage:", localStorage.getItem("pte_mock_drafts_ts1"));
  fireEvent.click(screen.getByText("Next"));
  await screen.findByText("Reading Q2");
  fireEvent.click(screen.getByText("Previous"));
  await screen.findByText("Reading Q1");
  await new Promise(r => setTimeout(r, 50));
  const input = screen.getAllByText("A")[0].closest("label").querySelector("input");
  console.log("after back - checked:", input.checked, "disabled:", input.disabled);
  console.log("save button still there:", !!screen.queryByRole("button",{name:"Save"}));
});
