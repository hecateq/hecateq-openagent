#!/usr/bin/env bun
import { createOhMyOpenCodeJsonSchema } from "./build-schema-document"

const SCHEMA_OUTPUT_PATH = "assets/oh-my-opencode.schema.json"
const DIST_SCHEMA_OUTPUT_PATH = "dist/oh-my-opencode.schema.json"

// Hecateq alias schema artifacts
const HECATEQ_SCHEMA_OUTPUT_PATH = "assets/hecateq-openagent.schema.json"
const HECATEQ_DIST_SCHEMA_OUTPUT_PATH = "dist/hecateq-openagent.schema.json"

async function main() {
  console.log("Generating JSON Schema...")

  const finalSchema = createOhMyOpenCodeJsonSchema()
  await Bun.write(SCHEMA_OUTPUT_PATH, JSON.stringify(finalSchema, null, 2))
  await Bun.write(DIST_SCHEMA_OUTPUT_PATH, JSON.stringify(finalSchema, null, 2))

  // Hecateq: Also generate schema alias with updated $id for Hecateq users
  const hecateqSchema = {
    ...finalSchema,
    $id: "https://raw.githubusercontent.com/hecateq/hecateq-openagent/main/assets/hecateq-openagent.schema.json",
    title: "Hecateq OpenAgent Configuration",
    description: "Configuration schema for @hecateq/openagent plugin",
  }
  await Bun.write(HECATEQ_SCHEMA_OUTPUT_PATH, JSON.stringify(hecateqSchema, null, 2))
  await Bun.write(HECATEQ_DIST_SCHEMA_OUTPUT_PATH, JSON.stringify(hecateqSchema, null, 2))

  console.log(`✓ JSON Schema generated: ${SCHEMA_OUTPUT_PATH}`)
  console.log(`✓ Hecateq schema alias: ${HECATEQ_SCHEMA_OUTPUT_PATH}`)
}

main()
