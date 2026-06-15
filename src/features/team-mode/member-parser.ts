export class MemberValidationError extends Error {
  constructor(
    message: string,
    public readonly memberName?: string,
    public readonly issue?: string,
  ) {
    super(message)
    this.name = "MemberValidationError"
  }
}

function translateMemberError(
  input: Record<string, unknown>,
  agentEligibilityRegistry: Readonly<Record<string, { verdict: "eligible" | "conditional" | "hard-reject"; rejectionMessage?: string }>>,
): MemberValidationError {
  const name = typeof input.name === "string" ? input.name : "<unnamed>"
  const hasSubagentType = input.subagent_type != null
  const hasKind = input.kind === "subagent_type"

  if (input.category != null) {
    return new MemberValidationError(
      `Member '${name}' uses 'category' which has been removed. Use kind: "subagent_type" with subagent_type instead.`,
      name,
      "category-removed",
    )
  }

  if (input.kind !== undefined && !hasKind) {
    return new MemberValidationError(
      `Member '${name}' has invalid kind '${input.kind}'. Only kind: "subagent_type" is supported.`,
      name,
      "invalid-kind",
    )
  }

  if (!hasKind && !hasSubagentType) {
    return new MemberValidationError(
      `Member '${name}' missing 'kind' discriminator and subagent_type. Specify {kind:'subagent_type', subagent_type}.`,
      name,
      "missing-kind",
    )
  }

  if (typeof input.subagent_type !== "string" || !agentEligibilityRegistry[input.subagent_type]) {
    return new MemberValidationError(
      `Unknown subagent_type '${String(input.subagent_type)}'. Available ELIGIBLE agents: sisyphus, hecateq-orchestrator, atlas, sisyphus-junior, hephaestus (if D-36 applied). Use delegate-task for read-only agents like oracle, librarian, explore, metis, momus, multimodal-looker.`,
      name,
      "unknown-subagent",
    )
  }

  return new MemberValidationError(`Member '${name}' validation failed.`, name, "zod-residual")
}

export function createParseMember<TMember>(
  memberSchema: { safeParse(input: unknown): { success: true; data: TMember } | { success: false } },
  agentEligibilityRegistry: Readonly<Record<string, { verdict: "eligible" | "conditional" | "hard-reject"; rejectionMessage?: string }>>,
): (input: unknown) => TMember {
  return function parseMember(input: unknown) {
    if (input == null || typeof input !== "object") {
      throw new MemberValidationError("Member must be an object")
    }

    const raw = input as Record<string, unknown>

    // If kind is missing but subagent_type is present, infer kind
    const normalized = raw.kind === undefined && raw.subagent_type !== undefined
      ? { ...raw, kind: "subagent_type" }
      : raw

    const result = memberSchema.safeParse(normalized)

    if (!result.success) {
      throw translateMemberError(raw, agentEligibilityRegistry)
    }

    return result.data
  }
}
