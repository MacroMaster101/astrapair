import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BirthDetailsForm } from "./birth-details-form";

vi.mock("../actions", () => ({
  saveBirthDetails: vi.fn(async () => ({})),
}));

function renderForm() {
  render(
    <BirthDetailsForm
      today="2026-09-29"
      defaults={{
        displayName: "Test",
        birthDate: "1990-01-01",
        birthTime: "",
        accuracy: "exact",
        place: null,
      }}
    />,
  );
  return screen.getByLabelText("Birth time") as HTMLInputElement;
}

describe("BirthDetailsForm birth time", () => {
  afterEach(cleanup);

  it("keeps the typed time when the accuracy changes", () => {
    const time = renderForm();
    fireEvent.change(time, { target: { value: "14:30" } });
    expect(time.value).toBe("14:30");

    fireEvent.click(screen.getByLabelText(/About this time/));
    expect(time.value).toBe("14:30");

    fireEvent.click(screen.getByLabelText(/I don't know/));
    expect(time.disabled).toBe(true);

    fireEvent.click(screen.getByLabelText(/Exact/));
    expect(time.disabled).toBe(false);
    expect(time.value).toBe("14:30");
  });
});
