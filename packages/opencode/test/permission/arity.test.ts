import { test, expect, describe } from "bun:test"
import { BashArity } from "../../src/permission/arity"

describe("BashArity", () => {
  describe("prefix", () => {
    test("handles arity 1 commands - returns first token", () => {
      expect(BashArity.prefix(["cat", "file.txt"])).toEqual(["cat"])
      expect(BashArity.prefix(["ls", "-la", "/tmp"])).toEqual(["ls"])
      expect(BashArity.prefix(["rm", "-rf", "folder"])).toEqual(["rm"])
    })

    test("handles arity 2 commands - returns first two tokens", () => {
      expect(BashArity.prefix(["git", "checkout", "main"])).toEqual(["git", "checkout"])
      expect(BashArity.prefix(["npm", "install", "lodash"])).toEqual(["npm", "install"])
      expect(BashArity.prefix(["docker", "run", "nginx"])).toEqual(["docker", "run"])
    })

    test("handles arity 3 commands - returns first three tokens", () => {
      expect(BashArity.prefix(["npm", "run", "dev"])).toEqual(["npm", "run", "dev"])
      expect(BashArity.prefix(["docker", "compose", "up", "-d"])).toEqual(["docker", "compose", "up"])
      expect(BashArity.prefix(["aws", "s3", "ls", "bucket"])).toEqual(["aws", "s3", "ls"])
    })

    test("finds longest matching prefix", () => {
      // "docker compose" has arity 3, "docker" has arity 2
      expect(BashArity.prefix(["docker", "compose", "up"])).toEqual(["docker", "compose", "up"])
      // But plain docker uses arity 2
      expect(BashArity.prefix(["docker", "run", "nginx"])).toEqual(["docker", "run"])
    })

    test("defaults to first token for unknown commands", () => {
      expect(BashArity.prefix(["unknown_command", "arg1", "arg2"])).toEqual(["unknown_command"])
      expect(BashArity.prefix(["my_script.sh", "--flag"])).toEqual(["my_script.sh"])
    })

    test("handles empty array", () => {
      expect(BashArity.prefix([])).toEqual([])
    })

    test("handles single token", () => {
      expect(BashArity.prefix(["git"])).toEqual(["git"])
      expect(BashArity.prefix(["ls"])).toEqual(["ls"])
    })
  })
})
