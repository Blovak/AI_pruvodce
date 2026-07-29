import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GuideApp } from "@/components/GuideApp";
import "@/app/globals.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Kořenový element aplikace nebyl nalezen.");
}

createRoot(root).render(
  <StrictMode>
    <GuideApp />
  </StrictMode>,
);
