import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import WeaviateRagPanel from "../WeaviateRagPanel";

test("renders the Weaviate panel with accurate, repo-specific facts", () => {
  render(<WeaviateRagPanel isOpen onClose={() => {}} />);

  // Concept (default "What it is" tab)
  expect(screen.getAllByText(/vector/i).length).toBeGreaterThan(0);

  // EducationDrawer only renders the active tab's content, so switch to
  // "How it's wired here" to reach the repo-specific facts.
  fireEvent.click(screen.getByRole("tab", { name: /how it's wired here/i }));

  // Repo-specific truth: BYO vectors + nomic embedder + internal-only
  expect(screen.getAllByText(/bring your own vectors/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/nomic-embed-text/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/CodeChunk/).length).toBeGreaterThan(0);
  // Internal-only networking is a load-bearing, security-relevant claim: the
  // compose-DNS address renders in its own <code> node on the "here" tab.
  expect(screen.getAllByText(/weaviate:8080/).length).toBeGreaterThan(0);
});
