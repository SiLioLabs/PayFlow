import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AddressBook from "../components/AddressBook";

// ─── Test constants ───────────────────────────────────────────────────────────

// Deterministic valid Stellar Ed25519 public keys (verified via StrKey.isValidEd25519PublicKey)
const VALID_ADDRESS_1 = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const VALID_ADDRESS_2 = "GCXO7NWYDZJGGZZIZK3VJLMY276XKV5ZOONULFCRUBCCOCVX5F5M36CR";

// Default props factory
function makeProps(overrides: Partial<React.ComponentProps<typeof AddressBook>> = {}) {
  return {
    onSelect: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Seed localStorage with pre-existing address book entries before rendering. */
function seedStorage(entries: { name: string; address: string }[]) {
  window.localStorage.setItem("flowpay_address_book", JSON.stringify(entries));
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  window.localStorage.clear();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("AddressBook", () => {
  // ── Rendering ──────────────────────────────────────────────────────────────

  it("renders the modal with title and search input", () => {
    render(<AddressBook {...makeProps()} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Address Book")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search by name or address/i)).toBeInTheDocument();
  });

  it("shows empty state when no entries exist", () => {
    render(<AddressBook {...makeProps()} />);
    expect(screen.getByText(/no saved addresses yet/i)).toBeInTheDocument();
  });

  it("renders existing entries loaded from localStorage", () => {
    seedStorage([{ name: "Alice", address: VALID_ADDRESS_1 }]);
    render(<AddressBook {...makeProps()} />);

    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  // ── Add entry ──────────────────────────────────────────────────────────────

  it("adds a new entry when name and valid address are provided", async () => {
    const user = userEvent.setup();
    render(<AddressBook {...makeProps()} />);

    await user.type(screen.getByLabelText(/new entry name/i), "Bob");
    await user.type(screen.getByLabelText(/new entry stellar address/i), VALID_ADDRESS_1);
    await user.click(screen.getByRole("button", { name: /add address book entry/i }));

    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.queryByText(/no saved addresses yet/i)).not.toBeInTheDocument();
  });

  it("persists the new entry to localStorage after adding", async () => {
    const user = userEvent.setup();
    render(<AddressBook {...makeProps()} />);

    await user.type(screen.getByLabelText(/new entry name/i), "Carol");
    await user.type(screen.getByLabelText(/new entry stellar address/i), VALID_ADDRESS_1);
    await user.click(screen.getByRole("button", { name: /add address book entry/i }));

    const stored = JSON.parse(window.localStorage.getItem("flowpay_address_book") ?? "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toEqual({ name: "Carol", address: VALID_ADDRESS_1 });
  });

  it("shows validation error when name is empty on add", async () => {
    const user = userEvent.setup();
    render(<AddressBook {...makeProps()} />);

    await user.type(screen.getByLabelText(/new entry stellar address/i), VALID_ADDRESS_1);
    await user.click(screen.getByRole("button", { name: /add address book entry/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(/name is required/i);
  });

  it("shows validation error when address is empty on add", async () => {
    const user = userEvent.setup();
    render(<AddressBook {...makeProps()} />);

    await user.type(screen.getByLabelText(/new entry name/i), "Dave");
    await user.click(screen.getByRole("button", { name: /add address book entry/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(/address is required/i);
  });

  it("shows validation error for invalid Stellar address", async () => {
    const user = userEvent.setup();
    render(<AddressBook {...makeProps()} />);

    await user.type(screen.getByLabelText(/new entry name/i), "Eve");
    await user.type(screen.getByLabelText(/new entry stellar address/i), "notastellaraddress");
    await user.click(screen.getByRole("button", { name: /add address book entry/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(/invalid stellar address/i);
  });

  it("clears the add-form fields after a successful add", async () => {
    const user = userEvent.setup();
    render(<AddressBook {...makeProps()} />);

    const nameInput = screen.getByLabelText(/new entry name/i);
    const addrInput = screen.getByLabelText(/new entry stellar address/i);

    await user.type(nameInput, "Frank");
    await user.type(addrInput, VALID_ADDRESS_1);
    await user.click(screen.getByRole("button", { name: /add address book entry/i }));

    expect(nameInput).toHaveValue("");
    expect(addrInput).toHaveValue("");
  });

  it("adds entry on Enter key press in the address field", async () => {
    const user = userEvent.setup();
    render(<AddressBook {...makeProps()} />);

    const nameInput = screen.getByLabelText(/new entry name/i);
    const addrInput = screen.getByLabelText(/new entry stellar address/i);

    await user.type(nameInput, "Grace");
    await user.type(addrInput, VALID_ADDRESS_1);
    await user.keyboard("{Enter}");

    expect(screen.getByText("Grace")).toBeInTheDocument();
  });

  // ── Select populates form ──────────────────────────────────────────────────

  it("calls onSelect with the address and onClose when Select is clicked", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    seedStorage([{ name: "Alice", address: VALID_ADDRESS_1 }]);

    const user = userEvent.setup();
    render(<AddressBook onSelect={onSelect} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: /select alice/i }));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(VALID_ADDRESS_1);
    expect(onClose).toHaveBeenCalledOnce();
  });

  // ── Delete with confirm ────────────────────────────────────────────────────

  it("shows a confirmation modal when Delete is clicked", async () => {
    seedStorage([{ name: "Alice", address: VALID_ADDRESS_1 }]);
    const user = userEvent.setup();
    render(<AddressBook {...makeProps()} />);

    await user.click(screen.getByRole("button", { name: /delete alice/i }));

    // Both AddressBook dialog and ConfirmModal dialog are present
    const dialogs = screen.getAllByRole("dialog");
    expect(dialogs.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/delete "alice"/i)).toBeInTheDocument();
  });

  it("removes the entry after confirming deletion", async () => {
    seedStorage([{ name: "Alice", address: VALID_ADDRESS_1 }]);
    const user = userEvent.setup();
    render(<AddressBook {...makeProps()} />);

    await user.click(screen.getByRole("button", { name: /delete alice/i }));
    await user.click(screen.getByRole("button", { name: /^confirm$/i }));

    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    expect(screen.getByText(/no saved addresses yet/i)).toBeInTheDocument();
  });

  it("does not remove entry when deletion is cancelled", async () => {
    seedStorage([{ name: "Alice", address: VALID_ADDRESS_1 }]);
    const user = userEvent.setup();
    render(<AddressBook {...makeProps()} />);

    await user.click(screen.getByRole("button", { name: /delete alice/i }));
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("updates localStorage after deletion is confirmed", async () => {
    seedStorage([
      { name: "Alice", address: VALID_ADDRESS_1 },
      { name: "Bob", address: VALID_ADDRESS_2 },
    ]);
    const user = userEvent.setup();
    render(<AddressBook {...makeProps()} />);

    await user.click(screen.getByRole("button", { name: /delete alice/i }));
    await user.click(screen.getByRole("button", { name: /^confirm$/i }));

    const stored = JSON.parse(window.localStorage.getItem("flowpay_address_book") ?? "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe("Bob");
  });

  // ── Search / filter ────────────────────────────────────────────────────────

  it("filters entries by name when user types in search", async () => {
    seedStorage([
      { name: "Alice", address: VALID_ADDRESS_1 },
      { name: "Bob", address: VALID_ADDRESS_2 },
    ]);
    const user = userEvent.setup();
    render(<AddressBook {...makeProps()} />);

    await user.type(screen.getByPlaceholderText(/search by name or address/i), "ali");

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
  });

  it("shows no-results message when filter matches nothing", async () => {
    seedStorage([{ name: "Alice", address: VALID_ADDRESS_1 }]);
    const user = userEvent.setup();
    render(<AddressBook {...makeProps()} />);

    await user.type(screen.getByPlaceholderText(/search by name or address/i), "zzznomatch");

    expect(screen.getByText(/no results match your search/i)).toBeInTheDocument();
  });

  it("filters entries by address substring", async () => {
    seedStorage([
      { name: "Alice", address: VALID_ADDRESS_1 },
      { name: "Bob", address: VALID_ADDRESS_2 },
    ]);
    const user = userEvent.setup();
    render(<AddressBook {...makeProps()} />);

    // Search by a unique fragment of VALID_ADDRESS_1
    await user.type(
      screen.getByPlaceholderText(/search by name or address/i),
      VALID_ADDRESS_1.slice(0, 6)
    );

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
  });

  // ── Close behaviour ────────────────────────────────────────────────────────

  it("calls onClose when close button is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AddressBook {...makeProps({ onClose })} />);

    await user.click(screen.getByRole("button", { name: /close address book/i }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when overlay is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AddressBook {...makeProps({ onClose })} />);

    // The overlay is the outermost div with role="presentation"
    const overlay = screen.getByRole("presentation");
    await user.click(overlay);

    expect(onClose).toHaveBeenCalledOnce();
  });

  // ── Export button state ────────────────────────────────────────────────────

  it("disables Export JSON button when address book is empty", () => {
    render(<AddressBook {...makeProps()} />);

    const exportBtn = screen.getByRole("button", { name: /export address book as json/i });
    expect(exportBtn).toBeDisabled();
  });

  it("enables Export JSON button when entries exist", () => {
    seedStorage([{ name: "Alice", address: VALID_ADDRESS_1 }]);
    render(<AddressBook {...makeProps()} />);

    const exportBtn = screen.getByRole("button", { name: /export address book as json/i });
    expect(exportBtn).not.toBeDisabled();
  });

  // ── Import JSON ────────────────────────────────────────────────────────────

  it("imports valid entries from a JSON file", async () => {
    const user = userEvent.setup();
    render(<AddressBook {...makeProps()} />);

    const importData = JSON.stringify([{ name: "Imported", address: VALID_ADDRESS_1 }]);
    const file = new File([importData], "test.json", { type: "application/json" });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);

    expect(await screen.findByText("Imported")).toBeInTheDocument();
  });

  it("shows error status when importing an invalid JSON file", async () => {
    const user = userEvent.setup();
    render(<AddressBook {...makeProps()} />);

    const file = new File(["not valid json {{{"], "bad.json", { type: "application/json" });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);

    expect(await screen.findByRole("status")).toHaveTextContent(/invalid json/i);
  });

  it("skips invalid entries and imports only valid ones", async () => {
    const user = userEvent.setup();
    render(<AddressBook {...makeProps()} />);

    const importData = JSON.stringify([
      { name: "Good", address: VALID_ADDRESS_1 },
      { name: "Bad", address: "NOTVALID" },
    ]);
    const file = new File([importData], "mixed.json", { type: "application/json" });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);

    // The "Bad" entry should not appear in list; "Good" should
    expect(await screen.findByText("Good")).toBeInTheDocument();
    expect(screen.queryByText("Bad")).not.toBeInTheDocument();

    // Partial import warning shown
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/skipped/i);
  });

  it("shows error when imported JSON is not an array", async () => {
    const user = userEvent.setup();
    render(<AddressBook {...makeProps()} />);

    const file = new File([JSON.stringify({ key: "value" })], "obj.json", {
      type: "application/json",
    });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);

    expect(await screen.findByRole("status")).toHaveTextContent(/expected a json array/i);
  });

  // ── Accessibility ──────────────────────────────────────────────────────────

  it("has aria-modal and aria-labelledby on the dialog", () => {
    render(<AddressBook {...makeProps()} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "address-book-title");
  });

  it("the list has an accessible label", () => {
    render(<AddressBook {...makeProps()} />);

    expect(screen.getByRole("list", { name: /saved merchant addresses/i })).toBeInTheDocument();
  });
});

// ─── Integration: SubscribeForm + AddressBook ─────────────────────────────────

describe("SubscribeForm address book integration", () => {
  it("shows Select from Address Book button in SubscribeForm", async () => {
    const SubscribeForm = (await import("../components/SubscribeForm")).default;
    render(
      <SubscribeForm
        userKey={"GABC"}
        onSign={async () => "tx"}
        onSuccess={() => {}}
        announce={() => {}}
      />
    );

    expect(screen.getByRole("button", { name: /select.*address book/i })).toBeInTheDocument();
  });

  it("opens AddressBook modal when button is clicked", async () => {
    const SubscribeForm = (await import("../components/SubscribeForm")).default;
    const user = userEvent.setup();
    render(
      <SubscribeForm
        userKey={"GABC"}
        onSign={async () => "tx"}
        onSuccess={() => {}}
        announce={() => {}}
      />
    );

    await user.click(screen.getByRole("button", { name: /select.*address book/i }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Address Book")).toBeInTheDocument();
  });

  it("populates the merchant field when an address is selected", async () => {
    seedStorage([{ name: "Alice", address: VALID_ADDRESS_1 }]);

    const SubscribeForm = (await import("../components/SubscribeForm")).default;
    const user = userEvent.setup();
    render(
      <SubscribeForm
        userKey={"GABC"}
        onSign={async () => "tx"}
        onSuccess={() => {}}
        announce={() => {}}
      />
    );

    await user.click(screen.getByRole("button", { name: /select.*address book/i }));
    await user.click(screen.getByRole("button", { name: /select alice/i }));

    // The merchant input should now contain the selected address
    const merchantInput = screen.getByTestId("merchant-input");
    expect(merchantInput).toHaveValue(VALID_ADDRESS_1);
  });

  it("closes the AddressBook modal after selecting an address", async () => {
    seedStorage([{ name: "Alice", address: VALID_ADDRESS_1 }]);

    const SubscribeForm = (await import("../components/SubscribeForm")).default;
    const user = userEvent.setup();
    render(
      <SubscribeForm
        userKey={"GABC"}
        onSign={async () => "tx"}
        onSuccess={() => {}}
        announce={() => {}}
      />
    );

    await user.click(screen.getByRole("button", { name: /select.*address book/i }));
    await user.click(screen.getByRole("button", { name: /select alice/i }));

    expect(screen.queryByText("Address Book")).not.toBeInTheDocument();
  });
});
