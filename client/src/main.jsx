import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { AppErrorBoundary } from "./components/ErrorBoundary.jsx";
import "./styles.css";

// Outermost boundary. A render error anywhere that the per-route boundary does not catch -- in the
// layout, the toast host, the auth gate -- would otherwise unmount the whole tree and leave a blank
// page with no way back.
createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <BrowserRouter><App /></BrowserRouter>
    </AppErrorBoundary>
  </React.StrictMode>
);
