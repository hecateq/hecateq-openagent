import color from "picocolors"
import { PUBLISHED_PACKAGE_NAME } from "../shared"
import type { HecateqSetupProfile, InstallArgs } from "./types"
import {
  addPluginToOpenCodeConfig,
  detectCurrentConfig,
  getOpenCodeVersion,
  isOpenCodeInstalled,
  writeOmoConfig,
} from "./config-manager"
import {
  SYMBOLS,
  argsToConfig,
  detectedToInitialValues,
  formatConfigSummary,
  printBox,
  printError,
  printHeader,
  printInfo,
  printStep,
  printSuccess,
  printWarning,
  validateNonTuiArgs,
} from "./install-validators"
import { formatHecateqProfileSummary } from "./config-manager/generate-hecateq-config"
import { getUnsupportedOpenCodeVersionMessage } from "./minimum-opencode-version"

export async function runCliInstaller(args: InstallArgs, version: string): Promise<number> {
  const validation = validateNonTuiArgs(args)
  if (!validation.valid) {
    printHeader(false)
    printError("Validation failed:")
    for (const err of validation.errors) {
      console.log(`  ${SYMBOLS.bullet} ${err}`)
    }
    console.log()
    printInfo(
      `Usage: bunx ${PUBLISHED_PACKAGE_NAME} install --no-tui --claude=<no|yes|max20> --gemini=<no|yes> --copilot=<no|yes> [--hecateq-profile=<recommended|minimal|advanced>]`,
    )
    console.log()
    return 1
  }

  const detected = detectCurrentConfig()
  const isUpdate = detected.isInstalled

  printHeader(isUpdate)

  const totalSteps = 5
  let step = 1

  printStep(step++, totalSteps, "Checking OpenCode installation...")
  const installed = await isOpenCodeInstalled()
  const openCodeVersion = await getOpenCodeVersion()
  if (!installed) {
    printWarning(
      "OpenCode binary not found. Plugin will be configured, but you'll need to install OpenCode to use it.",
    )
    printInfo("Visit https://opencode.ai/docs for installation instructions")
  } else {
    printSuccess(`OpenCode ${openCodeVersion ?? ""} detected`)

    const unsupportedVersionMessage = getUnsupportedOpenCodeVersionMessage(openCodeVersion)
    if (unsupportedVersionMessage) {
      printWarning(unsupportedVersionMessage)
      return 1
    }
  }

  if (isUpdate) {
    const initial = detectedToInitialValues(detected)
    printInfo(`Current config: Claude=${initial.claude}, Gemini=${initial.gemini}`)
  }

  const config = argsToConfig(args)
  const profileLabel = config.hecateqProfile.charAt(0).toUpperCase() + config.hecateqProfile.slice(1)
  printStep(step++, totalSteps, `Hecateq setup profile: ${profileLabel}...`)
  for (const line of formatHecateqProfileSummary(config.hecateqProfile)) {
    console.log(`  ${line}`)
  }

  printStep(step++, totalSteps, `Adding ${PUBLISHED_PACKAGE_NAME} plugin...`)
  const pluginResult = await addPluginToOpenCodeConfig(version)
  if (!pluginResult.success) {
    printError(`Failed: ${pluginResult.error}`)
    return 1
  }
  printSuccess(
    `Plugin ${isUpdate ? "verified" : "added"} ${SYMBOLS.arrow} ${color.dim(pluginResult.configPath)}`,
  )

  printStep(step++, totalSteps, `Writing Hecateq OpenAgent configuration...`)
  const omoResult = writeOmoConfig(config)
  if (!omoResult.success) {
    printError(`Failed: ${omoResult.error}`)
    return 1
  }
  printSuccess(`Config written ${SYMBOLS.arrow} ${color.dim(omoResult.configPath)}`)

  printBox(formatConfigSummary(config), isUpdate ? "Updated Configuration" : "Installation Complete")

  if (!config.hasClaude) {
    printInfo(
      "Note: Sisyphus agent performs best with Claude Opus 4.5+. " +
        "Other models work but may have reduced orchestration quality.",
    )
  }

  if (
    !config.hasClaude &&
    !config.hasOpenAI &&
    !config.hasGemini &&
    !config.hasCopilot &&
    !config.hasOpencodeZen &&
    !config.hasVercelAiGateway
  ) {
    printWarning("No model providers configured. Using opencode/big-pickle as fallback.")
  }

  console.log(`${SYMBOLS.star} ${color.bold(color.green(isUpdate ? "Configuration updated!" : "Installation complete!"))}`)
  console.log(`  Run ${color.cyan("opencode")} to start!`)
  console.log()

  printInfo(
    "Anonymous telemetry is disabled by default. Enable with HECATEQ_SEND_ANONYMOUS_TELEMETRY=1 and HECATEQ_POSTHOG_KEY=... Legacy OMO_SEND_ANONYMOUS_TELEMETRY, OMO_DISABLE_POSTHOG, and POSTHOG_API_KEY also work.",
  )
  printInfo("Docs: docs/legal/privacy-policy.md and docs/legal/terms-of-service.md")
  console.log()

  printBox(
    `${color.bold("Pro Tip:")} Include ${color.cyan("ultrawork")} (or ${color.cyan("ulw")}) in your prompt.\n` +
      `All features work like magic-parallel agents, background tasks,\n` +
      `deep exploration, and relentless execution until completion.`,
    "The Magic Word",
  )

  console.log(`${SYMBOLS.star} ${color.yellow("If you found this helpful, consider starring the repo!")}`)
  console.log(
    `  ${color.dim("gh api --silent --method PUT /user/starred/hecateq/hecateq-openagent >/dev/null 2>&1 || true")}`,
  )
  console.log()
  console.log(color.dim("oMoMoMoMo... Enjoy!"))
  console.log()

  if ((config.hasClaude || config.hasGemini || config.hasCopilot) && !args.skipAuth) {
    printBox(
      `Run ${color.cyan("opencode auth login")} and select your provider:\n` +
        (config.hasClaude ? `  ${SYMBOLS.bullet} Anthropic ${color.gray("→ Claude Pro/Max")}\n` : "") +
        (config.hasGemini ? `  ${SYMBOLS.bullet} Google ${color.gray("→ Gemini")}\n` : "") +
        (config.hasCopilot ? `  ${SYMBOLS.bullet} GitHub ${color.gray("→ Copilot")}` : ""),
      "Authenticate Your Providers",
    )
  }

  return 0
}
