import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthenticatedApp } from "@/components/AuthenticatedApp";
import "@/app/globals.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Kořenový element aplikace nebyl nalezen.");
}

createRoot(root).render(
  <StrictMode>
    <AuthenticatedApp />
  </StrictMode>,
);
