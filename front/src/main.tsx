import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { FormalApp } from "./app/FormalApp";
import "./features/workspace/reading-workspace.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <FormalApp />
  </StrictMode>,
);
