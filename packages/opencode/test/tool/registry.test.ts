import { test, expect } from "bun:test"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import path from "path"
import fs from "fs/promises"

test("loads plugins from .opencode/plugins/ (plural)", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const opencodeDir = path.join(dir, ".opencode")
      const pluginsDir = path.join(opencodeDir, "plugins")
      await fs.mkdir(pluginsDir, { recursive: true })

      // Create a simple test plugin
      await Bun.write(
        path.join(pluginsDir, "test-plugin.ts"),
        `export default {
  name: "test-plugin",
  description: "A test plugin"
}`,
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      const plugins = config.plugin ?? []

      // Should have loaded the plugin from plugins/ directory
      const testPlugin = plugins.find((p) => p.includes("test-plugin.ts"))
      expect(testPlugin).toBeDefined()
      expect(testPlugin?.startsWith("file://")).toBe(true)
    },
  })
})

test("loads plugins from .opencode/plugin/ (singular)", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const opencodeDir = path.join(dir, ".opencode")
      const pluginDir = path.join(opencodeDir, "plugin")
      await fs.mkdir(pluginDir, { recursive: true })

      // Create a simple test plugin
      await Bun.write(
        path.join(pluginDir, "singular-plugin.js"),
        `export default {
  name: "singular-plugin",
  description: "A test plugin in singular directory"
}`,
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      const plugins = config.plugin ?? []

      // Should have loaded the plugin from plugin/ directory
      const testPlugin = plugins.find((p) => p.includes("singular-plugin.js"))
      expect(testPlugin).toBeDefined()
      expect(testPlugin?.startsWith("file://")).toBe(true)
    },
  })
})

test("loads nested plugins from plural directory", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const opencodeDir = path.join(dir, ".opencode")
      const pluginsDir = path.join(opencodeDir, "plugins", "utilities")
      await fs.mkdir(pluginsDir, { recursive: true })

      // Create a nested test plugin
      await Bun.write(
        path.join(pluginsDir, "helper.ts"),
        `export default {
  name: "helper",
  description: "A nested helper plugin"
}`,
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      const plugins = config.plugin ?? []

      // Should have loaded the nested plugin
      const testPlugin = plugins.find((p) => p.includes("helper.ts"))
      expect(testPlugin).toBeDefined()
      expect(testPlugin?.startsWith("file://")).toBe(true)
      expect(testPlugin?.includes("utilities")).toBe(true)
    },
  })
})

test("loads both .ts and .js plugins from plugins directory", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const opencodeDir = path.join(dir, ".opencode")
      const pluginsDir = path.join(opencodeDir, "plugins")
      await fs.mkdir(pluginsDir, { recursive: true })

      // Create a TypeScript plugin
      await Bun.write(path.join(pluginsDir, "ts-plugin.ts"), `export default { name: "ts-plugin" }`)

      // Create a JavaScript plugin
      await Bun.write(path.join(pluginsDir, "js-plugin.js"), `export default { name: "js-plugin" }`)
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      const plugins = config.plugin ?? []

      // Should have loaded both plugins
      const tsPlugin = plugins.find((p) => p.includes("ts-plugin.ts"))
      const jsPlugin = plugins.find((p) => p.includes("js-plugin.js"))

      expect(tsPlugin).toBeDefined()
      expect(jsPlugin).toBeDefined()
    },
  })
})
