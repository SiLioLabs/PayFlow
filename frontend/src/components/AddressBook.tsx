import React, { useRef, useState, useCallback } from "react";
import { StrKey } from "@stellar/stellar-sdk";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useFocusTrap } from "../hooks/useFocusTrap";
import ConfirmModal from "./ConfirmModal";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AddressEntry {
  name: string;
  address: string;
}

interface Props {
  /** Called when the user selects an entry; receives the Stellar address. */
  onSelect: (address: string) => void;
  /** Called when the user closes the modal without selecting. */
  onClose: () => void;
}

const STORAGE_KEY = "flowpay_address_book";

// ─── Component ────────────────────────────────────────────────────────────────

export default function AddressBook({ onSelect, onClose }: Props) {
  const [entries, setEntries] = useLocalStorage<AddressEntry[]>(STORAGE_KEY, []);

  // Search / filter
  const [query, setQuery] = useState("");

  // Add-entry form
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  // Delete confirmation
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);

  // Import / export state
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Modal focus trap
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, true, onClose);

  // ── Derived ──────────────────────────────────────────────────────────────

  const filtered = entries.filter(
    (e) =>
      e.name.toLowerCase().includes(query.toLowerCase()) ||
      e.address.toLowerCase().includes(query.toLowerCase())
  );

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleAdd = useCallback(() => {
    setAddError(null);
    const trimmedName = newName.trim();
    const trimmedAddress = newAddress.trim();

    if (!trimmedName) {
      setAddError("Name is required.");
      return;
    }
    if (!trimmedAddress) {
      setAddError("Address is required.");
      return;
    }
    if (!StrKey.isValidEd25519PublicKey(trimmedAddress)) {
      setAddError("Invalid Stellar address.");
      return;
    }

    setEntries([...entries, { name: trimmedName, address: trimmedAddress }]);
    setNewName("");
    setNewAddress("");
  }, [newName, newAddress, entries, setEntries]);

  const handleDeleteConfirmed = useCallback(() => {
    if (pendingDelete === null) return;
    const updated = entries.filter((_, i) => i !== pendingDelete);
    setEntries(updated);
    setPendingDelete(null);
  }, [pendingDelete, entries, setEntries]);

  const handleSelect = useCallback(
    (address: string) => {
      onSelect(address);
      onClose();
    },
    [onSelect, onClose]
  );

  // ── Import / Export ───────────────────────────────────────────────────────

  const handleExport = useCallback(() => {
    const json = JSON.stringify(entries, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "payflow-address-book.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [entries]);

  const handleImportClick = useCallback(() => {
    setImportError(null);
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Reset file input so the same file can be re-imported if desired
      e.target.value = "";

      const reader = new FileReader();
      reader.onload = (evt) => {
        setImportError(null);
        const text = evt.target?.result as string;

        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          setImportError("Invalid JSON file.");
          return;
        }

        if (!Array.isArray(parsed)) {
          setImportError("Expected a JSON array of { name, address } entries.");
          return;
        }

        const valid: AddressEntry[] = [];
        const skipped: number[] = [];

        parsed.forEach((item: unknown, idx: number) => {
          if (
            typeof item === "object" &&
            item !== null &&
            "name" in item &&
            "address" in item &&
            typeof (item as Record<string, unknown>).name === "string" &&
            typeof (item as Record<string, unknown>).address === "string" &&
            StrKey.isValidEd25519PublicKey((item as AddressEntry).address)
          ) {
            valid.push({
              name: ((item as AddressEntry).name as string).trim(),
              address: (item as AddressEntry).address as string,
            });
          } else {
            skipped.push(idx + 1);
          }
        });

        if (valid.length === 0) {
          setImportError("No valid entries found in the file.");
          return;
        }

        // Merge: append imported entries (allow duplicates per spec)
        // Use entries ref-captured at callback creation time — safe because
        // handleFileChange is recreated whenever entries changes.
        setEntries([...entries, ...valid]);

        if (skipped.length > 0) {
          setImportError(
            `Imported ${valid.length} entries. Skipped ${skipped.length} invalid row(s).`
          );
        }
      };

      reader.readAsText(file);
    },
    [entries, setEntries]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAdd();
      }
    },
    [handleAdd]
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="modal-overlay" onClick={onClose} role="presentation">
        <div
          ref={modalRef}
          className="modal-card card address-book-modal"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="address-book-title"
        >
          {/* ── Header ── */}
          <div className="address-book__header flex-between">
            <h3 id="address-book-title" className="address-book__title">
              Address Book
            </h3>
            <button
              className="btn-icon address-book__close"
              aria-label="Close address book"
              onClick={onClose}
            >
              ✕
            </button>
          </div>

          {/* ── Search ── */}
          <div className="form-group address-book__search">
            <label htmlFor="address-book-search" className="sr-only">
              Search by name or address
            </label>
            <input
              id="address-book-search"
              type="search"
              placeholder="Search by name or address…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search address book"
              className="address-book__search-input"
            />
          </div>

          {/* ── Entries List ── */}
          <ul
            className="address-book__list"
            aria-label="Saved merchant addresses"
            aria-live="polite"
          >
            {filtered.length === 0 ? (
              <li className="address-book__empty text-muted">
                {entries.length === 0 ? "No saved addresses yet." : "No results match your search."}
              </li>
            ) : (
              filtered.map((entry, idx) => {
                // Find the true index in entries for deletion
                const trueIdx = entries.indexOf(entry);
                return (
                  <li key={`${entry.address}-${idx}`} className="address-book__entry">
                    <div className="address-book__entry-info">
                      <span className="address-book__entry-name">{entry.name}</span>
                      <span className="address-book__entry-address text-mono text-sm text-muted">
                        {entry.address.slice(0, 8)}…{entry.address.slice(-6)}
                      </span>
                    </div>
                    <div className="address-book__entry-actions">
                      <button
                        className="btn-secondary btn-sm"
                        onClick={() => handleSelect(entry.address)}
                        aria-label={`Select ${entry.name}`}
                      >
                        Select
                      </button>
                      <button
                        className="btn-danger btn-sm"
                        onClick={() => setPendingDelete(trueIdx)}
                        aria-label={`Delete ${entry.name}`}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                );
              })
            )}
          </ul>

          {/* ── Add Entry Form ── */}
          <fieldset className="address-book__add-form">
            <legend className="form-label">Add new entry</legend>
            <div className="address-book__add-row">
              <div className="form-group address-book__add-name">
                <label htmlFor="address-book-new-name" className="sr-only">
                  Name
                </label>
                <input
                  id="address-book-new-name"
                  type="text"
                  placeholder="Name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  aria-label="New entry name"
                />
              </div>
              <div className="form-group address-book__add-address">
                <label htmlFor="address-book-new-address" className="sr-only">
                  Stellar address
                </label>
                <input
                  id="address-book-new-address"
                  type="text"
                  placeholder="G… (Stellar address)"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  onKeyDown={handleKeyDown}
                  aria-label="New entry Stellar address"
                />
              </div>
              <button
                type="button"
                className="btn-primary btn-sm address-book__add-btn"
                onClick={handleAdd}
                aria-label="Add address book entry"
              >
                Add
              </button>
            </div>
            {addError && (
              <p className="text-error address-book__add-error" role="alert">
                {addError}
              </p>
            )}
          </fieldset>

          {/* ── Import / Export ── */}
          <div className="address-book__io modal-actions">
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={handleExport}
              aria-label="Export address book as JSON"
              disabled={entries.length === 0}
            >
              Export JSON
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={handleImportClick}
              aria-label="Import address book from JSON file"
            >
              Import JSON
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleFileChange}
              className="sr-only"
              aria-hidden="true"
              tabIndex={-1}
            />
          </div>
          {importError && (
            <p
              className="text-sm address-book__import-status"
              role="status"
              aria-live="polite"
              style={{
                color: importError.startsWith("Imported")
                  ? "var(--color-success)"
                  : "var(--color-danger)",
              }}
            >
              {importError}
            </p>
          )}
        </div>
      </div>

      {/* ── Delete Confirmation ── */}
      {pendingDelete !== null && (
        <ConfirmModal
          message={`Delete "${entries[pendingDelete]?.name}" from your address book?`}
          onConfirm={handleDeleteConfirmed}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </>
  );
}
