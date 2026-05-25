export class DelegationCycleDetector {
  private adjacency = new Map<string, Set<string>>()

  recordDelegation(sourceAgent: string, targetAgent: string): void {
    if (!sourceAgent || !targetAgent) return

    let neighbors = this.adjacency.get(sourceAgent)
    if (!neighbors) {
      neighbors = new Set()
      this.adjacency.set(sourceAgent, neighbors)
    }
    neighbors.add(targetAgent)

    if (!this.adjacency.has(targetAgent)) {
      this.adjacency.set(targetAgent, new Set())
    }
  }

  isCycle(sourceAgent: string, targetAgent: string): boolean {
    if (!sourceAgent || !targetAgent) return false
    return this.hasPath(targetAgent, sourceAgent)
  }

  wouldCreateCycle(sourceAgent: string, targetAgent: string): {
    cycle: boolean
    reason?: string
  } {
    if (!sourceAgent || !targetAgent) return { cycle: false }

    if (sourceAgent === targetAgent) {
      return { cycle: true, reason: `Self-loop detected: "${sourceAgent}" cannot delegate to itself` }
    }

    if (this.hasPath(targetAgent, sourceAgent)) {
      const path = this.findPath(targetAgent, sourceAgent)
      const chain = path.length > 0 ? path.join(" → ") : `${targetAgent} → ${sourceAgent}`
      return {
        cycle: true,
        reason: `N-hop cycle detected: adding "${sourceAgent} → ${targetAgent}" would create cycle: ${chain} → ${sourceAgent}`,
      }
    }

    return { cycle: false }
  }

  hasPath(from: string, to: string): boolean {
    return this.findPath(from, to).length > 0
  }

  findPath(from: string, to: string): string[] {
    if (!this.adjacency.has(from)) return []
    if (from === to) return [from]

    const visited = new Set<string>()
    const stack: Array<{ node: string; path: string[] }> = [{ node: from, path: [from] }]

    while (stack.length > 0) {
      const current = stack.pop()!
      const { node, path } = current

      if (node === to) return path

      if (visited.has(node)) continue
      visited.add(node)

      const neighbors = this.adjacency.get(node)
      if (neighbors) {
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            stack.push({ node: neighbor, path: [...path, neighbor] })
          }
        }
      }
    }

    return []
  }

  getEdgeCount(): number {
    let count = 0
    for (const neighbors of this.adjacency.values()) {
      count += neighbors.size
    }
    return count
  }

  getSeenCount(): number {
    return this.getEdgeCount()
  }

  getAgentCount(): number {
    return this.adjacency.size
  }

  reset(): void {
    this.adjacency.clear()
  }
}

export class SignalDagTriggerTracker {
  private triggeredTaskIds = new Set<string>()

  markTriggered(taskId: string): void {
    this.triggeredTaskIds.add(taskId)
  }

  isAlreadyTriggered(taskId: string): boolean {
    return this.triggeredTaskIds.has(taskId)
  }

  getTriggeredCount(): number {
    return this.triggeredTaskIds.size
  }

  reset(): void {
    this.triggeredTaskIds.clear()
  }
}
