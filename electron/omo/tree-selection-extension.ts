interface TreePersistenceApi {
  rpc: { handle(name: string, handler: (data: unknown) => void): void };
  appendEntry(customType: string, data: unknown): void;
}

/** A benign custom entry makes native tree selection durable without starting a turn. */
export default function treeSelectionExtension(pi: TreePersistenceApi): void {
  pi.rpc.handle("omoui.tree.persist", () => {
    pi.appendEntry("omoui.tree.selection", {});
  });
}
