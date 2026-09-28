import { describe, expect, it, vi } from 'vitest';
import { Node } from '../src/node.js';

describe('Node', () => {
  it('uses Node as the default name', () => {
    expect(new Node().name).toBe('Node');
  });

  it('preserves a custom node name', () => {
    expect(new Node('merchant').name).toBe('merchant');
  });

  it('addChild sets the parent reference and includes the child in children', () => {
    const parent = new Node('parent');
    const child = new Node('child');

    parent.addChild(child);

    expect(child.parent).toBe(parent);
    expect(parent.children).toContain(child);
  });

  it('chains addChild calls on the parent', () => {
    const parent = new Node('parent');
    const first = new Node('first');
    const second = new Node('second');

    parent.addChild(first).addChild(second);

    expect(parent.children).toEqual([first, second]);
    expect(second.parent).toBe(parent);
  });

  it('keeps siblings in the order they were attached', () => {
    const parent = new Node('parent');
    const first = new Node('first');
    const second = new Node('second');

    parent.addChild(first);
    parent.addChild(second);

    expect(parent.children).toEqual([first, second]);
  });

  it('removeChild clears the parent reference and removes it from children', () => {
    const parent = new Node('parent');
    const child = new Node('child');
    parent.addChild(child);

    parent.removeChild(child);

    expect(child.parent).toBeNull();
    expect(parent.children).not.toContain(child);
  });

  it('chains removeChild calls on the parent', () => {
    const parent = new Node('parent');
    const first = new Node('first');
    const second = new Node('second');
    parent.addChild(first);
    parent.addChild(second);

    parent.removeChild(first).removeChild(second);

    expect(parent.children).toEqual([]);
    expect(second.parent).toBeNull();
  });

  it('removeChild keeps the next sibling attached', () => {
    const parent = new Node('parent');
    const first = new Node('first');
    const second = new Node('second');
    parent.addChild(first);
    parent.addChild(second);

    parent.removeChild(first);

    expect(parent.children).toEqual([second]);
    expect(second.parent).toBe(parent);
  });

  it('removeChild leaves existing children attached when the target is absent', () => {
    const parent = new Node('parent');
    const child = new Node('child');
    const absentChild = new Node('absent');
    parent.addChild(child);

    parent.removeChild(absentChild);

    expect(parent.children).toContain(child);
    expect(child.parent).toBe(parent);
  });

  it('removeFromParent detaches the node from its current parent', () => {
    const parent = new Node('parent');
    const child = new Node('child');
    parent.addChild(child);

    child.removeFromParent();

    expect(child.parent).toBeNull();
    expect(parent.children).toHaveLength(0);
  });

  it('removeFromParent is safe to call again after detaching', () => {
    const parent = new Node('parent');
    const child = new Node('child');
    parent.addChild(child);

    child.removeFromParent();

    expect(() => child.removeFromParent()).not.toThrow();
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
