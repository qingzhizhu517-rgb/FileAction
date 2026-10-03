import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { FormalApp } from "./app/FormalApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <FormalApp />
  </StrictMode>,
);
