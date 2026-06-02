export * as ConfigContentFilter from "./content-filter"
import { Schema } from "effect"

export const Pattern = Schema.Struct({
  regex: Schema.String,
  action: Schema.Literals(["retry", "warn", "block"]),
  message: Schema.optional(Schema.String),
})
export type Pattern = typeof Pattern.Type

export const Info = Schema.Struct({
  patterns: Schema.optional(Schema.mutable(Schema.Array(Pattern))),
})
export type Info = typeof Info.Type
