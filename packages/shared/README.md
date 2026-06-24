# @openhearth/shared

The **seam contract**: TypeScript types and JSON Schemas for the protocol,
config, and (later) media models. Imported by both `@openhearth/server` and
`@openhearth/web`; it imports nothing from either, and depends only on `zod` so
it stays **isomorphic** (no Node- or browser-only APIs).

## Schema → types: a single source of truth

**Zod schemas are the single source of truth.** Everything else is derived:

- **TypeScript types** come from `z.infer<typeof schema>`. We never hand-write a
  type that duplicates a schema — the type and the runtime validator can't drift
  because one is generated from the other.
- **JSON Schema** comes from Zod v4's native `z.toJSONSchema(schema)`. This is
  what non-TypeScript clients and documentation consume. It is generated from
  the same Zod schema, so it also can't drift.

```
        ┌────────────────┐
        │  Zod schema    │  ← author here, once
        └───────┬────────┘
        z.infer │ z.toJSONSchema
        ┌───────┴────────┐
        ▼                ▼
  TypeScript type    JSON Schema
  (compile-time)     (runtime / docs / other languages)
```

When adding or changing a field, edit the Zod schema only. The inferred type and
the JSON Schema update automatically.

## Modules

- **`protocol/`** — `PROTOCOL_VERSION`, the action vocabulary (`ACTION_NAMES`),
  and the command/event message envelopes (`commandMessageSchema`,
  `eventMessageSchema`, `protocolMessageSchema`) plus `parseProtocolMessage()`
  and `protocolMessageJsonSchema`.
- **`config/`** — `configSchema` (every field optional so `{}` is valid; strict
  so unknown keys are rejected), the inferred `Config` type, `validateConfig()`
  (never throws; returns a discriminated result for graceful, non-fatal config
  errors), and `configJsonSchema`.
