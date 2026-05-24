export const HECATEQ_AGENT_INDEX_TEMPLATE = `Generate the Hecateq global custom-agent capability index.

This command is executed by a deterministic runtime helper.

Expected behavior:
- read global OpenCode custom agent markdown files
- analyze metadata deterministically
- write the generated index file safely
- print a short summary with counts and output path

Do not switch to project-specific agent sources.
Do not ask the user to maintain manual JSON.`
