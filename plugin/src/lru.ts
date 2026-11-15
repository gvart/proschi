/** A Map that keeps its `max` most recently set or read entries: the session's caches, which would otherwise grow for as long as it runs. */
export class Lru<K, V> extends Map<K, V> {
  constructor(private readonly max: number) {
    super()
  }

  override get(key: K): V | undefined {
    if (!super.has(key)) return undefined
    const value = super.get(key)!
    super.delete(key)
    super.set(key, value)
    return value
  }

  override set(key: K, value: V): this {
    super.delete(key)
    super.set(key, value)
    if (this.size > this.max) super.delete(this.keys().next().value!)
    return this
  }
}
