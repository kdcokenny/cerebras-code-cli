// Arity list from upstream v1.1.35+ spec

export namespace BashArity {
  /**
   * Command arity mapping - defines how many tokens constitute the "command" portion.
   * - Arity 1: Simple commands (cat, ls, rm)
   * - Arity 2: Tool + subcommand (git checkout, npm install)
   * - Arity 3: Multi-level subcommands (npm run dev, docker compose up)
   */
  export const ARITY: Record<string, number> = {
    // Arity 1 - Unix basics
    cat: 1,
    cd: 1,
    chmod: 1,
    chown: 1,
    cp: 1,
    echo: 1,
    env: 1,
    export: 1,
    grep: 1,
    kill: 1,
    killall: 1,
    ln: 1,
    ls: 1,
    mkdir: 1,
    mv: 1,
    ps: 1,
    pwd: 1,
    rm: 1,
    rmdir: 1,
    sleep: 1,
    source: 1,
    tail: 1,
    touch: 1,
    unset: 1,
    which: 1,

    // Arity 2 - Tool + subcommand
    bazel: 2,
    brew: 2,
    bun: 2,
    cargo: 2,
    cdk: 2,
    cf: 2,
    cmake: 2,
    composer: 2,
    consul: 2,
    crictl: 2,
    deno: 2,
    docker: 2,
    eksctl: 2,
    firebase: 2,
    flyctl: 2,
    git: 2,
    go: 2,
    gradle: 2,
    helm: 2,
    heroku: 2,
    hugo: 2,
    ip: 2,
    kind: 2,
    kubectl: 2,
    kustomize: 2,
    make: 2,
    mc: 2,
    minikube: 2,
    mongosh: 2,
    mysql: 2,
    mvn: 2,
    ng: 2,
    npm: 2,
    nvm: 2,
    nx: 2,
    openssl: 2,
    pip: 2,
    pipenv: 2,
    pnpm: 2,
    poetry: 2,
    podman: 2,
    psql: 2,
    pulumi: 2,
    pyenv: 2,
    python: 2,
    rake: 2,
    rbenv: 2,
    "redis-cli": 2,
    rustup: 2,
    serverless: 2,
    skaffold: 2,
    sls: 2,
    sst: 2,
    swift: 2,
    systemctl: 2,
    terraform: 2,
    tmux: 2,
    turbo: 2,
    ufw: 2,
    vault: 2,
    vercel: 2,
    volta: 2,
    wp: 2,
    yarn: 2,

    // Arity 3 - Multi-level subcommands
    aws: 3, // aws s3 ls
    az: 3, // az storage blob list
    "bun run": 3,
    "bun x": 3,
    "cargo add": 3,
    "cargo run": 3,
    "consul kv": 3,
    "deno task": 3,
    doctl: 3,
    "docker builder": 3,
    "docker compose": 3,
    "docker container": 3,
    "docker image": 3,
    "docker network": 3,
    "docker volume": 3,
    "eksctl create": 3,
    gcloud: 3,
    gh: 3,
    "git config": 3,
    "git remote": 3,
    "git stash": 3,
    "ip addr": 3,
    "ip link": 3,
    "ip netns": 3,
    "ip route": 3,
    "kind create": 3,
    "kubectl kustomize": 3,
    "kubectl rollout": 3,
    "mc admin": 3,
    "npm exec": 3,
    "npm init": 3,
    "npm run": 3,
    "npm view": 3,
    "openssl req": 3,
    "openssl x509": 3,
    "pnpm dlx": 3,
    "pnpm exec": 3,
    "pnpm run": 3,
    "podman container": 3,
    "podman image": 3,
    "pulumi stack": 3,
    sfdx: 3,
    "terraform workspace": 3,
    "vault auth": 3,
    "vault kv": 3,
    "yarn dlx": 3,
    "yarn run": 3,
  }

  /**
   * Returns the command prefix tokens based on arity lookup.
   *
   * Searches for the longest matching prefix in the ARITY map and returns
   * the appropriate number of tokens. Falls back to the first token for
   * unknown commands.
   *
   * @param tokens - Array of command tokens
   * @returns Array containing the command prefix tokens
   *
   * @example
   * prefix(["npm", "run", "dev"]) // => ["npm", "run", "dev"]
   * prefix(["git", "checkout", "main"]) // => ["git", "checkout"]
   * prefix(["ls", "-la"]) // => ["ls"]
   * prefix([]) // => []
   */
  export function prefix(tokens: string[]): string[] {
    // Guard: Handle empty array
    if (tokens.length === 0) {
      return []
    }

    // Find the longest matching prefix and return tokens up to its arity
    for (let len = tokens.length; len > 0; len--) {
      const prefixStr = tokens.slice(0, len).join(" ")
      const arity = ARITY[prefixStr]
      if (arity !== undefined) {
        return tokens.slice(0, arity)
      }
    }

    // Default: return first token for unknown commands
    return tokens.slice(0, 1)
  }
}
