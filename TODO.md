# TODO (PayFlow)

## Frontend DX: Hook JSDoc coverage
- [ ] Scan all files in `frontend/src/hooks/` and verify which exported hooks are missing/partial JSDoc.
- [ ] Add/upgrade `/** ... */` JSDoc blocks for every hook to include:
  - purpose
  - `@param` tags for parameters
  - `@returns` for return shape
  - side effects
  - `@example` usage
- [ ] Run TypeScript compile/typecheck for `frontend` to ensure no errors.

