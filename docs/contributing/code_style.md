# 🎨 Code Style Guidelines

SoroScan enforces strict coding style guidelines across all supported languages (Python, TypeScript, Rust, SQL, and CSS) to maintain high readability, consistency, and clean code.

---

## 🐍 Python Style Guidelines

We write modern, type-annotated Python. 

### 1. Style & Formatting
- **PEP 8 Compliance**: Enforced through configuration.
- **Formatter**: We use [black](https://github.com/psf/black) with a line-length limit of **88 characters**.
- **Import Sorting**: Sorted via `isort`.
- **Linter**: Checked using `flake8` or `ruff`.

### 2. Type Hints
All new code must have explicit type annotations for parameters and return types. Avoid the use of `Any` where possible.
```python
from typing import List, Optional

def fetch_events_by_contract(
    contract_id: str, 
    limit: int = 100
) -> List[dict]:
    """Fetches indexed Soroban events for a given contract ID.
    
    Args:
        contract_id: The target Soroban contract address.
        limit: Maximum number of events to return.
    """
    ...
```

### 3. Verification Commands
Run these before committing:
```bash
# Auto-format code
black .
isort .

# Run linter checks
ruff check .
```

---

## ⚛️ TypeScript & JavaScript Style Guidelines

For frontend applications and Node.js-based indexing scripts, we follow strict ES6+ and TypeScript standards.

### 1. Linter & Formatter
- **Linter**: ESLint with `eslint-config-airbnb-typescript` and `plugin:@typescript-eslint/recommended`.
- **Formatter**: Prettier.
- **Line Length**: **100 characters**.

### 2. TypeScript Best Practices
- **Strict Mode**: `strict` is enabled in `tsconfig.json`. Do not use `any` unless absolutely necessary and documented.
- **Explicit Returns**: Explicitly define function return types.
- **Null & Undefined**: Prefer `Optional Chaining (?.)` and `Nullish Coalescing (??)` over logical OR (`||`).

```typescript
interface EventPayload {
  contractId: string;
  sequence: number;
  data: string;
}

export const processEvent = (event: EventPayload): boolean => {
  if (!event.contractId) {
    return false;
  }
  console.log(`Processing sequence: ${event.sequence}`);
  return true;
};
```

### 3. Verification Commands
```bash
# Lint code
npm run lint

# Format code
npm run format
```

---

## 🦀 Rust Style Guidelines

Our smart contracts are written in Rust on the Stellar Soroban platform.

### 1. Formatter & Linter
- **Formatter**: `rustfmt`.
- **Linter**: `cargo clippy`.

### 2. Soroban Smart Contract Design
- **No Standard Library**: Contracts must begin with `#![no_std]`.
- **State Mutation Constraints**: Always authenticate the caller with `.require_auth()`.
- **Storage Strategy**: Use `.storage().instance()` for contract configurations and `.storage().persistent()` for large, recurring user data.
- **Error Handling**: Use enum-based custom errors with descriptions.

```rust
#![no_std]
use soroban_sdk::{contract, contractimpl, Env, Address};

#[contract]
pub struct FlowPayContract;

#[contractimpl]
impl FlowPayContract {
    pub fn charge(env: Env, user: Address, amount: i128) {
        user.require_auth();
        // Charge logic...
    }
}
```

### 3. Verification Commands
```bash
# Format code
cargo fmt --all -- --check

# Run linter
cargo clippy --all-targets -- -D warnings

# Run tests
cargo test
```

---

## 🎨 CSS & Tailwind CSS Class Organization

We structure styles for visual consistency and maintainability.

### 1. CSS Structure
- Use **CSS Custom Properties** (variables) in `index.css` for styling design tokens (colors, font sizes, transitions, spacing).
- Write custom CSS utilities using BEM (Block, Element, Modifier) naming conventions if not using Tailwind.

### 2. Tailwind CSS Class Order
To maintain readable HTML markup when using Tailwind, sort classes logically according to the following order:
1. **Layout** (`flex`, `grid`, `block`, `absolute`, `z-index`, `top-0`)
2. **Box Model** (`w-`, `h-`, `p-`, `m-`, `border-`)
3. **Typography** (`text-`, `font-`, `leading-`)
4. **Visuals** (`bg-`, `rounded-`, `shadow-`, `opacity-`)
5. **Interactive & Transitions** (`hover:`, `transition-`, `duration-`)
6. **Responsive modifiers** (`sm:`, `md:`, `lg:`)

*Bad*:
```html
<button class="bg-blue-500 p-4 absolute text-white hover:bg-blue-600 rounded flex m-2">
  Submit
</button>
```

*Good*:
```html
<button class="absolute flex m-2 p-4 rounded text-white bg-blue-500 hover:bg-blue-600">
  Submit
</button>
```

We recommend installing the [Prettier Plugin TailwindCSS](https://github.com/tailwindlabs/prettier-plugin-tailwindcss) to automatically enforce this ordering.

---

## 🛢️ SQL Style Guidelines

SQL scripts must be formatted for maximum readability, particularly when performing migrations or running analytical queries.

### 1. General Rules
- **Keywords**: Always write SQL keywords in **UPPERCASE** (e.g., `SELECT`, `FROM`, `WHERE`, `JOIN`, `CREATE INDEX`).
- **Identifiers**: Use **snake_case** for table names, column names, view names, and indexes (e.g., `soroban_events`, `transaction_hash`).
- **Singular Names**: Table names must be pluralized (e.g., `transactions`, `subscriptions`), while junction tables should merge both parent names alphabetically (e.g., `contracts_users`).
- **Primary Keys**: Always name primary keys `id` or specify explicit columns (e.g., `ledger_sequence`).

### 2. Formatting Example
```sql
SELECT 
  e.contract_id,
  count(e.id) AS event_count,
  max(e.ledger_sequence) AS latest_ledger
FROM soroban_events e
INNER JOIN contracts c ON e.contract_id = c.id
WHERE e.event_type = 'transfer'
GROUP BY e.contract_id
HAVING count(e.id) > 100
ORDER BY event_count DESC;
```
