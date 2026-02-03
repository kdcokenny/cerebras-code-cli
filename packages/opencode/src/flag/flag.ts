// Utility functions for environment variable parsing
function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

function truthyWithFallback(primary: string, fallback: string) {
  return truthy(primary) || truthy(fallback)
}

export namespace Flag {
  export const OPENCODE_AUTO_SHARE = truthyWithFallback("CEREBRAS_CODE_AUTO_SHARE", "OPENCODE_AUTO_SHARE")
  export const OPENCODE_CONFIG = process.env["CEREBRAS_CODE_CONFIG"] || process.env["OPENCODE_CONFIG"]
  export const OPENCODE_CONFIG_CONTENT =
    process.env["CEREBRAS_CODE_CONFIG_CONTENT"] || process.env["OPENCODE_CONFIG_CONTENT"]
  export const OPENCODE_DISABLE_AUTOUPDATE = truthyWithFallback(
    "CEREBRAS_CODE_DISABLE_AUTOUPDATE",
    "OPENCODE_DISABLE_AUTOUPDATE",
  )
  export const OPENCODE_DISABLE_PRUNE = truthyWithFallback("CEREBRAS_CODE_DISABLE_PRUNE", "OPENCODE_DISABLE_PRUNE")
  export const OPENCODE_PERMISSION = process.env["CEREBRAS_CODE_PERMISSION"] || process.env["OPENCODE_PERMISSION"]
  export const OPENCODE_DISABLE_DEFAULT_PLUGINS = truthyWithFallback(
    "CEREBRAS_CODE_DISABLE_DEFAULT_PLUGINS",
    "OPENCODE_DISABLE_DEFAULT_PLUGINS",
  )
  export const OPENCODE_DISABLE_CLAUDE_CODE_SKILLS = truthyWithFallback(
    "CEREBRAS_CODE_DISABLE_CLAUDE_CODE_SKILLS",
    "OPENCODE_DISABLE_CLAUDE_CODE_SKILLS",
  )
  export const OPENCODE_DISABLE_LSP_DOWNLOAD = truthyWithFallback(
    "CEREBRAS_CODE_DISABLE_LSP_DOWNLOAD",
    "OPENCODE_DISABLE_LSP_DOWNLOAD",
  )
  export const OPENCODE_ENABLE_EXPERIMENTAL_MODELS = truthyWithFallback(
    "CEREBRAS_CODE_ENABLE_EXPERIMENTAL_MODELS",
    "OPENCODE_ENABLE_EXPERIMENTAL_MODELS",
  )
  export const OPENCODE_DISABLE_AUTOCOMPACT = truthyWithFallback(
    "CEREBRAS_CODE_DISABLE_AUTOCOMPACT",
    "OPENCODE_DISABLE_AUTOCOMPACT",
  )
  export const OPENCODE_FAKE_VCS = process.env["CEREBRAS_CODE_FAKE_VCS"] || process.env["OPENCODE_FAKE_VCS"]
  export const OPENCODE_EXPERIMENTAL_BASH_MAX_OUTPUT_LENGTH =
    process.env["CEREBRAS_CODE_EXPERIMENTAL_BASH_MAX_OUTPUT_LENGTH"] ||
    process.env["OPENCODE_EXPERIMENTAL_BASH_MAX_OUTPUT_LENGTH"]

  // Experimental
  export const OPENCODE_EXPERIMENTAL = truthyWithFallback("CEREBRAS_CODE_EXPERIMENTAL", "OPENCODE_EXPERIMENTAL")
  export const OPENCODE_EXPERIMENTAL_WATCHER =
    OPENCODE_EXPERIMENTAL || truthyWithFallback("CEREBRAS_CODE_EXPERIMENTAL_WATCHER", "OPENCODE_EXPERIMENTAL_WATCHER")
  export const OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT = truthyWithFallback(
    "CEREBRAS_CODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT",
    "OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT",
  )
  export const OPENCODE_ENABLE_EXA =
    truthyWithFallback("CEREBRAS_CODE_ENABLE_EXA", "OPENCODE_ENABLE_EXA") ||
    OPENCODE_EXPERIMENTAL ||
    truthyWithFallback("CEREBRAS_CODE_EXPERIMENTAL_EXA", "OPENCODE_EXPERIMENTAL_EXA")

  // Dynamic properties (defined via Object.defineProperty below)
  export let OPENCODE_DISABLE_PROJECT_CONFIG: boolean
  export let OPENCODE_CONFIG_DIR: string | undefined
}

// Dynamic getters for environment variables that need to be read at runtime
Object.defineProperty(Flag, "OPENCODE_DISABLE_PROJECT_CONFIG", {
  get: () => truthyWithFallback("CEREBRAS_CODE_DISABLE_PROJECT_CONFIG", "OPENCODE_DISABLE_PROJECT_CONFIG"),
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "OPENCODE_CONFIG_DIR", {
  get: () => process.env["CEREBRAS_CODE_CONFIG_DIR"] || process.env["OPENCODE_CONFIG_DIR"],
  enumerable: true,
  configurable: false,
})
