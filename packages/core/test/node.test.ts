import { describe, expect, it, vi } from 'vitest';
import { Node } from '../src/node.js';

describe('Node', () => {
  it('addChild sets the parent reference and includes the child in children', () => {
    const parent = new Node('parent');
    const child = new Node('child');

    parent.addChild(child);

    expect(child.parent).toBe(parent);
    expect(parent.children).toContain(child);
  });

  it('removeChild clears the parent reference and removes it from children', () => {
    const parent = new Node('parent');
    const child = new Node('child');
    parent.addChild(child);

    parent.removeChild(child);

    expect(child.parent).toBeNull();
    expect(parent.children).not.toContain(child);
  });

  it('removeFromParent detaches the node from its current parent', () => {
    const parent = new Node('parent');
    const child = new Node('child');
    parent.addChild(child);

    child.removeFromParent();

    expect(child.parent).toBeNull();
    expect(parent.children).toHaveLength(0);
  });

  it('reparenting a child removes it from the previous parent', () => {
    const oldParent = new Node('old');
    const newParent = new Node('new');
    const child = new Node('child');
    oldParent.addChild(child);

    newParent.addChild(child);

    expect(child.parent).toBe(newParent);
    expect(oldParent.children).toHaveLength(0);
    expect(newParent.children).toContain(child);
  });

  it('throws if a node is added as its own child', () => {
    const node = new Node('self');
    expect(() => node.addChild(node)).toThrow();
  });

  it('calls ready() exactly once when a node enters the tree', () => {
    class Tracked extends Node {
      readyCalls = 0;
      override ready(): void {
        this.readyCalls++;
      }
    }
    const root = new Node('root');
    const child = new Tracked('child');

    root.addChild(child);
    // Re-adding to a different parent should not re-trigger ready().
    const other = new Node('other');
    other.addChild(child);

    expect(child.readyCalls).toBe(1);
  });

  it('calls ready() on descendants already attached when the subtree enters the tree', () => {
    class Tracked extends Node {
      readyCalls = 0;
      override ready(): void {
        this.readyCalls++;
      }
    }
    const root = new Node('root');
    const branch = new Node('branch');
    const leaf = new Tracked('leaf');
    branch.addChild(leaf);

    root.addChild(branch);

    expect(leaf.readyCalls).toBe(1);
  });

  it('update() propagates dt to all children by default', () => {
    const root = new Node('root');
    const child = new Node('child');
    const updateSpy = vi.spyOn(child, 'update');
    root.addChild(child);

    root.update(0.16);

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith(0.16);
  });
});
