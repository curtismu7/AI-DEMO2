import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ShadowAiDetectorPage from "../ShadowAiDetectorPage";

test("Shadow AI Detector page explains the observed signals and limits", () => {
  render(
    <MemoryRouter>
      <ShadowAiDetectorPage />
    </MemoryRouter>,
  );

  expect(screen.getByRole("heading", { name: /Shadow AI Detector/i })).toBeInTheDocument();
  expect(screen.getByText(/AI sites and API traffic/i)).toBeInTheDocument();
  expect(screen.getByText(/All-site access, tabs, web requests, downloads, extension management/)).toBeInTheDocument();
  expect(screen.getByText(/event metadata such as URLs, domains, scopes, counts, file names, and risk scores/i)).toBeInTheDocument();
  expect(screen.getByText(/does not determine whether an agent is malicious/i)).toBeInTheDocument();
});
