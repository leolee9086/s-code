import { Schema } from "effect"

export * as ConfigPrefix from "./prefix"

export const Info = Schema.Struct({
  prefixes: Schema.Array(Schema.String),
  description: Schema.optional(Schema.String),
  command: Schema.String,
})

export type Info = Schema.Schema.Type<typeof Info>
