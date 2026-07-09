/**
 * Minimal scene-tree node: parent/children relationships plus a small
 * lifecycle (`ready` fires once when the node enters a tree, `update` fires
 * every tick while the node is active). Deliberately agnostic of rendering,
 * transforms, or physics — those belong to higher layers (`renderer`,
 * `gameplay`), never to `core`.
 */
export class Node {
  readonly name: string;
  parent: Node | null = null;

  private readonly _children: Node[] = [];
  private _ready = false;

  constructor(name = 'Node') {
    this.name = name;
  }

  get children(): readonly Node[] {
    return this._children;
  }

  /** Attach `child` to this node. Reparents it if it already had a parent. */
  addChild(child: Node): this {
    if (child === this) {
      throw new Error('A node cannot be its own child.');
    }
    if (child.parent) {
      child.parent.removeChild(child);
    }
    child.parent = this;
    this._children.push(child);
    child._enter();
    return this;
  }

  /** Detach `child` from this node. No-op if it isn't a child. */
  removeChild(child: Node): this {
    const index = this._children.indexOf(child);
    if (index === -1) return this;
    this._children.splice(index, 1);
    child.parent = null;
    return this;
  }

  /** Detach this node from its parent, if any. */
  removeFromParent(): void {
    this.parent?.removeChild(this);
  }

  /**
   * Called once, the first time this node (or an ancestor) enters an active
   * tree. Override to run setup logic. Safe to call `addChild` from here.
   */
  ready(): void {}

  /**
   * Called every tick with the elapsed time in seconds since the previous
   * tick. Override for per-frame logic. The default implementation
   * propagates the call to children — call `super.update(dt)` if overridden.
   */
  update(dt: number): void {
    for (const child of this._children) {
      child.update(dt);
    }
  }

  private _enter(): void {
    if (!this._ready) {
      this._ready = true;
      this.ready();
    }
    for (const child of this._children) {
      child._enter();
    }
  }
}
