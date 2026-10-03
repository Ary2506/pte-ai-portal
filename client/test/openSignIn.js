import { screen, fireEvent } from "@testing-library/react";

// Signing in used to be the whole signed-out page. It is a sheet opened from the landing page's
// "Sign in" button now, so a test that drives the login form has to open it first. Everything
// these tests actually assert — the fields, the policy notice, the error slot, the post-login
// routing — is unchanged; only the step that reveals the form is new.
//
// The landing page renders two "Sign in"/"Start practicing" triggers; the nav one is used here
// because it is present no matter how far the page has been scrolled.
export function openSignIn() {
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  return screen.findByRole("dialog");
}
